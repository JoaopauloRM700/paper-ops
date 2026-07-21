import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openPaperOpsDatabase } from '../src/lib/db/database.mjs';
import { ocrQueryPdfs } from '../src/lib/ocr/workflow.mjs';

test('ocrQueryPdfs writes OCR text artifacts and summary rows', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-ocr-'));
  const query = '"scanned pdf" AND rag';
  mkdirSync(join(projectRoot, 'output', 'pdfs'), { recursive: true });

  writeFileSync(join(projectRoot, 'output', 'saved-run.json'), JSON.stringify({
    query,
    generatedAt: '2026-07-21T10:00:00.000Z',
    summary: {},
    records: [{
      source: 'scopus',
      source_id: 'SCAN-1',
      title: 'Scanned Evidence for RAG',
      authors: ['Ada Lovelace'],
      year: 2026,
      venue: 'Journal of OCR',
      doi: '10.1000/scanned',
      url: 'https://example.org/scanned',
      abstract: '',
      pdf_available: true,
      pdf_url: 'https://example.org/scanned.pdf',
      matched_query: query,
      retrieved_at: '2026-07-21T10:00:00.000Z',
    }],
  }), 'utf8');

  writeFileSync(join(projectRoot, 'output', 'pdfs', 'doi-10-1000-scanned.pdf'), '%PDF- fake scanned pdf');

  const result = await ocrQueryPdfs({
    projectRoot,
    query,
    language: 'por+eng',
    now: new Date('2026-07-21T12:00:00.000Z'),
    ocrRunner: async ({ outputPdfPath }) => {
      writeFileSync(outputPdfPath, '%PDF- fake ocr pdf');
      return { outputPdfPath };
    },
    extractTextImpl: async () => '--- Page 1 ---\nOCR recovered text for semantic retrieval.',
  });

  const textPath = join(projectRoot, 'output', 'ocr-text', 'doi-10-1000-scanned.txt');
  assert.equal(result.summary.ocrSucceeded, 1);
  assert.equal(result.summary.ocrFailed, 0);
  assert.ok(existsSync(textPath));
  assert.match(readFileSync(textPath, 'utf8'), /OCR recovered text/);

  const db = openPaperOpsDatabase({ projectRoot });
  try {
    const row = db.prepare('SELECT status, language FROM ocr_runs WHERE article_id = ?').get('doi-10-1000-scanned');
    assert.deepEqual(row, { status: 'ocr_extracted', language: 'por+eng' });
  } finally {
    db.close();
  }
});

test('ocrQueryPdfs can download missing PDFs before OCR', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-ocr-download-'));
  const query = '"download pdf" AND ocr';
  mkdirSync(join(projectRoot, 'output'), { recursive: true });

  writeFileSync(join(projectRoot, 'output', 'saved-run.json'), JSON.stringify({
    query,
    generatedAt: '2026-07-21T10:00:00.000Z',
    summary: {},
    records: [{
      source: 'ieee',
      source_id: 'SCAN-2',
      title: 'Downloaded Scanned Evidence',
      authors: ['Grace Hopper'],
      year: 2025,
      venue: 'OCR Letters',
      doi: '10.1000/downloaded',
      url: 'https://example.org/downloaded',
      abstract: '',
      pdf_available: true,
      pdf_url: 'https://example.org/downloaded.pdf',
      matched_query: query,
      retrieved_at: '2026-07-21T10:00:00.000Z',
    }],
  }), 'utf8');

  const result = await ocrQueryPdfs({
    projectRoot,
    query,
    now: new Date('2026-07-21T12:00:00.000Z'),
    fetchImpl: async () => new Response('%PDF- downloaded', {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }),
    ocrRunner: async ({ outputPdfPath }) => {
      writeFileSync(outputPdfPath, '%PDF- fake ocr pdf');
      return { outputPdfPath };
    },
    extractTextImpl: async () => '--- Page 1 ---\nDownloaded PDF was OCR processed.',
  });

  assert.equal(result.summary.ocrSucceeded, 1);
  assert.ok(existsSync(join(projectRoot, 'output', 'pdfs', 'doi-10-1000-downloaded.pdf')));
});
