import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  digestQueryArticles,
  fetchQueryPdfs,
  summarizeQueryArticles,
} from '../src/lib/article-digest.mjs';

const QUERY = '"software testing" AND ai';

const SEARCH_EXPORT = {
  query: QUERY,
  generatedAt: '2026-04-27T10:00:00.000Z',
  summary: {
    totalRawRecords: 3,
    duplicatesRemoved: 0,
    uniqueRecords: 3,
    removedByRule: {
      doi: 0,
      sourceIdentity: 0,
      titleYear: 0,
    },
    sourceCoverage: {
      scopus: {
        status: 'completed',
        reason: '',
        records: 1,
      },
      google_scholar: {
        status: 'completed',
        reason: '',
        records: 1,
      },
      acm: {
        status: 'completed',
        reason: '',
        records: 1,
      },
    },
  },
  records: [
    {
      source: 'scopus',
      source_id: 'SCOPUS-ALPHA',
      title: 'AI-Augmented Software Testing Pipelines',
      authors: ['Ada Lovelace'],
      year: 2025,
      venue: 'Journal of AI Testing',
      doi: '10.1000/alpha',
      url: 'https://example.org/alpha',
      abstract: 'A paper about AI-assisted software testing.',
      pdf_available: true,
      pdf_url: 'https://example.org/alpha.pdf',
      matched_query: QUERY,
      retrieved_at: '2026-04-27T10:00:00.000Z',
    },
    {
      source: 'google_scholar',
      source_id: 'SCHOLAR-BETA',
      title: 'Manual Regression Testing on Legacy Platforms',
      authors: ['Grace Hopper'],
      year: 2022,
      venue: 'Legacy QA Review',
      doi: '',
      url: 'https://example.org/beta',
      abstract: 'A paper without a direct PDF link.',
      pdf_available: null,
      pdf_url: '',
      matched_query: QUERY,
      retrieved_at: '2026-04-27T10:00:00.000Z',
    },
    {
      source: 'acm',
      source_id: 'ACM-GAMMA',
      title: 'Article Page Abstract Enrichment for QA Research',
      authors: ['Margaret Hamilton'],
      year: 2024,
      venue: 'ACM QA Notes',
      doi: '',
      url: 'https://example.org/gamma',
      abstract: '',
      pdf_available: null,
      pdf_url: '',
      matched_query: QUERY,
      retrieved_at: '2026-04-27T10:00:00.000Z',
    },
  ],
};

function createTempProjectRoot() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-digest-'));
  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  writeFileSync(join(projectRoot, 'output', 'saved-run.json'), JSON.stringify(SEARCH_EXPORT, null, 2), 'utf8');
  return projectRoot;
}

function buildPdfResponse(body = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF') {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
    },
  });
}

test('fetchQueryPdfs downloads cached PDF artifacts for matching saved query results', async () => {
  const projectRoot = createTempProjectRoot();

  const result = await fetchQueryPdfs({
    projectRoot,
    query: QUERY,
    fetchImpl: async (url) => {
      assert.equal(url, 'https://example.org/alpha.pdf');
      return buildPdfResponse();
    },
  });

  assert.equal(result.summary.downloaded, 1);
  assert.equal(result.summary.cached, 0);
  assert.equal(result.summary.skippedNoPdf, 2);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.articles.length, 3);
  assert.equal(result.articles[0].pdf.status, 'downloaded');
  assert.ok(existsSync(result.articles[0].pdf.path));
  assert.equal(result.articles[1].pdf.status, 'skipped');
  assert.equal(result.articles[2].pdf.status, 'skipped');
});

