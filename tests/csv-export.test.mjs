import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../paper-ops.mjs';
import { exportQueryResultsToCsv } from '../src/lib/csv-export.mjs';

function createTempProjectRoot() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-csv-'));
  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  return projectRoot;
}

function writeSearchExport(projectRoot, filename, payload) {
  writeFileSync(join(projectRoot, 'output', filename), JSON.stringify(payload, null, 2), 'utf8');
}

test('exportQueryResultsToCsv combines only matching query exports and deduplicates their records', () => {
  const projectRoot = createTempProjectRoot();

  writeSearchExport(projectRoot, 'run-a.json', {
    query: '"software testing" AND ai',
    generatedAt: '2026-04-18T02:40:56.291Z',
    records: [
      {
        source: 'scopus',
        source_id: 'SCOPUS-1',
        title: 'Testing Agents in Web Systems',
        authors: ['Alice'],
        year: 2025,
        venue: 'Journal A',
        doi: '10.1000/alpha',
        url: 'https://example.org/a',
        pdf_available: true,
        pdf_url: 'https://example.org/a.pdf',
        matched_query: '"software testing" AND ai',
        retrieved_at: '2026-04-18T02:40:56.291Z',
      },
    ],
  });

  writeSearchExport(projectRoot, 'run-b.json', {
    query: '"software testing"   AND    ai',
    generatedAt: '2026-04-19T02:40:56.291Z',
    records: [
      {
        source: 'ieee',
        source_id: 'IEEE-2',
        title: 'LLM-Based Test Automation',
        authors: ['Bob'],
        year: 2026,
        venue: 'Conference B',
        doi: '10.1000/beta',
        url: 'https://example.org/b',
        pdf_available: null,
        pdf_url: '',
        matched_query: '"software testing" AND ai',
        retrieved_at: '2026-04-19T02:40:56.291Z',
      },
      {
        source: 'scopus',
        source_id: 'SCOPUS-1',
        title: 'Testing Agents in Web Systems',
        authors: ['Alice'],
        year: 2025,
        venue: 'Journal A',
        doi: '10.1000/alpha',
        url: 'https://example.org/a',
        pdf_available: true,
        pdf_url: 'https://example.org/a.pdf',
        matched_query: '"software testing" AND ai',
        retrieved_at: '2026-04-19T02:40:56.291Z',
      },
    ],
  });

  writeSearchExport(projectRoot, 'run-c.json', {
    query: '"systematic review" AND rag',
    generatedAt: '2026-04-20T02:40:56.291Z',
    records: [
      {
        source: 'acm',
        source_id: 'ACM-3',
        title: 'Should Not Appear',
        authors: ['Carol'],
        year: 2024,
        venue: 'Conference C',
        doi: '10.1000/gamma',
        url: 'https://example.org/c',
        pdf_available: false,
        pdf_url: '',
        matched_query: '"systematic review" AND rag',
        retrieved_at: '2026-04-20T02:40:56.291Z',
      },
    ],
  });

  const result = exportQueryResultsToCsv({
    projectRoot,
    query: '"software testing" AND ai',
  });

  assert.equal(result.matchedFiles.length, 2);
  assert.equal(result.totalRawRecords, 3);
  assert.equal(result.uniqueRecords, 2);
  assert.ok(existsSync(result.csvPath));

  const csv = readFileSync(result.csvPath, 'utf8');
  assert.match(csv, /Testing Agents in Web Systems/);
  assert.match(csv, /LLM-Based Test Automation/);
  assert.doesNotMatch(csv, /Should Not Appear/);
});

test('main exports CSV for a query without requiring config files', async () => {
  const projectRoot = createTempProjectRoot();
  writeSearchExport(projectRoot, 'run-a.json', {
    query: '"software testing" AND ai',
    generatedAt: '2026-04-18T02:40:56.291Z',
    records: [
      {
        source: 'scopus',
        source_id: 'SCOPUS-1',
        title: 'Testing Agents in Web Systems',
        authors: ['Alice'],
        year: 2025,
        venue: 'Journal A',
        doi: '10.1000/alpha',
        url: 'https://example.org/a',
        pdf_available: true,
        pdf_url: 'https://example.org/a.pdf',
        matched_query: '"software testing" AND ai',
        retrieved_at: '2026-04-18T02:40:56.291Z',
      },
    ],
  });

  const lines = [];
  const result = await main(
    ['csv', '"software testing" AND ai', '--project-root', projectRoot],
    {
      stdout(line) {
        lines.push(line);
      },
    },
  );

  assert.equal(result.uniqueRecords, 1);
  assert.ok(existsSync(result.csvPath));
  assert.match(lines.join('\n'), /paper-ops csv complete/i);
  assert.match(lines.join('\n'), /Matching runs: 1/i);
});
