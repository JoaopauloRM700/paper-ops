import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { answerQueryWithRag } from '../src/lib/rag/answerer.mjs';
import { openPaperOpsDatabase } from '../src/lib/db/database.mjs';
import { createEmbeddingProvider } from '../src/lib/rag/embeddings/provider.mjs';

const QUERY = '"ai testing" AND "regression"';

function createProjectWithSavedRun() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-rag-answer-'));
  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  mkdirSync(join(projectRoot, 'output', 'pdf-text'), { recursive: true });

  writeFileSync(
    join(projectRoot, 'output', 'saved-run.json'),
    JSON.stringify({
      query: QUERY,
      generatedAt: '2026-07-20T10:00:00.000Z',
      summary: {},
      records: [
        {
          source: 'acm',
          source_id: 'ACM-TEST-1',
          title: 'AI-Augmented Regression Testing Pipelines',
          authors: ['Margaret Hamilton'],
          year: 2025,
          venue: 'ACM QA Notes',
          doi: '10.1145/testing',
          url: 'https://example.org/testing',
          abstract: '',
          pdf_available: true,
          pdf_url: 'https://example.org/testing.pdf',
          matched_query: QUERY,
          retrieved_at: '2026-07-20T10:00:00.000Z',
        },
      ],
    }, null, 2),
    'utf8',
  );

  writeFileSync(
    join(projectRoot, 'output', 'pdf-text', 'doi-10-1145-testing.txt'),
    '--- Page 4 ---\nAI-assisted regression testing reduced triage time and produced reusable evidence tables.',
    'utf8',
  );

  return projectRoot;
}

test('answerQueryWithRag answers from indexed chunks and persists verified evidence', async () => {
  const projectRoot = createProjectWithSavedRun();

  const result = await answerQueryWithRag({
    projectRoot,
    query: QUERY,
    question: 'What practical contribution does AI-assisted regression testing provide?',
    now: new Date('2026-07-20T12:00:00.000Z'),
    answerGenerator: async ({ evidenceChunks }) => ({
      answer: 'It reduced triage time and produced reusable evidence tables.',
      confidence: 'high',
      supporting_evidence: [
        {
          chunkId: evidenceChunks[0].chunkId,
          title: evidenceChunks[0].title,
          page: '4',
          quote: 'this exact quote is not in the chunk',
        },
      ],
      limitations: [],
    }),
  });

  assert.equal(result.answer.confidence, 'high');
  assert.equal(result.answer.supporting_evidence.length, 1);
  assert.equal(result.answer.supporting_evidence[0].verified, false);
  assert.match(result.answer.supporting_evidence[0].quote, /AI-assisted regression testing reduced triage time/);
  assert.ok(existsSync(result.artifacts.answerJson));
  assert.ok(existsSync(result.artifacts.answerMarkdown));
  assert.match(readFileSync(result.artifacts.answerMarkdown, 'utf8'), /Verified: no/);

  const db = openPaperOpsDatabase({ projectRoot });
  try {
    const answer = db.prepare('SELECT question, confidence FROM answers').get();
    assert.equal(answer.confidence, 'high');
    assert.match(answer.question, /practical contribution/);

    const evidence = db.prepare('SELECT verified, page_start FROM answer_evidence').get();
    assert.equal(evidence.verified, 0);
    assert.equal(evidence.page_start, '4');
  } finally {
    db.close();
  }
});

test('answerQueryWithRag supports hybrid retrieval with embeddings', async () => {
  const projectRoot = createProjectWithSavedRun();
  const embeddingProvider = createEmbeddingProvider({ provider: 'fixture', model: 'fixture-32' });

  const result = await answerQueryWithRag({
    projectRoot,
    query: QUERY,
    question: 'What reusable evidence does regression testing produce?',
    retrieval: 'hybrid',
    embed: true,
    embeddingProvider,
    now: new Date('2026-07-20T12:30:00.000Z'),
    answerGenerator: async ({ evidenceChunks }) => ({
      answer: 'It produced reusable evidence tables.',
      confidence: 'medium',
      supporting_evidence: [
        {
          chunkId: evidenceChunks[0].chunkId,
          title: evidenceChunks[0].title,
          page: '4',
          quote: 'AI-assisted regression testing reduced triage time and produced reusable evidence tables.',
        },
      ],
      limitations: [],
    }),
  });

  assert.equal(result.retrieval.mode, 'hybrid');
  assert.equal(result.retrieval.embeddings.chunksEmbedded, 1);
  assert.equal(result.answer.supporting_evidence[0].verified, true);
  assert.equal(result.chunksUsed[0].retrievalMode, 'hybrid');
});
