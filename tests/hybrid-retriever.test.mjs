import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openPaperOpsDatabase } from '../src/lib/db/database.mjs';
import { createEmbeddingProvider } from '../src/lib/rag/embeddings/provider.mjs';
import { embedQueryChunks } from '../src/lib/rag/embeddings/indexer.mjs';
import { retrieveHybridChunks } from '../src/lib/rag/hybrid-retriever.mjs';
import { indexQueryForRag } from '../src/lib/rag/indexer.mjs';

const QUERY = '"hybrid retrieval" AND rag';

async function createHybridProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-hybrid-'));
  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  mkdirSync(join(projectRoot, 'output', 'pdf-text'), { recursive: true });

  writeFileSync(join(projectRoot, 'output', 'saved-run.json'), JSON.stringify({
    query: QUERY,
    generatedAt: '2026-07-21T10:00:00.000Z',
    summary: {},
    records: [{
      source: 'ieee',
      source_id: 'HYB-RET',
      title: 'Hybrid Retrieval for Evidence',
      authors: ['Ada Lovelace'],
      year: 2026,
      venue: 'IEEE Evidence',
      doi: '10.1109/hybrid',
      url: 'https://example.org/hybrid',
      abstract: '',
      pdf_available: true,
      pdf_url: 'https://example.org/hybrid.pdf',
      matched_query: QUERY,
      retrieved_at: '2026-07-21T10:00:00.000Z',
    }],
  }), 'utf8');

  writeFileSync(
    join(projectRoot, 'output', 'pdf-text', 'doi-10-1109-hybrid.txt'),
    [
      '--- Page 1 ---',
      'Traceable citations preserve exact terminology for literature review evidence.',
      '',
      '--- Page 2 ---',
      'Screening criteria determine study inclusion and exclusion for the review.',
    ].join('\n'),
    'utf8',
  );

  await indexQueryForRag({ projectRoot, query: QUERY });
  const embeddingProvider = createEmbeddingProvider({ provider: 'fixture', model: 'fixture-32' });
  await embedQueryChunks({ projectRoot, query: QUERY, embeddingProvider });

  return { projectRoot, embeddingProvider };
}

test('retrieveHybridChunks combines BM25 and semantic result sources', async () => {
  const { projectRoot, embeddingProvider } = await createHybridProject();
  const db = openPaperOpsDatabase({ projectRoot });
  try {
    const hits = await retrieveHybridChunks({
      db,
      query: QUERY,
      question: 'traceable citations selected studies',
      topK: 2,
      embeddingProvider,
    });

    assert.equal(hits.length, 2);
    assert.ok(hits.some((hit) => hit.retrievalSources.includes('bm25')));
    assert.ok(hits.some((hit) => hit.retrievalSources.includes('semantic')));
    assert.ok(hits.every((hit) => hit.retrievalMode === 'hybrid'));
  } finally {
    db.close();
  }
});