test('summarizeQueryArticles extracts text and writes structured article summaries', async () => {
  const projectRoot = createTempProjectRoot();

  const result = await summarizeQueryArticles({
    projectRoot,
    query: QUERY,
    now: new Date('2026-04-27T12:00:00.000Z'),
    fetchImpl: async (url) => {
      if (url === 'https://example.org/alpha.pdf') {
        return buildPdfResponse();
      }

      return new Response(
        '<html><head><meta name="description" content="This landing page exposes an abstract for a QA research article."><meta name="citation_abstract" content="This landing page exposes an abstract for a QA research article."></head><body><section class="abstract">This landing page exposes an abstract for a QA research article.</section></body></html>',
        {
          status: 200,
          headers: {
            'content-type': 'text/html',
          },
        },
      );
    },
    extractTextImpl: async () =>
      'Objective: study AI-assisted software testing.\nMethod: multi-case analysis.\nFindings: AI shortens regression cycles.\nLimitations: small sample.\nContribution: practical pipeline guidance.',
    articleSummarizer: async ({ record, text }) => ({
      objective: `Objective for ${record.title}`,
      method: 'Multi-case analysis across automated test suites.',
      dataset_or_context: text.includes('No PDF was available')
        ? 'Metadata-only abstract fallback.'
        : 'Industrial web application regression pipelines.',
      key_findings: ['AI reduced regression execution time.', 'Teams reused prompts for flaky test analysis.'],
      limitations: ['Single-domain evaluation.'],
      contribution: 'Provides an operational framework for AI-assisted testing pipelines.',
      keywords: ['software testing', 'ai'],
    }),
  });

  assert.equal(result.summary.textExtracted, 3);
  assert.equal(result.summary.textCached, 0);
  assert.equal(result.summary.textFailed, 0);
  assert.equal(result.summary.summarized, 3);
  assert.equal(result.summary.summaryFailed, 0);
  assert.ok(existsSync(result.articles[0].text.path));
  assert.ok(existsSync(result.articles[0].summary.jsonPath));
  assert.ok(existsSync(result.articles[0].summary.markdownPath));
  assert.ok(existsSync(result.articles[1].text.path));
  assert.ok(existsSync(result.articles[1].summary.jsonPath));
  assert.ok(existsSync(result.articles[2].text.path));
  assert.ok(existsSync(result.articles[2].summary.jsonPath));

  const summaryJson = JSON.parse(readFileSync(result.articles[0].summary.jsonPath, 'utf8'));
  const summaryMarkdown = readFileSync(result.articles[0].summary.markdownPath, 'utf8');
  const abstractText = readFileSync(result.articles[1].text.path, 'utf8');
  const landingPageText = readFileSync(result.articles[2].text.path, 'utf8');

  assert.equal(summaryJson.sections.objective, 'Objective for AI-Augmented Software Testing Pipelines');
  assert.equal(summaryJson.sections.key_findings.length, 2);
  assert.match(summaryMarkdown, /Objective/);
  assert.match(summaryMarkdown, /AI-Augmented Software Testing Pipelines/);
  assert.match(abstractText, /No PDF was available/);
  assert.match(abstractText, /A paper without a direct PDF link/);
  assert.match(landingPageText, /landing page exposes an abstract/i);
  assert.equal(result.articles[1].text.source, 'record_abstract');
  assert.equal(result.articles[2].text.source, 'landing_page_abstract');
});

