import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSourcesConfig } from '../src/lib/config.mjs';
import { processQueuedSearches } from '../src/lib/pipeline.mjs';
import { processBatchQueries } from '../src/lib/batch.mjs';

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);

function createFixtureConfig() {
  return loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: true,
    },
    sources: {
      scopus: { enabled: true, mode: 'fixture', fixture: 'scopus.json' },
      ieee: { enabled: false, mode: 'fixture', fixture: 'ieee.json' },
      acm: { enabled: false, mode: 'fixture', fixture: 'acm.json' },
      google_scholar: { enabled: false, experimental: true, mode: 'fixture', fixture: 'scholar.json' },
    },
  });
}

test('processQueuedSearches produces distinct artifacts for duplicate queries in the same run', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-pipeline-'));
  mkdirSync(join(projectRoot, 'data'), { recursive: true });
  writeFileSync(
    join(projectRoot, 'data', 'search-queue.md'),
    '# Search Queue\n\n## Pending\n- [ ] "duplicate query"\n- [ ] "duplicate query"\n',
    'utf8',
  );

  const results = await processQueuedSearches({
    config: createFixtureConfig(),
    projectRoot,
    fixtureDir: FIXTURE_DIR,
    now: new Date('2026-04-17T15:00:00.000Z'),
  });

  assert.equal(results.length, 2);
  assert.notEqual(results[0].artifacts.markdownReport, results[1].artifacts.markdownReport);
  assert.notEqual(results[0].artifacts.jsonExport, results[1].artifacts.jsonExport);
  assert.ok(existsSync(results[0].artifacts.markdownReport));
  assert.ok(existsSync(results[1].artifacts.markdownReport));
});

test('processBatchQueries produces distinct artifacts for duplicate queries in the same batch', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-batch-'));
  mkdirSync(join(projectRoot, 'batch'), { recursive: true });
  writeFileSync(
    join(projectRoot, 'batch', 'batch-input.tsv'),
    'id\tquery\n1\t"duplicate query"\n2\t"duplicate query"\n',
    'utf8',
  );

  const results = await processBatchQueries({
    config: createFixtureConfig(),
    projectRoot,
    fixtureDir: FIXTURE_DIR,
    now: new Date('2026-04-17T15:00:00.000Z'),
  });

  assert.equal(results.length, 2);
  assert.notEqual(results[0].artifacts.markdownReport, results[1].artifacts.markdownReport);
  assert.notEqual(results[0].artifacts.jsonExport, results[1].artifacts.jsonExport);
  assert.ok(existsSync(results[0].artifacts.jsonExport));
  assert.ok(existsSync(results[1].artifacts.jsonExport));
});
