import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSourcesConfig, readSourcesConfig } from '../src/lib/config.mjs';
import { parseDotEnv } from '../src/lib/env.mjs';
import { runSearchAndPersist } from '../src/lib/search-runner.mjs';

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);

function createTempProject(configObject, options = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-api-'));
  mkdirSync(join(projectRoot, 'config'), { recursive: true });
  writeFileSync(join(projectRoot, 'config', 'sources.yml'), JSON.stringify(configObject, null, 2), 'utf8');

  if (options.keysText) {
    writeFileSync(join(projectRoot, 'config', 'keys.txt'), options.keysText, 'utf8');
  }

  if (options.envText) {
    writeFileSync(join(projectRoot, '.env'), options.envText, 'utf8');
  }

  return projectRoot;
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test('parseDotEnv reads simple KEY=value entries', () => {
  assert.deepEqual(
    parseDotEnv('# comment\nSCOPUS_API_KEY=scopus-key\nIEEE_API_KEY="ieee-key"\n'),
    {
      SCOPUS_API_KEY: 'scopus-key',
      IEEE_API_KEY: 'ieee-key',
    },
  );
});

test('readSourcesConfig loads API keys from .env, lets env override them, and keeps config/keys.txt as fallback', () => {
  const projectRoot = createTempProject(
    {
      defaults: { per_source_limit: 5 },
      sources: {
        scopus: { enabled: true, mode: 'api', api_url: 'https://api.elsevier.com/content/search/scopus' },
        ieee: { enabled: true, mode: 'api', api_url: 'https://ieeexploreapi.ieee.org/api/v1/search/articles' },
        acm: { enabled: false, mode: 'live', search_url: 'https://dl.acm.org/action/doSearch' },
        google_scholar: { enabled: false, mode: 'live', search_url: 'https://scholar.google.com/scholar' },
      },
    },
    {
      envText: 'SCOPUS_API_KEY=dotenv-scopus-key\nIEEE_API_KEY=dotenv-ieee-key\n',
      keysText: 'Scopus-API-Key: fallback-scopus-key;\nIEEE Xplore : Metadata Search\nKey: fallback-ieee-key\n',
    },
  );

  const config = readSourcesConfig(projectRoot, {
    IEEE_API_KEY: 'env-ieee-key',
  });

  assert.equal(config.sources.scopus.api_key, 'dotenv-scopus-key');
  assert.equal(config.sources.ieee.api_key, 'env-ieee-key');
});

test('runSearchAndPersist supports IEEE and Scopus official API mode without browser automation', async () => {
  const scopusPayload = JSON.parse(readFileSync(new URL('./fixtures/scopus.json', import.meta.url), 'utf8'));
  const ieeePayload = JSON.parse(readFileSync(new URL('./fixtures/ieee.json', import.meta.url), 'utf8'));
  const fetchCalls = [];

  const config = loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: false,
    },
    sources: {
      scopus: {
        enabled: true,
        mode: 'api',
        api_url: 'https://api.elsevier.com/content/search/scopus',
        api_key: 'scopus-test-key',
      },
      ieee: {
        enabled: true,
        mode: 'api',
        api_url: 'https://ieeexploreapi.ieee.org/api/v1/search/articles',
        api_key: 'ieee-test-key',
      },
      acm: { enabled: false, mode: 'live', search_url: 'https://dl.acm.org/action/doSearch' },
      google_scholar: { enabled: false, experimental: true, mode: 'live', search_url: 'https://scholar.google.com/scholar' },
    },
  });

  const result = await runSearchAndPersist({
    query: '"systematic review" AND rag',
    config,
    projectRoot: mkdtempSync(join(tmpdir(), 'paper-ops-api-run-')),
    fixtureDir: FIXTURE_DIR,
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (String(url).includes('elsevier')) {
        return jsonResponse(scopusPayload);
      }

      if (String(url).includes('ieeexploreapi')) {
        return jsonResponse(ieeePayload);
      }

      throw new Error(`Unexpected URL ${url}`);
    },
  });

  assert.equal(result.summary.sourceCoverage.scopus.status, 'completed');
  assert.equal(result.summary.sourceCoverage.ieee.status, 'completed');
  assert.equal(result.summary.totalRawRecords, 4);
  assert.equal(result.summary.uniqueRecords, 3);
  assert.equal(result.records[0].pdf_available, true);
  assert.equal(result.records[0].pdf_url, 'https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=IEEE-ALPHA');

  assert.equal(fetchCalls.length, 2);
  assert.match(fetchCalls[0].url, /query=/);
  assert.equal(fetchCalls[0].options.headers['X-ELS-APIKey'], 'scopus-test-key');
  assert.match(fetchCalls[1].url, /apikey=ieee-test-key/);
  assert.match(fetchCalls[1].url, /querytext=/);
});

test('runSearchAndPersist skips API sources without keys and still processes remaining sources', async () => {
  const config = loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: false,
    },
    sources: {
      scopus: {
        enabled: true,
        mode: 'api',
        api_url: 'https://api.elsevier.com/content/search/scopus',
      },
      ieee: {
        enabled: true,
        mode: 'api',
        api_url: 'https://ieeexploreapi.ieee.org/api/v1/search/articles',
      },
      acm: { enabled: true, mode: 'fixture', fixture: 'acm.json' },
      google_scholar: { enabled: false, experimental: true, mode: 'live', search_url: 'https://scholar.google.com/scholar' },
    },
  });

  let fetchCallCount = 0;
  const result = await runSearchAndPersist({
    query: '"software testing"',
    config,
    projectRoot: mkdtempSync(join(tmpdir(), 'paper-ops-api-skip-')),
    fixtureDir: FIXTURE_DIR,
    fetchImpl: async () => {
      fetchCallCount += 1;
      throw new Error('fetch should not be called without API keys');
    },
  });

  assert.equal(result.summary.sourceCoverage.scopus.status, 'skipped');
  assert.match(result.summary.sourceCoverage.scopus.reason, /API key not configured/i);
  assert.equal(result.summary.sourceCoverage.ieee.status, 'skipped');
  assert.match(result.summary.sourceCoverage.ieee.reason, /API key not configured/i);
  assert.equal(result.summary.sourceCoverage.acm.status, 'completed');
  assert.equal(fetchCallCount, 0);
});
