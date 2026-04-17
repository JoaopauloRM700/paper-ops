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
      scopus: { enabled: true, mode: 'fixture', fixture: 'scopus.json', api_key_env: 'SCOPUS_API_KEY' },
      ieee: { enabled: true, mode: 'fixture', fixture: 'ieee.json', api_key_env: 'IEEE_API_KEY' },
      acm: { enabled: true, mode: 'fixture', fixture: 'acm.json', api_key_env: 'ACM_API_KEY' },
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
  assert.match(markdown, /Google Scholar/);
  assert.equal(json.records.length, 4);
  assert.match(history, /retrieval augmented generation/);
});

test('runSearchAndPersist skips live sources with missing credentials and still succeeds', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-'));
  const config = loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: false,
    },
    sources: {
      scopus: { enabled: true, mode: 'live', api_key_env: 'SCOPUS_API_KEY' },
      ieee: { enabled: false, mode: 'live', api_key_env: 'IEEE_API_KEY' },
      acm: { enabled: true, mode: 'fixture', fixture: 'acm.json', api_key_env: 'ACM_API_KEY' },
      google_scholar: { enabled: true, experimental: true, mode: 'live' },
    },
  });

  const result = await runSearchAndPersist({
    query: '"knowledge graph" AND screening',
    config,
    projectRoot,
    fixtureDir: FIXTURE_DIR,
    now: new Date('2026-04-17T15:00:00.000Z'),
  });

  assert.equal(result.records.length, 2);
  assert.equal(result.summary.sourceCoverage.scopus.status, 'skipped');
  assert.equal(result.summary.sourceCoverage.scopus.reason, 'Missing required credential: SCOPUS_API_KEY');
  assert.equal(result.summary.sourceCoverage.acm.status, 'completed');
  assert.equal(result.summary.sourceCoverage.google_scholar.status, 'skipped');
});
