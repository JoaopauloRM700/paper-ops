import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openPaperOpsDatabase } from '../src/lib/db/database.mjs';
import { createEmbeddingProvider } from '../src/lib/rag/embeddings/provider.mjs';
import { embedQueryChunks } from '../src/lib/rag/embeddings/indexer.mjs';
import { indexQueryForRag } from '../src/lib/rag/indexer.mjs';
import { retrieveSemanticChunks } from '../src/lib/rag/semantic-retriever.mjs';

const QUERY = '"study selection" AND rag';

async function createSemanticProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-semantic-'));
  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  mkdirSync(join(projectRoot, 'output', 'pdf-text'), { recursive: true });

  writeFileSync(join(projectRoot, 'output', 'saved-run.json'), JSON.stringify({
    query: QUERY,
    generatedAt: '2026-07-21T10:00:00.000Z',
    summary: {},
    records: [{
      source: 'acm',
      source_id: 'SEM-RET',
      title: 'Study Screening with RAG',
      authors: ['Grace Hopper'],
      year: 2026,
      venue: 'ACM Evidence',
      doi: '10.1145/semantic-retrieval',
      url: 'https://example.org/semantic-retrieval',
      abstract: '',
      pdf_available: true,
      pdf_url: 'https://example.org/semantic-retrieval.pdf',
      matched_query: QUERY,
      retrieved_at: '2026-07-21T10:00:00.000Z',
    }],
  }), 'utf8');

  writeFileSync(
    join(projectRoot, 'output', 'pdf-text', 'doi-10-1145-semantic-retrieval.txt'),
    [
      '--- Page 1 ---',
      'Screening criteria determine study inclusion and exclusion for the review.',
      '',
      '--- Page 2 ---',
      'Runtime dashboards summarize unrelated deployment metrics.',
    ].join('\n'),
    'utf8',
  );

  await indexQueryForRag({ projectRoot, query: QUERY });
  const embeddingProvider = createEmbeddingProvider({ provider: 'fixture', model: 'fixture-32' });
  await embedQueryChunks({
    projectRoot,
    query: QUERY,
    embeddingProvider,
  });

  return { projectRoot, embeddingProvider };
}

test('retrieveSemanticChunks returns chunks ranked by vector similarity', async () => {
  const { projectRoot, embeddingProvider } = await createSemanticProject();
  const db = openPaperOpsDatabase({ projectRoot });
  try {
    const hits = await retrieveSemanticChunks({
      db,
      query: QUERY,
      question: 'How are studies selected?',
      topK: 1,
      embeddingProvider,
    });

    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /Screening criteria/);
    assert.equal(hits[0].retrievalMode, 'semantic');
    assert.equal(hits[0].pageStart, '1');
    assert.ok(hits[0].score > 0);
  } finally {
    db.close();
  }
});