test('digestQueryArticles creates a consolidated digest for one saved search string', async () => {
  const projectRoot = createTempProjectRoot();

  const result = await digestQueryArticles({
    projectRoot,
    query: QUERY,
    now: new Date('2026-04-27T13:00:00.000Z'),
    fetchImpl: async (url) => {
      if (url === 'https://example.org/alpha.pdf') {
        return buildPdfResponse();
      }

      return new Response(
        '<html><head><meta name="citation_abstract" content="This landing page exposes an abstract for a QA research article."></head><body><section class="abstract">This landing page exposes an abstract for a QA research article.</section></body></html>',
        {
          status: 200,
          headers: {
            'content-type': 'text/html',
          },
        },
      );
    },
    extractTextImpl: async () =>
      'Objective: study AI-assisted software testing.\nMethod: multi-case analysis.\nFindings: AI shortens regression cycles.\nLimitations: small sample.\nContribution: practical pipeline guidance.',
    articleSummarizer: async ({ record }) => ({
      objective: `Objective for ${record.title}`,
      method: 'Multi-case analysis across automated test suites.',
      dataset_or_context: 'Industrial web application regression pipelines.',
      key_findings: ['AI reduced regression execution time.', 'Teams reused prompts for flaky test analysis.'],
      limitations: ['Single-domain evaluation.'],
      contribution: 'Provides an operational framework for AI-assisted testing pipelines.',
      keywords: ['software testing', 'ai'],
    }),
    digestSummarizer: async () => ({
      overview: 'The saved articles focus on operational uses of AI in regression-heavy testing workflows.',
      common_themes: ['AI-assisted regression testing', 'Prompt reuse in QA pipelines'],
      common_methods: ['Case study synthesis'],
      evidence_gaps: ['Limited cross-domain validation'],
      recommended_next_reads: ['Look for broader empirical comparisons across domains.'],
    }),
  });

  assert.equal(result.summary.digestGenerated, 1);
  assert.ok(existsSync(result.artifacts.digestMarkdown));
  assert.ok(existsSync(result.artifacts.digestJson));

  const digestJson = JSON.parse(readFileSync(result.artifacts.digestJson, 'utf8'));
  const digestMarkdown = readFileSync(result.artifacts.digestMarkdown, 'utf8');

  assert.equal(digestJson.articleSummaries.length, 3);
  assert.equal(
    digestJson.crossPaperSummary.overview,
    'The saved articles focus on operational uses of AI in regression-heavy testing workflows.',
  );
  assert.match(digestMarkdown, /Academic Paper Digest/);
  assert.match(digestMarkdown, /AI-assisted regression testing/);
});

test('summarizeQueryArticles falls back to Playwright article-page extraction when fetch HTML is insufficient', async () => {
  const projectRoot = createTempProjectRoot();
  const browserCalls = [];

  const result = await summarizeQueryArticles({
    projectRoot,
    query: QUERY,
    now: new Date('2026-04-27T14:00:00.000Z'),
    fetchImpl: async (url) => {
      if (url === 'https://example.org/alpha.pdf') {
        return buildPdfResponse();
      }

      return new Response('<html><body><p>No useful abstract here.</p></body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html',
        },
      });
    },
    browserRuntime: {
      async extractArticlePage({ sourceName, articleUrl, extractor, contextData }) {
        browserCalls.push({ sourceName, articleUrl });
        const page = {
          async content() {
            return '<html><head><meta name="citation_abstract" content="Browser fallback abstract for the article page."></head><body><button>Abstract</button><section class="abstract">Browser fallback abstract for the article page.</section></body></html>';
          },
        };
        return extractor(page, contextData);
      },
      async close() {},
    },
    extractTextImpl: async () =>
      'Objective: study AI-assisted software testing.\nMethod: multi-case analysis.\nFindings: AI shortens regression cycles.\nLimitations: small sample.\nContribution: practical pipeline guidance.',
    articleSummarizer: async ({ record }) => ({
      objective: `Objective for ${record.title}`,
      method: 'Multi-case analysis across automated test suites.',
      dataset_or_context: 'Browser-enriched abstract fallback.',
      key_findings: ['AI reduced regression execution time.'],
      limitations: ['Single-domain evaluation.'],
      contribution: 'Provides an operational framework for AI-assisted testing pipelines.',
      keywords: ['software testing', 'ai'],
    }),
  });

  assert.equal(browserCalls.length, 1);
  assert.equal(browserCalls[0].sourceName, 'acm');
  assert.equal(browserCalls[0].articleUrl, 'https://example.org/gamma');
  assert.equal(result.articles[2].text.source, 'landing_page_abstract');
  assert.match(readFileSync(result.articles[2].text.path, 'utf8'), /Browser fallback abstract for the article page/);
});
