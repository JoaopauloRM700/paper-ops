import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { answerQuestionFromArticleTexts } from '../article-summarizer.mjs';
import { normalizeQueryKey, slugify } from '../article-texts.mjs';
import { openPaperOpsDatabase } from '../db/database.mjs';
import { initializePaperOpsSchema } from '../db/schema.mjs';
import { verifySupportingEvidence, buildSourceLabel } from './citations.mjs';
import { embedQueryChunks } from './embeddings/indexer.mjs';
import { retrieveHybridChunks } from './hybrid-retriever.mjs';
import { indexQueryForRag } from './indexer.mjs';
import { retrieveEvidenceChunks } from './retriever.mjs';
import { retrieveSemanticChunks } from './semantic-retriever.mjs';

function buildAnswerId(query, question, now) {
  const hash = createHash('sha1')
    .update(`${query}\n${question}\n${now.toISOString()}`)
    .digest('hex')
    .slice(0, 10);
  return `answer-${now.toISOString().replace(/[:.]/g, '-')}-${hash}`;
}

function buildRagAnswerMarkdown({ query, question, generatedAt, answer, evidence }) {
  const evidenceLines = evidence.length > 0
    ? evidence.map((entry) => [
        `- ${buildSourceLabel(entry)}`,
        `  Quote: "${entry.quote}"`,
        `  Verified: ${entry.verified ? 'yes' : 'no'}`,
      ].join('\n')).join('\n')
    : '- No supporting evidence was available.';

  const limitations = answer.limitations?.length
    ? answer.limitations.map((item) => `- ${item}`).join('\n')
    : '- None reported.';

  return `# RAG Question Answer

**Query:** ${query}
**Question:** ${question}
**Generated At:** ${generatedAt}
**Confidence:** ${answer.confidence}

## Answer

${answer.answer}

## Supporting Evidence

${evidenceLines}

## Limitations

${limitations}
`;
}

async function defaultAnswerGenerator({ question, evidenceChunks, profile }) {
  return answerQuestionFromArticleTexts({
    question,
    profile,
    articleTexts: evidenceChunks.map((chunk) => ({
      record: {
        title: chunk.title,
        source: 'rag',
        year: chunk.year,
      },
      text: chunk.text,
      textSource: `rag_chunk:${chunk.chunkId}`,
    })),
    chunking: {
      maxChars: 8000,
      overlapChars: 0,
      maxEvidenceChunks: evidenceChunks.length,
    },
  });
}

