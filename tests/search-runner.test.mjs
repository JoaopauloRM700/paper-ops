import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSourcesConfig } from '../src/lib/config.mjs';
import { routeCliInput } from '../src/lib/cli.mjs';
import { runSearchAndPersist } from '../src/lib/search-runner.mjs';

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);

test('routeCliInput maps explicit search mode and raw boolean queries to search', () => {
  assert.deepEqual(routeCliInput(['search', '"systematic review" AND rag']), {
    mode: 'search',
    query: '"systematic review" AND rag',
    flags: {},
  });

  assert.deepEqual(routeCliInput(['("systematic review" AND rag) AND ieee']), {
    mode: 'search',
    query: '("systematic review" AND rag) AND ieee',
    flags: {},
  });
});

test('runSearchAndPersist writes markdown, json, and history artifacts from fixture-backed sources', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-'));
  const config = loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: true,
    },
    sources: {
      scopus: { enabled: true, mode: 'fixture', fixture: 'scopus.json' },
      ieee: { enabled: true, mode: 'fixture', fixture: 'ieee.json' },
      acm: { enabled: true, mode: 'fixture', fixture: 'acm.json' },
      google_scholar: { enabled: false, experimental: true, mode: 'fixture', fixture: 'scholar.json' },
    },
  });

  const result = await runSearchAndPersist({
    query: '("systematic review" AND "retrieval augmented generation")',
    config,
    projectRoot,
    fixtureDir: FIXTURE_DIR,
    now: new Date('2026-04-17T15:00:00.000Z'),
  });

  assert.equal(result.records.length, 4);
  assert.equal(result.summary.totalRawRecords, 6);
  assert.equal(result.summary.duplicatesRemoved, 2);
  assert.ok(result.summary.sourceCoverage.scopus.status === 'completed');
  assert.ok(result.summary.sourceCoverage.ieee.status === 'completed');
  assert.ok(result.summary.sourceCoverage.acm.status === 'completed');
  assert.ok(result.summary.sourceCoverage.google_scholar.status === 'skipped');

  assert.ok(existsSync(result.artifacts.markdownReport));
  assert.ok(existsSync(result.artifacts.jsonExport));
  assert.ok(existsSync(result.artifacts.historyIndex));

  const markdown = readFileSync(result.artifacts.markdownReport, 'utf8');
  const json = JSON.parse(readFileSync(result.artifacts.jsonExport, 'utf8'));
  const history = readFileSync(result.artifacts.historyIndex, 'utf8');

  assert.match(markdown, /Academic Paper Search Report/);
  assert.match(markdown, /PDF Available/);
  assert.match(markdown, /Google Scholar/);
  assert.equal(json.records.length, 4);
  assert.equal(json.records[0].pdf_available, true);
  assert.equal(json.records[0].pdf_url, 'https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=IEEE-ALPHA');
  assert.equal(json.records[1].pdf_available, true);
  assert.equal(json.records[1].pdf_url, 'https://dl.acm.org/doi/pdf/ACM-BETA');
  assert.match(history, /retrieval augmented generation/);
});

test('runSearchAndPersist skips live browser sources when the browser runtime cannot start and still succeeds', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-'));
  const config = loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: false,
    },
    sources: {
      scopus: { enabled: true, mode: 'live', search_url: 'https://www.scopus.com/results/results.uri' },
      ieee: { enabled: false, mode: 'live', search_url: 'https://ieeexplore.ieee.org/search/searchresult.jsp' },
      acm: { enabled: true, mode: 'fixture', fixture: 'acm.json' },
      google_scholar: { enabled: true, experimental: true, mode: 'live', search_url: 'https://scholar.google.com/scholar' },
    },
  });

  const result = await runSearchAndPersist({
    query: '"knowledge graph" AND screening',
    config,
    projectRoot,
    fixtureDir: FIXTURE_DIR,
    browserFactory: async () => {
      throw new Error('Chromium is not installed');
    },
    now: new Date('2026-04-17T15:00:00.000Z'),
  });

  assert.equal(result.records.length, 2);
  assert.equal(result.summary.sourceCoverage.scopus.status, 'skipped');
  assert.match(result.summary.sourceCoverage.scopus.reason, /Browser automation unavailable/);
  assert.equal(result.summary.sourceCoverage.acm.status, 'completed');
  assert.equal(result.summary.sourceCoverage.google_scholar.status, 'skipped');
});
