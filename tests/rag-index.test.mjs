import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openPaperOpsDatabase } from '../src/lib/db/database.mjs';
import { indexQueryForRag } from '../src/lib/rag/indexer.mjs';
import { retrieveEvidenceChunks } from '../src/lib/rag/retriever.mjs';

const QUERY = '"retrieval augmented generation" AND "systematic review"';

function createProjectWithSavedRun() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-rag-index-'));
  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  mkdirSync(join(projectRoot, 'output', 'pdf-text'), { recursive: true });

  const savedRun = {
    query: QUERY,
    generatedAt: '2026-07-20T10:00:00.000Z',
    summary: {
      totalRawRecords: 1,
      uniqueRecords: 1,
      duplicatesRemoved: 0,
      removedByRule: {},
      sourceCoverage: {},
    },
    records: [
      {
        source: 'scopus',
        source_id: 'SCOPUS-RAG-1',
        title: 'RAG Evidence Mapping for Literature Reviews',
        authors: ['Ada Lovelace', 'Grace Hopper'],
        year: 2026,
        venue: 'Journal of Evidence Automation',
        doi: '10.1000/rag-review',
        url: 'https://example.org/rag-review',
        abstract: 'This abstract should not be used when cached PDF text is available.',
        pdf_available: true,
        pdf_url: 'https://example.org/rag-review.pdf',
        matched_query: QUERY,
        retrieved_at: '2026-07-20T10:00:00.000Z',
      },
    ],
  };

  writeFileSync(join(projectRoot, 'output', 'saved-run.json'), JSON.stringify(savedRun, null, 2), 'utf8');
  writeFileSync(
    join(projectRoot, 'output', 'pdf-text', 'doi-10-1000-rag-review.txt'),
    [
      '--- Page 1 ---',
      'Retrieval augmented generation supports systematic review screening by grounding answers in evidence.',
      '',
      '--- Page 2 ---',
      'The study reports traceable citations and reusable evidence tables for academic writing.',
    ].join('\n'),
    'utf8',
  );

  return projectRoot;
}

test('indexQueryForRag stores saved articles, page-aware chunks, and FTS rows', async () => {
  const projectRoot = createProjectWithSavedRun();
  const result = await indexQueryForRag({ projectRoot, query: QUERY });

  assert.equal(result.query, QUERY);
  assert.equal(result.summary.articlesIndexed, 1);
  assert.equal(result.summary.chunksIndexed, 2);
  assert.ok(existsSync(result.artifacts.databasePath));

  const db = openPaperOpsDatabase({ projectRoot });
  try {
    const article = db.prepare('SELECT title, doi FROM articles WHERE article_id = ?').get('doi-10-1000-rag-review');
    assert.equal(article.title, 'RAG Evidence Mapping for Literature Reviews');
    assert.equal(article.doi, '10.1000/rag-review');

    const chunks = db.prepare('SELECT page_start, page_end, text FROM chunks ORDER BY chunk_index').all();
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].page_start, '1');
    assert.match(chunks[0].text, /systematic review screening/);
    assert.equal(chunks[1].page_start, '2');

    const hits = retrieveEvidenceChunks({
      db,
      query: QUERY,
      question: 'How does RAG support systematic review screening?',
      topK: 3,
    });
    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /systematic review screening/);
    assert.equal(hits[0].doi, '10.1000/rag-review');
    assert.equal(hits[0].pageStart, '1');
  } finally {
    db.close();
  }
});

test('indexQueryForRag falls back to saved abstract when PDF download fails', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-rag-pdf-fallback-'));
  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  writeFileSync(
    join(projectRoot, 'output', 'saved-run.json'),
    JSON.stringify({
      query: QUERY,
      generatedAt: '2026-07-20T10:00:00.000Z',
      summary: {},
      records: [
        {
          source: 'ieee',
          source_id: 'IEEE-FALLBACK',
          title: 'Abstract Fallback for RAG Indexing',
          authors: ['Grace Hopper'],
          year: 2026,
          venue: 'IEEE Software',
          doi: '10.1000/fallback',
          url: 'https://example.org/fallback',
          abstract: 'Saved abstracts keep RAG indexing useful when PDF downloads fail.',
          pdf_available: true,
          pdf_url: 'https://example.org/missing.pdf',
          matched_query: QUERY,
          retrieved_at: '2026-07-20T10:00:00.000Z',
        },
      ],
    }, null, 2),
    'utf8',
  );

  const result = await indexQueryForRag({
    projectRoot,
    query: QUERY,
    fetchImpl: async () => new Response('not found', { status: 404 }),
  });

  assert.equal(result.summary.articlesIndexed, 1);
  assert.equal(result.summary.textFailed, 0);

  const db = openPaperOpsDatabase({ projectRoot });
  try {
    const document = db.prepare('SELECT text_source, status FROM documents WHERE article_id = ?').get('doi-10-1000-fallback');
    assert.equal(document.status, 'extracted');
    assert.equal(document.text_source, 'record_abstract');

    const hits = retrieveEvidenceChunks({
      db,
      query: QUERY,
      question: 'What keeps RAG indexing useful?',
      topK: 3,
    });
    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /Saved abstracts keep RAG indexing useful/);
  } finally {
    db.close();
  }
});

test('indexQueryForRag prefers cached OCR text when OCR is enabled', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-rag-ocr-'));
  mkdirSync(join(projectRoot, 'output', 'ocr-text'), { recursive: true });
  mkdirSync(join(projectRoot, 'output', 'ocr-pdfs'), { recursive: true });
  mkdirSync(join(projectRoot, 'output'), { recursive: true });

  writeFileSync(
    join(projectRoot, 'output', 'saved-run.json'),
    JSON.stringify({
      query: QUERY,
      generatedAt: '2026-07-20T10:00:00.000Z',
      summary: {},
      records: [
        {
          source: 'scopus',
          source_id: 'SCANNED-RAG',
          title: 'Scanned RAG Evidence',
          authors: ['Katherine Johnson'],
          year: 2026,
          venue: 'Journal of OCR Evidence',
          doi: '10.1000/scanned-rag',
          url: 'https://example.org/scanned-rag',
          abstract: 'This abstract should not be used when OCR text exists.',
          pdf_available: true,
          pdf_url: 'https://example.org/scanned-rag.pdf',
          matched_query: QUERY,
          retrieved_at: '2026-07-20T10:00:00.000Z',
        },
      ],
    }, null, 2),
    'utf8',
  );

  writeFileSync(
    join(projectRoot, 'output', 'ocr-text', 'doi-10-1000-scanned-rag.txt'),
    '--- Page 3 ---\nOCR recovered text explains semantic retrieval over scanned literature.',
    'utf8',
  );

  const result = await indexQueryForRag({
    projectRoot,
    query: QUERY,
    ocr: true,
  });

  assert.equal(result.summary.articlesIndexed, 1);
  assert.equal(result.ocr.ocrSkipped, 1);

  const db = openPaperOpsDatabase({ projectRoot });
  try {
    const document = db.prepare('SELECT text_source, status FROM documents WHERE article_id = ?').get('doi-10-1000-scanned-rag');
    assert.equal(document.status, 'ocr_extracted');
    assert.equal(document.text_source, 'ocr_pdf');

    const hits = retrieveEvidenceChunks({
      db,
      query: QUERY,
      question: 'What does OCR explain?',
      topK: 3,
    });
    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /OCR recovered text/);
    assert.equal(hits[0].pageStart, '3');
  } finally {
    db.close();
  }
});