function insertAnswerRows(db, { answerId, queryKey, query, question, answer, evidence, generatedAt, artifacts }) {
  db.prepare(`
    INSERT INTO answers (
      answer_id, query_key, query, question, answer, confidence, generated_at,
      answer_json_path, answer_markdown_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    answerId,
    queryKey,
    query,
    question,
    answer.answer,
    answer.confidence,
    generatedAt,
    artifacts.answerJson,
    artifacts.answerMarkdown,
  );

  const insertEvidence = db.prepare(`
    INSERT INTO answer_evidence (
      answer_id, chunk_id, article_id, quote, verified, page_start, page_end, score
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const entry of evidence) {
    insertEvidence.run(
      answerId,
      entry.chunkId,
      entry.articleId,
      entry.quote,
      entry.verified ? 1 : 0,
      entry.pageStart,
      entry.pageEnd,
      entry.score,
    );
  }
}

function countIndexedChunks(db, queryKey) {
  return db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE query_key = ?').get(queryKey).count;
}

function normalizeRetrievalMode(value) {
  const mode = String(value || 'bm25').toLowerCase();
  if (['bm25', 'semantic', 'hybrid'].includes(mode)) {
    return mode;
  }
  throw new Error(`Unsupported retrieval mode: ${value}`);
}

async function retrieveChunksByMode({
  db,
  query,
  question,
  topK,
  retrievalMode,
  embeddingProvider,
  embeddingProviderName,
  embeddingModel,
}) {
  if (retrievalMode === 'semantic') {
    return retrieveSemanticChunks({
      db,
      query,
      question,
      topK,
      embeddingProvider,
      provider: embeddingProviderName,
      model: embeddingModel,
    });
  }

  if (retrievalMode === 'hybrid') {
    return retrieveHybridChunks({
      db,
      query,
      question,
      topK,
      embeddingProvider,
      provider: embeddingProviderName,
      model: embeddingModel,
    });
  }

  return retrieveEvidenceChunks({
    db,
    query,
    question,
    topK,
  }).map((chunk) => ({
    ...chunk,
    retrievalMode: 'bm25',
    retrievalSources: ['bm25'],
  }));
}

export async function answerQueryWithRag({
  projectRoot,
  query,
  question,
  topK = 12,
  retrieval = 'bm25',
  now = new Date(),
  refreshText = false,
  refreshIndex = false,
  ocr = false,
  ocrLanguage = process.env.PAPER_OPS_OCR_LANG || 'eng',
  ocrRunner,
  embed = false,
  refreshEmbeddings = false,
  embeddingProviderName = process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
  embeddingModel = process.env.PAPER_OPS_EMBEDDING_MODEL || (embeddingProviderName === 'fixture' ? 'fixture-64' : 'text-embedding-3-small'),
  embeddingProvider,
  fetchImpl = fetch,
  extractTextImpl,
  answerGenerator = defaultAnswerGenerator,
  databasePath,
} = {}) {
  const queryKey = normalizeQueryKey(query);
  const retrievalMode = normalizeRetrievalMode(retrieval);
  const db = openPaperOpsDatabase({ projectRoot, databasePath });
  initializePaperOpsSchema(db);

  try {
    if (refreshIndex || countIndexedChunks(db, queryKey) === 0) {
      db.close();
      await indexQueryForRag({
        projectRoot,
        query,
        now,
        refreshText,
        refreshIndex,
        ocr,
        ocrLanguage,
        ...(ocrRunner ? { ocrRunner } : {}),
        embed: false,
        fetchImpl,
        ...(extractTextImpl ? { extractTextImpl } : {}),
        databasePath,
      });
    }
  } finally {
    if (db.open) {
      db.close();
    }
  }

  const embeddingResult = (embed || retrievalMode === 'semantic' || retrievalMode === 'hybrid')
    ? await embedQueryChunks({
        projectRoot,
        query,
        provider: embeddingProviderName,
        model: embeddingModel,
        refreshEmbeddings,
        now,
        databasePath,
        ...(embeddingProvider ? { embeddingProvider } : {}),
      })
    : null;

  const readDb = openPaperOpsDatabase({ projectRoot, databasePath });
  initializePaperOpsSchema(readDb);

  try {
    const evidenceChunks = await retrieveChunksByMode({
      db: readDb,
      query,
      question,
      topK,
      retrievalMode,
      embeddingProvider,
      embeddingProviderName,
      embeddingModel,
    });

    const generatedAt = now.toISOString();
    const answerId = buildAnswerId(query, question, now);
    const answerPayload = evidenceChunks.length === 0
      ? {
          answer: 'Nao encontrei evidencia suficiente no corpus indexado para responder essa pergunta.',
          confidence: 'low',
          supporting_evidence: [],
          limitations: ['No indexed chunk matched the question.'],
        }
      : await answerGenerator({ query, question, evidenceChunks });

    const supportingEvidence = verifySupportingEvidence(answerPayload.supporting_evidence, evidenceChunks);
    const answer = {
      answer: answerPayload.answer || 'Nao encontrei evidencia suficiente no corpus indexado para responder essa pergunta.',
      confidence: answerPayload.confidence || 'low',
      supporting_evidence: supportingEvidence,
      limitations: Array.isArray(answerPayload.limitations) ? answerPayload.limitations : [],
    };

    const outputDir = join(projectRoot, 'output', 'rag', slugify(queryKey, 64), 'answers');
    const reportDir = join(projectRoot, 'reports', 'rag', slugify(queryKey, 64), 'answers');
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(reportDir, { recursive: true });

    const artifacts = {
      answerJson: join(outputDir, `${answerId}.json`),
      answerMarkdown: join(reportDir, `${answerId}.md`),
    };
    const payload = {
      answerId,
      query,
      question,
      generatedAt,
      answer,
      retrieval: {
        mode: retrievalMode,
        topK,
        chunksReturned: evidenceChunks.length,
        embeddings: embeddingResult?.summary ?? null,
      },
      chunksUsed: evidenceChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        articleId: chunk.articleId,
        title: chunk.title,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        score: chunk.score,
      })),
    };

    writeFileSync(artifacts.answerJson, JSON.stringify(payload, null, 2), 'utf8');
    writeFileSync(
      artifacts.answerMarkdown,
      buildRagAnswerMarkdown({
        query,
        question,
        generatedAt,
        answer,
        evidence: supportingEvidence,
      }),
      'utf8',
    );

    const work = readDb.transaction(() => {
      insertAnswerRows(readDb, {
        answerId,
        queryKey,
        query,
        question,
        answer,
        evidence: supportingEvidence,
        generatedAt,
        artifacts,
      });
    });
    work();

    return {
      query,
      question,
      answer,
      retrieval: payload.retrieval,
      chunksUsed: evidenceChunks,
      artifacts,
    };
  } finally {
    readDb.close();
  }
}
