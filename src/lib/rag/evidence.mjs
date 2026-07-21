import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeQueryKey, slugify } from '../article-texts.mjs';
import { openPaperOpsDatabase } from '../db/database.mjs';
import { initializePaperOpsSchema } from '../db/schema.mjs';
import { embedQueryChunks } from './embeddings/indexer.mjs';
import { retrieveHybridChunks } from './hybrid-retriever.mjs';
import { indexQueryForRag } from './indexer.mjs';
import { retrieveEvidenceChunks } from './retriever.mjs';
import { retrieveSemanticChunks } from './semantic-retriever.mjs';

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

  return retrieveEvidenceChunks({ db, query, question, topK }).map((chunk) => ({
    ...chunk,
    retrievalMode: 'bm25',
    retrievalSources: ['bm25'],
  }));
}

function buildEvidenceMarkdown({ query, question, evidenceChunks }) {
  const rows = evidenceChunks.map((chunk, index) => (
    `| ${index + 1} | ${chunk.title} | ${chunk.pageStart || '-'} | ${chunk.doi || '-'} | ${String(chunk.score ?? '').slice(0, 10)} | ${chunk.text.replace(/\|/g, '\\|')} |`
  )).join('\n');

  return `# Evidence Table

**Query:** ${query}
**Question:** ${question}

| # | Article | Page | DOI | Score | Evidence |
|---:|---|---|---|---:|---|
${rows || '| - | - | - | - | - | No evidence found. |'}
`;
}

export async function collectEvidenceForQuestion({
  projectRoot,
  query,
  question,
  topK = 20,
  retrieval = 'bm25',
  now = new Date(),
  refreshIndex = false,
  ocr = false,
  ocrLanguage = process.env.PAPER_OPS_OCR_LANG || 'eng',
  embed = false,
  refreshEmbeddings = false,
  embeddingProviderName = process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
  embeddingModel = process.env.PAPER_OPS_EMBEDDING_MODEL || (embeddingProviderName === 'fixture' ? 'fixture-64' : 'text-embedding-3-small'),
  embeddingProvider,
  databasePath,
} = {}) {
  const queryKey = normalizeQueryKey(query);
  const retrievalMode = normalizeRetrievalMode(retrieval);
  const db = openPaperOpsDatabase({ projectRoot, databasePath });
  initializePaperOpsSchema(db);
  try {
    if (refreshIndex || countIndexedChunks(db, queryKey) === 0) {
      db.close();
      await indexQueryForRag({ projectRoot, query, now, refreshIndex, ocr, ocrLanguage, databasePath });
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
    const outputDir = join(projectRoot, 'output', 'rag', slugify(queryKey, 64), 'evidence');
    const reportDir = join(projectRoot, 'reports', 'rag', slugify(queryKey, 64), 'evidence');
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(reportDir, { recursive: true });

    const runId = `evidence-${now.toISOString().replace(/[:.]/g, '-')}`;
    const evidenceJson = join(outputDir, `${runId}.json`);
    const evidenceMarkdown = join(reportDir, `${runId}.md`);
    const payload = {
      query,
      question,
      generatedAt: now.toISOString(),
      retrieval: {
        mode: retrievalMode,
        topK,
        chunksReturned: evidenceChunks.length,
        embeddings: embeddingResult?.summary ?? null,
      },
      evidenceChunks,
    };

    writeFileSync(evidenceJson, JSON.stringify(payload, null, 2), 'utf8');
    writeFileSync(evidenceMarkdown, buildEvidenceMarkdown({ query, question, evidenceChunks }), 'utf8');

    return {
      ...payload,
      artifacts: {
        evidenceJson,
        evidenceMarkdown,
      },
    };
  } finally {
    readDb.close();
  }
}
