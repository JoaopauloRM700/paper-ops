import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSearchAndPersist } from '../src/lib/search-runner.mjs';
import { loadSourcesConfig } from '../src/lib/config.mjs';
import { extractAcmResultsFromPage } from '../src/lib/adapters/acm.mjs';
import { extractIeeeResultsFromPage } from '../src/lib/adapters/ieee.mjs';
import { extractGoogleScholarResultsFromPage } from '../src/lib/adapters/google-scholar.mjs';
import { extractScopusResultsFromPage } from '../src/lib/adapters/scopus.mjs';

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);
const RETRIEVED_AT = '2026-04-17T18:00:00.000Z';

function createFixturePage(fixtureName, pageUrl) {
  const html = readFileSync(new URL(`./fixtures/${fixtureName}`, import.meta.url), 'utf8');
  return {
    async content() {
      return html;
    },
    url() {
      return pageUrl;
    },
  };
}

function createFixtureBrowserRuntime(htmlMap) {
  return {
    async runSearch({ sourceName, extractor, query, limit, retrievedAt }) {
      const fixtureName = htmlMap[sourceName];
      const page = createFixturePage(fixtureName, `https://example.org/${sourceName}`);
      return extractor(page, { query, limit, retrievedAt });
    },
  };
}

test('browser extractors normalize Scopus, IEEE, ACM, and Scholar result pages', async () => {
  const scopusRecords = await extractScopusResultsFromPage(
    createFixturePage('scopus-search.html', 'https://www.scopus.com/results/results.uri'),
    {
      query: '"systematic review" AND rag',
      limit: 5,
      retrievedAt: RETRIEVED_AT,
    },
  );
  const ieeeRecords = await extractIeeeResultsFromPage(
    createFixturePage('ieee-search.html', 'https://ieeexplore.ieee.org/search/searchresult.jsp'),
    {
      query: '"systematic review" AND rag',
      limit: 5,
      retrievedAt: RETRIEVED_AT,
    },
  );
  const acmRecords = await extractAcmResultsFromPage(
    createFixturePage('acm-search.html', 'https://dl.acm.org/action/doSearch'),
    {
      query: '"systematic review" AND rag',
      limit: 5,
      retrievedAt: RETRIEVED_AT,
    },
  );
  const scholarRecords = await extractGoogleScholarResultsFromPage(
    createFixturePage('scholar-search.html', 'https://scholar.google.com/scholar'),
    {
      query: '"systematic review" AND rag',
      limit: 5,
      retrievedAt: RETRIEVED_AT,
    },
  );

  assert.equal(scopusRecords[0].source, 'scopus');
  assert.equal(scopusRecords[0].doi, '10.1000/alpha');
  assert.equal(scopusRecords[0].pdf_available, null);
  assert.equal(ieeeRecords[1].source_id, 'IEEE-GAMMA');
  assert.equal(ieeeRecords[0].pdf_available, true);
  assert.equal(ieeeRecords[0].pdf_url, 'https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=IEEE-ALPHA');
  assert.equal(acmRecords[0].title, 'Knowledge Graphs for Literature Screening');
  assert.equal(acmRecords[0].pdf_available, true);
  assert.equal(acmRecords[0].pdf_url, 'https://dl.acm.org/doi/pdf/ACM-BETA');
  assert.equal(scholarRecords[0].authors[0], 'Donald Knuth');
  assert.equal(scholarRecords[0].pdf_available, null);
});

test('runSearchAndPersist supports browser live mode without API credentials', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-browser-'));
  const browserRuntime = createFixtureBrowserRuntime({
    scopus: 'scopus-search.html',
    ieee: 'ieee-search.html',
    acm: 'acm-search.html',
    google_scholar: 'scholar-search.html',
  });

  const config = loadSourcesConfig({
    defaults: {
      per_source_limit: 5,
      fixture_mode: false,
    },
    sources: {
      scopus: { enabled: true, mode: 'live', search_url: 'https://www.scopus.com/results/results.uri' },
      ieee: { enabled: true, mode: 'live', search_url: 'https://ieeexplore.ieee.org/search/searchresult.jsp' },
      acm: { enabled: true, mode: 'live', search_url: 'https://dl.acm.org/action/doSearch' },
      google_scholar: { enabled: true, experimental: true, mode: 'live', search_url: 'https://scholar.google.com/scholar' },
    },
  });

  const result = await runSearchAndPersist({
    query: '"knowledge graph" AND screening',
    config,
    projectRoot,
    fixtureDir: FIXTURE_DIR,
    browserRuntime,
    now: new Date(RETRIEVED_AT),
  });

  assert.equal(result.summary.sourceCoverage.scopus.status, 'completed');
  assert.equal(result.summary.sourceCoverage.ieee.status, 'completed');
  assert.equal(result.summary.sourceCoverage.acm.status, 'completed');
  assert.equal(result.summary.sourceCoverage.google_scholar.status, 'completed');
  assert.equal(result.summary.totalRawRecords, 7);
  assert.equal(result.summary.uniqueRecords, 5);
  assert.equal(result.records[0].pdf_available, true);
  assert.equal(result.records[0].pdf_url, 'https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=IEEE-ALPHA');
  assert.equal(result.records[1].pdf_available, true);
  assert.equal(result.records[1].pdf_url, 'https://dl.acm.org/doi/pdf/ACM-BETA');
});
