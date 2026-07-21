import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openPaperOpsDatabase } from '../src/lib/db/database.mjs';
import { initializePaperOpsSchema } from '../src/lib/db/schema.mjs';

test('initializePaperOpsSchema creates the local RAG schema idempotently', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-db-'));
  const db = openPaperOpsDatabase({ projectRoot });

  try {
    initializePaperOpsSchema(db);
    initializePaperOpsSchema(db);

    const tables = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type IN ('table', 'virtual')
      ORDER BY name
    `).all().map((row) => row.name);

    assert.ok(tables.includes('search_runs'));
    assert.ok(tables.includes('articles'));
    assert.ok(tables.includes('documents'));
    assert.ok(tables.includes('chunks'));
    assert.ok(tables.includes('chunk_fts'));
    assert.ok(tables.includes('answers'));
    assert.ok(tables.includes('answer_evidence'));
    assert.ok(tables.includes('references'));
    assert.ok(tables.includes('embeddings'));
    assert.ok(tables.includes('ocr_runs'));
    assert.ok(tables.includes('embedding_runs'));

    const embeddingColumns = db.prepare('PRAGMA table_info(embeddings)').all().map((row) => row.name);
    assert.ok(embeddingColumns.includes('dimension'));
    assert.ok(embeddingColumns.includes('text_hash'));
    assert.ok(embeddingColumns.includes('updated_at'));

    db.prepare(`
      INSERT INTO articles (
        article_id, source, source_id, title, authors_json, year, venue, doi, url,
        pdf_path, text_path, created_at, updated_at
      )
      VALUES (
        'article-alpha', 'scopus', 'SCOPUS-ALPHA', 'Evidence Mapping with RAG',
        '["Ada Lovelace"]', 2026, 'Journal of Evidence Automation',
        '10.1000/alpha', 'https://example.org/alpha', '', '',
        '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z'
      )
    `).run();

    const article = db.prepare('SELECT article_id, title FROM articles WHERE article_id = ?').get('article-alpha');
    assert.deepEqual(article, {
      article_id: 'article-alpha',
      title: 'Evidence Mapping with RAG',
    });
  } finally {
    db.close();
  }
});
