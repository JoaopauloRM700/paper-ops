import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openPaperOpsDatabase } from '../src/lib/db/database.mjs';
import { createEmbeddingProvider } from '../src/lib/rag/embeddings/provider.mjs';
import { embedQueryChunks } from '../src/lib/rag/embeddings/indexer.mjs';
import { indexQueryForRag } from '../src/lib/rag/indexer.mjs';

const QUERY = '"semantic retrieval" AND rag';

function createProjectWithIndexedChunks() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-embed-'));
  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  mkdirSync(join(projectRoot, 'output', 'pdf-text'), { recursive: true });

  writeFileSync(join(projectRoot, 'output', 'saved-run.json'), JSON.stringify({
    query: QUERY,
    generatedAt: '2026-07-21T10:00:00.000Z',
    summary: {},
    records: [{
      source: 'scopus',
      source_id: 'SEM-1',
      title: 'Semantic Retrieval for RAG Evidence',
      authors: ['Ada Lovelace'],
      year: 2026,
      venue: 'Journal of RAG',
      doi: '10.1000/semantic',
      url: 'https://example.org/semantic',
      abstract: '',
      pdf_available: true,
      pdf_url: 'https://example.org/semantic.pdf',
      matched_query: QUERY,
      retrieved_at: '2026-07-21T10:00:00.000Z',
    }],
  }), 'utf8');

  writeFileSync(
    join(projectRoot, 'output', 'pdf-text', 'doi-10-1000-semantic.txt'),
    [
      '--- Page 1 ---',
      'Semantic retrieval finds paraphrased evidence in academic papers.',
      '',
      '--- Page 2 ---',
      'Hybrid search keeps exact terminology and conceptual matches together.',
    ].join('\n'),
    'utf8',
  );

  return projectRoot;
}

test('fixture embedding provider returns stable normalized vectors', async () => {
  const provider = createEmbeddingProvider({ provider: 'fixture', model: 'fixture-8' });
  const result = await provider.embedTexts(['retrieval augmented generation', 'screening studies']);

  assert.equal(result.provider, 'fixture');
  assert.equal(result.model, 'fixture-8');
  assert.equal(result.dimension, 8);
  assert.equal(result.vectors.length, 2);
  assert.equal(result.vectors[0].length, 8);

  const magnitude = Math.sqrt(result.vectors[0].reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(magnitude - 1) < 0.000001);
});

test('openai-compatible provider sends embeddings request', async () => {
  const calls = [];
  const provider = createEmbeddingProvider({
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await provider.embedTexts(['academic evidence']);
  assert.equal(result.provider, 'openai');
  assert.equal(result.dimension, 3);
  assert.deepEqual(result.vectors[0], [0.1, 0.2, 0.3]);
  assert.match(calls[0].url, /\/v1\/embeddings$/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-key');
});

test('embedQueryChunks stores one embedding per indexed chunk', async () => {
  const projectRoot = createProjectWithIndexedChunks();
  await indexQueryForRag({ projectRoot, query: QUERY });

  const result = await embedQueryChunks({
    projectRoot,
    query: QUERY,
    provider: 'fixture',
    model: 'fixture-8',
    now: new Date('2026-07-21T12:00:00.000Z'),
  });

  assert.equal(result.summary.chunksTotal, 2);
  assert.equal(result.summary.chunksEmbedded, 2);
  assert.equal(result.summary.chunksSkipped, 0);

  const db = openPaperOpsDatabase({ projectRoot });
  try {
    const count = db.prepare('SELECT COUNT(*) AS count FROM embeddings').get().count;
    assert.equal(count, 2);

    const row = db.prepare('SELECT provider, model, dimension, text_hash FROM embeddings LIMIT 1').get();
    assert.equal(row.provider, 'fixture');
    assert.equal(row.model, 'fixture-8');
    assert.equal(row.dimension, 8);
    assert.ok(row.text_hash.length > 20);
  } finally {
    db.close();
  }
});
