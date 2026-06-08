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
    parseDotEnv('# comment\nSCOPUS_API_KEY=scopus-key\nIEEE_API_KEY="ieee-key"\nWEB_OF_SCIENCE_API_KEY=wos-key\n'),
    {
      SCOPUS_API_KEY: 'scopus-key',
      IEEE_API_KEY: 'ieee-key',
      WEB_OF_SCIENCE_API_KEY: 'wos-key',
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
        scielo: { enabled: false, mode: 'live', search_url: 'https://search.scielo.org/' },
        web_of_science: { enabled: true, mode: 'api', api_url: 'https://api.clarivate.com/apis/wos-starter/v1/documents' },
      },
    },
    {
      envText: 'SCOPUS_API_KEY=dotenv-scopus-key\nIEEE_API_KEY=dotenv-ieee-key\nWEB_OF_SCIENCE_API_KEY=dotenv-wos-key\n',
      keysText: 'Scopus-API-Key: fallback-scopus-key;\nIEEE Xplore : Metadata Search\nKey: fallback-ieee-key\nWeb of Science API Key: fallback-wos-key\n',
    },
  );

  const config = readSourcesConfig(projectRoot, {
    IEEE_API_KEY: 'env-ieee-key',
  });

  assert.equal(config.sources.scopus.api_key, 'dotenv-scopus-key');
  assert.equal(config.sources.ieee.api_key, 'env-ieee-key');
  assert.equal(config.sources.web_of_science.api_key, 'dotenv-wos-key');
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
      scielo: { enabled: false, mode: 'live', search_url: 'https://search.scielo.org/' },
      web_of_science: { enabled: false, mode: 'api', api_url: 'https://api.clarivate.com/apis/wos-starter/v1/documents' },
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
      scielo: { enabled: false, mode: 'live', search_url: 'https://search.scielo.org/' },
      web_of_science: {
        enabled: true,
        mode: 'api',
        api_url: 'https://api.clarivate.com/apis/wos-starter/v1/documents',
      },
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
  assert.equal(result.summary.sourceCoverage.web_of_science.status, 'skipped');
  assert.match(result.summary.sourceCoverage.web_of_science.reason, /API key not configured/i);
  assert.equal(result.summary.sourceCoverage.acm.status, 'completed');
  assert.equal(fetchCallCount, 0);
});

test('runSearchAndPersist supports Web of Science API mode', async () => {
  const wosPayload = JSON.parse(readFileSync(new URL('./fixtures/web-of-science.json', import.meta.url), 'utf8'));
  const fetchCalls = [];

  const config = loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: false,
    },
    sources: {
      scopus: { enabled: false, mode: 'api', api_url: 'https://api.elsevier.com/content/search/scopus' },
      ieee: { enabled: false, mode: 'api', api_url: 'https://ieeexploreapi.ieee.org/api/v1/search/articles' },
      acm: { enabled: false, mode: 'live', search_url: 'https://dl.acm.org/action/doSearch' },
      google_scholar: { enabled: false, experimental: true, mode: 'live', search_url: 'https://scholar.google.com/scholar' },
      scielo: { enabled: false, mode: 'live', search_url: 'https://search.scielo.org/' },
      web_of_science: {
        enabled: true,
        mode: 'api',
        api_url: 'https://api.clarivate.com/apis/wos-starter/v1/documents',
        api_key: 'wos-test-key',
      },
    },
  });

  const result = await runSearchAndPersist({
    query: '"research agents"',
    config,
    projectRoot: mkdtempSync(join(tmpdir(), 'paper-ops-wos-api-')),
    fixtureDir: FIXTURE_DIR,
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return jsonResponse(wosPayload);
    },
  });

  assert.equal(result.summary.sourceCoverage.web_of_science.status, 'completed');
  assert.equal(result.summary.totalRawRecords, 2);
  assert.equal(result.summary.uniqueRecords, 2);
  assert.equal(result.records[0].source, 'web_of_science');
  assert.equal(result.records[0].doi, '10.5555/wos-alpha');
  assert.equal(result.records[1].title, 'Hybrid Retrieval for Literature Screening');
  assert.equal(fetchCalls.length, 1);
  assert.equal(new URL(fetchCalls[0].url).searchParams.get('q'), 'TS=("research agents")');
  assert.match(fetchCalls[0].url, /[?&]limit=5\b/);
  assert.equal(fetchCalls[0].options.headers['X-ApiKey'], 'wos-test-key');
});

test('runSearchAndPersist supports SciELO API mode without credentials', async () => {
  const scieloPayload = {
    docs: [
      {
        pid: 'S0100-879X2024000100001',
        title: { en: 'Open Science Workflows for Evidence Synthesis' },
        authors: ['Maria Silva', 'Joao Souza'],
        journal_title: 'Brazilian Journal of Research Methods',
        publication_year: '2024',
        doi: '10.1590/0100-879X2024000100001',
        url: 'https://www.scielo.br/j/bjrm/a/scielo-alpha/',
        abstract: { en: 'This article evaluates open science workflows for reproducible evidence synthesis.' },
        pdf_url: 'https://www.scielo.br/j/bjrm/a/scielo-alpha/?format=pdf',
      },
    ],
  };
  const fetchCalls = [];

  const config = loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: false,
    },
    sources: {
      scopus: { enabled: false, mode: 'api', api_url: 'https://api.elsevier.com/content/search/scopus' },
      ieee: { enabled: false, mode: 'api', api_url: 'https://ieeexploreapi.ieee.org/api/v1/search/articles' },
      acm: { enabled: false, mode: 'live', search_url: 'https://dl.acm.org/action/doSearch' },
      google_scholar: { enabled: false, experimental: true, mode: 'live', search_url: 'https://scholar.google.com/scholar' },
      scielo: {
        enabled: true,
        mode: 'api',
        requires_api_key: false,
        api_url: 'https://search.scielo.org/',
      },
      web_of_science: { enabled: false, mode: 'api', api_url: 'https://api.clarivate.com/apis/wos-starter/v1/documents' },
    },
  });

  const result = await runSearchAndPersist({
    query: 'machine learning',
    config,
    projectRoot: mkdtempSync(join(tmpdir(), 'paper-ops-scielo-api-')),
    fixtureDir: FIXTURE_DIR,
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return jsonResponse(scieloPayload);
    },
  });

  assert.equal(result.summary.sourceCoverage.scielo.status, 'completed');
  assert.equal(result.summary.totalRawRecords, 1);
  assert.equal(result.records[0].source, 'scielo');
  assert.equal(result.records[0].doi, '10.1590/0100-879x2024000100001');
  assert.equal(result.records[0].pdf_available, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(new URL(fetchCalls[0].url).searchParams.get('format'), 'json');
  assert.equal(new URL(fetchCalls[0].url).searchParams.get('count'), '5');
  assert.deepEqual(fetchCalls[0].options.headers, {});
});
