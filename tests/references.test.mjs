import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { indexQueryForRag } from '../src/lib/rag/indexer.mjs';
import { exportReferencesForQuery } from '../src/lib/rag/references.mjs';

const QUERY = '"citation management" AND rag';

test('exportReferencesForQuery emits ABNT and BibTeX from indexed articles', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-refs-'));
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
          source_id: 'IEEE-CITE-1',
          title: 'Citation Grounding in RAG Systems',
          authors: ['Ada Lovelace', 'Grace Hopper'],
          year: 2024,
          venue: 'IEEE Software',
          doi: '10.1109/cite',
          url: 'https://example.org/cite',
          abstract: 'Citation grounding links generated answers to exact evidence.',
          pdf_available: null,
          pdf_url: '',
          matched_query: QUERY,
          retrieved_at: '2026-07-20T10:00:00.000Z',
        },
      ],
    }, null, 2),
    'utf8',
  );

  await indexQueryForRag({ projectRoot, query: QUERY });
  const result = exportReferencesForQuery({ projectRoot, query: QUERY, format: 'all' });

  assert.match(result.abnt, /LOVELACE, Ada; HOPPER, Grace\. Citation Grounding in RAG Systems\./);
  assert.match(result.abnt, /IEEE Software, 2024/);
  assert.match(result.bibtex, /@article\{lovelace2024citation/);
  assert.match(result.bibtex, /doi = \{10\.1109\/cite\}/);
  assert.ok(result.artifacts.abntPath.endsWith('.abnt.txt'));
  assert.ok(result.artifacts.bibtexPath.endsWith('.bib'));
});
