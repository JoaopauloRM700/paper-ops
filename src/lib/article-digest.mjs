import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { summarizeArticleText, summarizeSearchDigest } from './article-summarizer.mjs';
import { createPlaywrightBrowserRuntime } from './browser-runtime.mjs';
import { readSourcesConfig } from './config.mjs';
import { readSavedSearchExports } from './csv-export.mjs';
import { deduplicatePaperRecords } from './papers.mjs';
import { extractTextFromPdfFile } from './pdf-extractor.mjs';

function normalizeQuery(query) {
  return String(query ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value) {
  return normalizeText(decodeHtmlEntities(String(value ?? '').replace(/<[^>]+>/g, ' ')));
}

function slugify(input, maxLength = 64) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

function parseGeneratedAt(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function looksLikePdf(buffer) {
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

function looksUsefulAbstract(text, minimumCharacters = 40) {
  return normalizeText(text).length >= minimumCharacters;
}

function buildArticleArtifactId(record) {
  if (record.doi) {
    return `doi-${slugify(record.doi, 80)}`;
  }

  if (record.source_id) {
    return `${slugify(record.source, 24)}-${slugify(record.source_id, 80)}`;
  }

  return `${slugify(record.source, 24)}-${slugify(record.title || 'paper', 80)}-${record.year ?? 'unknown'}`;
}

function buildRunId(query, now, suffix) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${now.toISOString().slice(0, 10)}-${slugify(query, 48) || 'query'}-${timestamp}-${suffix}`;
}

function ensureArtifactDirs(projectRoot) {
  const directories = {
    pdfDir: join(projectRoot, 'output', 'pdfs'),
    textDir: join(projectRoot, 'output', 'pdf-text'),
    summaryJsonDir: join(projectRoot, 'output', 'article-summaries'),
    digestJsonDir: join(projectRoot, 'output', 'digests'),
    summaryMarkdownDir: join(projectRoot, 'reports', 'article-summaries'),
    digestMarkdownDir: join(projectRoot, 'reports', 'digests'),
  };

  for (const directory of Object.values(directories)) {
    mkdirSync(directory, { recursive: true });
  }

  return directories;
}

function resolveSavedQueryRecords(projectRoot, query) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    throw new Error('A search query is required.');
  }

  const matchingExports = readSavedSearchExports(projectRoot)
    .filter((entry) => entry.queryKey === normalizedQuery)
    .sort((left, right) => parseGeneratedAt(right.generatedAt) - parseGeneratedAt(left.generatedAt));

  if (matchingExports.length === 0) {
    throw new Error(`No saved search results found for query: ${query}`);
  }

  const rawRecords = matchingExports.flatMap((entry) => entry.records);
  const deduped = deduplicatePaperRecords(rawRecords);
  const profile = matchingExports.find((entry) => entry.profile)?.profile ?? null;

  return {
    query,
    matchedFiles: matchingExports.map((entry) => entry.filePath),
    profile,
    rawRecords,
    records: deduped.uniqueRecords,
    duplicatesRemoved: deduped.stats.duplicatesRemoved,
  };
}

function resolveDigestConfig(projectRoot) {
  try {
    return readSourcesConfig(projectRoot);
  } catch {
    return {
      defaults: {
        browser_settle_time_ms: 1500,
        browser_navigation_timeout_ms: 30000,
      },
      sources: {},
    };
  }
}

function createArticleState(record) {
  return {
    articleId: buildArticleArtifactId(record),
    record,
    pdf: {
      url: record.pdf_url || '',
      status: record.pdf_url ? 'pending' : 'skipped',
      path: '',
      error: record.pdf_url ? '' : 'No PDF URL available for this record.',
    },
    text: {
      status: 'skipped',
      path: '',
      characters: 0,
      source: '',
      error: '',
    },
    summary: {
      status: 'skipped',
      jsonPath: '',
      markdownPath: '',
      error: '',
      sections: null,
    },
  };
}

function countByStatus(articles, selector, status) {
  return articles.filter((article) => selector(article)?.status === status).length;
}

function buildFetchSummary(articles) {
  return {
    downloaded: countByStatus(articles, (article) => article.pdf, 'downloaded'),
    cached: countByStatus(articles, (article) => article.pdf, 'cached'),
    skippedNoPdf: articles.filter((article) => article.pdf.status === 'skipped').length,
    failed: countByStatus(articles, (article) => article.pdf, 'failed'),
  };
}

function buildSummarizeSummary(articles, digestGenerated = 0) {
  return {
    downloaded: countByStatus(articles, (article) => article.pdf, 'downloaded'),
    cached: countByStatus(articles, (article) => article.pdf, 'cached'),
    skippedNoPdf: articles.filter((article) => article.pdf.status === 'skipped').length,
    failed: countByStatus(articles, (article) => article.pdf, 'failed'),
    textExtracted: countByStatus(articles, (article) => article.text, 'extracted'),
    textCached: countByStatus(articles, (article) => article.text, 'cached'),
    textFailed: countByStatus(articles, (article) => article.text, 'failed'),
    textFromPdf: articles.filter((article) => ['pdf', 'pdf_cached'].includes(article.text.source)).length,
    textFromRecordAbstract: articles.filter((article) => article.text.source === 'record_abstract').length,
    textFromLandingPageAbstract: articles.filter((article) => article.text.source === 'landing_page_abstract').length,
    summarized: countByStatus(articles, (article) => article.summary, 'completed'),
    summaryFailed: countByStatus(articles, (article) => article.summary, 'failed'),
    digestGenerated,
  };
}

function buildArticleSummaryPlainText({ record, generatedAt, sections }) {
  const findings = sections.key_findings.map((item) => `- ${item}`).join('\n') || '- unknown';
  const limitations = sections.limitations.map((item) => `- ${item}`).join('\n') || '- unknown';
  const keywords = sections.keywords.join(', ') || 'unknown';

  return `ARTICLE SUMMARY: ${record.title}

SOURCE: ${record.source}
YEAR: ${record.year ?? 'unknown'}
VENUE: ${record.venue || 'unknown'}
GENERATED AT: ${generatedAt}

OBJECTIVE:
${sections.objective}

METHOD:
${sections.method}

CONTEXT:
${sections.dataset_or_context}

KEY FINDINGS:
${findings}

LIMITATIONS:
${limitations}

CONTRIBUTION:
${sections.contribution}

KEYWORDS:
${keywords}
`;
}

function buildArticleSummaryMarkdown({ record, generatedAt, pdfPath, textPath, textSource, sections }) {
  const findings = sections.key_findings.map((item) => `- ${item}`).join('\n') || '- unknown';
  const limitations = sections.limitations.map((item) => `- ${item}`).join('\n') || '- unknown';
  const keywords = sections.keywords.map((item) => `- ${item}`).join('\n') || '- unknown';

  return `# Article Summary

**Title:** ${record.title}
**Source:** ${record.source}
**Year:** ${record.year ?? 'unknown'}
**Venue:** ${record.venue || 'unknown'}
**DOI:** ${record.doi || 'unknown'}
**Generated At:** ${generatedAt}
**PDF Path:** ${pdfPath}
**Text Path:** ${textPath}
**Text Source:** ${textSource || 'unknown'}

## Objective

${sections.objective}

## Method

${sections.method}

## Dataset / Context

${sections.dataset_or_context}

## Key Findings

${findings}

## Limitations

${limitations}

## Contribution

${sections.contribution}

## Keywords

${keywords}
`;
}

function buildDigestMarkdown({ query, generatedAt, crossPaperSummary, articleSummaries }) {
  const themes = crossPaperSummary.common_themes.map((item) => `- ${item}`).join('\n') || '- unknown';
  const methods = crossPaperSummary.common_methods.map((item) => `- ${item}`).join('\n') || '- unknown';
  const gaps = crossPaperSummary.evidence_gaps.map((item) => `- ${item}`).join('\n') || '- unknown';
  const nextReads = crossPaperSummary.recommended_next_reads.map((item) => `- ${item}`).join('\n') || '- unknown';
  const articleSection = articleSummaries
    .map((entry, index) => {
      const findings = entry.sections.key_findings.map((item) => `  - ${item}`).join('\n') || '  - unknown';
      return `### ${index + 1}. ${entry.record.title}

- Source: ${entry.record.source}
- Year: ${entry.record.year ?? 'unknown'}
- Objective: ${entry.sections.objective}
- Method: ${entry.sections.method}
- Contribution: ${entry.sections.contribution}
- Summary JSON: ${entry.summary.jsonPath}
- Summary Markdown: ${entry.summary.markdownPath}
- PDF Path: ${entry.pdfPath}
- Text Path: ${entry.textPath}
- Text Source: ${entry.textSource}
- Key Findings:
${findings}`;
    })
    .join('\n\n');

  return `# Academic Paper Digest

**Query:** ${query}
**Generated At:** ${generatedAt}
**Articles Summarized:** ${articleSummaries.length}

## Cross-Paper Overview

${crossPaperSummary.overview}

## Common Themes

${themes}

## Common Methods

${methods}

## Evidence Gaps

${gaps}

## Recommended Next Reads

${nextReads}

## Article Summaries

${articleSection}
`;
}

function buildFallbackTextFromAbstract(record, abstractText, sourceLabel) {
  return [
    `Title: ${record.title || 'unknown'}`,
    `Source: ${record.source || 'unknown'}`,
    `Year: ${record.year ?? 'unknown'}`,
    `Venue: ${record.venue || 'unknown'}`,
    `DOI: ${record.doi || 'unknown'}`,
    `URL: ${record.url || 'unknown'}`,
    '',
    `No PDF was available. The summary must rely on ${sourceLabel}.`,
    '',
    'Available abstract / description:',
    abstractText,
  ].join('\n');
}

async function clickFirstMatchingLocator(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible({ timeout: 1000 }).catch(() => false);
      if (!visible) {
        continue;
      }

      await locator.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(400).catch(() => {});
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function attemptArticlePageInteractions(page) {
  const cookieSelectors = [
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Continue")',
    'button:has-text("OK")',
    '[aria-label*="accept" i]',
  ];
  const abstractSelectors = [
    'button:has-text("Abstract")',
    'a:has-text("Abstract")',
    'button:has-text("Show abstract")',
    'a:has-text("Show abstract")',
    'button:has-text("View abstract")',
    'a:has-text("View abstract")',
    'button:has-text("Show more")',
    'a:has-text("Show more")',
    'button:has-text("Expand")',
    'a:has-text("Expand")',
    '[aria-expanded="false"]',
  ];

  await clickFirstMatchingLocator(page, cookieSelectors);
  await clickFirstMatchingLocator(page, abstractSelectors);
}

async function extractLandingPageAbstractFromBrowserPage(page, { record }) {
  const abstractText = extractLandingPageAbstractFromHtml(await page.content());
  if (!looksUsefulAbstract(abstractText, 40)) {
    return '';
  }

  return buildFallbackTextFromAbstract(record, abstractText, 'the article landing page abstract');
}

function extractLandingPageAbstractFromHtml(html) {
  const rawHtml = String(html ?? '');
  const metaPatterns = [
    /<meta[^>]+name=["']citation_abstract["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']citation_abstract["'][^>]*>/i,
    /<meta[^>]+name=["']dc\.description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']dc\.description["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i,
  ];

  for (const pattern of metaPatterns) {
    const match = rawHtml.match(pattern);
    const text = stripHtml(match?.[1] ?? '');
    if (looksUsefulAbstract(text, 40)) {
      return text;
    }
  }

  const blockPatterns = [
    /<(?:section|div|p)[^>]+(?:id|class)=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div|p)>/i,
    /<(?:section|div)[^>]+(?:id|class)=["'][^"']*summary[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div)>/i,
  ];

  for (const pattern of blockPatterns) {
    const match = rawHtml.match(pattern);
    const text = stripHtml(match?.[1] ?? '');
    if (looksUsefulAbstract(text, 40)) {
      return text;
    }
  }

  return '';
}

async function extractFallbackTextFromArticlePage(record, fetchImpl) {
  if (!record.url) {
    return '';
  }

  const response = await fetchImpl(record.url);
  if (!response.ok) {
    throw new Error(`Article page request failed with HTTP ${response.status}.`);
  }

  const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
  if (!contentType.includes('html') && !contentType.includes('xml') && !contentType.includes('text')) {
    throw new Error('Article page did not return HTML content.');
  }

  const html = await response.text();
  const abstractText = extractLandingPageAbstractFromHtml(html);
  if (!looksUsefulAbstract(abstractText, 40)) {
    return '';
  }

  return buildFallbackTextFromAbstract(record, abstractText, 'the article landing page abstract');
}

async function extractFallbackTextFromArticlePageViaBrowser(record, browserRuntime, sourceConfig = {}, defaultConfig = {}) {
  if (!browserRuntime || !record.url) {
    return '';
  }

  return browserRuntime.extractArticlePage({
    sourceName: record.source,
    articleUrl: record.url,
    extractor: extractLandingPageAbstractFromBrowserPage,
    waitForSelector: sourceConfig.article_page_wait_for_selector ?? sourceConfig.wait_for_selector ?? 'body',
    settleTimeMs: sourceConfig.article_page_settle_time_ms ?? sourceConfig.settle_time_ms ?? defaultConfig.browser_settle_time_ms,
    navigationTimeoutMs: sourceConfig.article_page_navigation_timeout_ms ?? defaultConfig.browser_navigation_timeout_ms,
    beforeExtract: attemptArticlePageInteractions,
    contextData: {
      record,
    },
  });
}

async function ensureArticleText({
  article,
  directories,
  query,
  projectRoot,
  fetchImpl,
  extractTextImpl,
  browserRuntimeResolver,
  sourceConfig,
  defaultConfig,
}) {
  article.text.path = join(directories.textDir, `${article.articleId}.txt`);

  if (existsSync(article.text.path)) {
    const cachedText = readFileSync(article.text.path, 'utf8');
    article.text.status = 'cached';
    article.text.characters = cachedText.length;
    article.text.source = article.pdf.path ? 'pdf_cached' : article.record.abstract ? 'record_abstract' : 'landing_page_abstract';
    article.text.error = '';
    return cachedText;
  }

  if (article.pdf.path && ['downloaded', 'cached'].includes(article.pdf.status)) {
    const extractedText = await extractTextImpl(article.pdf.path, {
      record: article.record,
      articleId: article.articleId,
      query,
      projectRoot,
    });
    writeFileSync(article.text.path, extractedText, 'utf8');
    article.text.status = 'extracted';
    article.text.characters = extractedText.length;
    article.text.source = article.pdf.status === 'cached' ? 'pdf_cached' : 'pdf';
    article.text.error = '';
    return extractedText;
  }

  const recordAbstract = normalizeText(article.record.abstract);
  if (looksUsefulAbstract(recordAbstract, 15)) {
    const fallbackText = buildFallbackTextFromAbstract(article.record, recordAbstract, 'the saved record abstract');
    writeFileSync(article.text.path, fallbackText, 'utf8');
    article.text.status = 'extracted';
    article.text.characters = fallbackText.length;
    article.text.source = 'record_abstract';
    article.text.error = '';
    return fallbackText;
  }

  let landingPageText = await extractFallbackTextFromArticlePage(article.record, fetchImpl);
  if (!looksUsefulAbstract(landingPageText, 40)) {
    const browserRuntime = typeof browserRuntimeResolver === 'function'
      ? await browserRuntimeResolver()
      : null;
    landingPageText = await extractFallbackTextFromArticlePageViaBrowser(
      article.record,
      browserRuntime,
      sourceConfig,
      defaultConfig,
    );
  }

  if (looksUsefulAbstract(landingPageText, 40)) {
    writeFileSync(article.text.path, landingPageText, 'utf8');
    article.text.status = 'extracted';
    article.text.characters = landingPageText.length;
    article.text.source = 'landing_page_abstract';
    article.text.error = '';
    return landingPageText;
  }

  throw new Error('No usable PDF text or abstract was available for this article.');
}

export async function fetchQueryPdfs({ projectRoot, query, fetchImpl = fetch } = {}) {
  const recordSet = resolveSavedQueryRecords(projectRoot, query);
  const directories = ensureArtifactDirs(projectRoot);
  const articles = recordSet.records.map(createArticleState);

  for (const article of articles) {
    if (!article.pdf.url) {
      continue;
    }

    article.pdf.path = join(directories.pdfDir, `${article.articleId}.pdf`);

    if (existsSync(article.pdf.path)) {
      article.pdf.status = 'cached';
      article.pdf.error = '';
      continue;
    }

    try {
      const response = await fetchImpl(article.pdf.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
      if (!looksLikePdf(buffer) && !contentType.includes('application/pdf')) {
        throw new Error('The PDF URL did not return a PDF document.');
      }

      writeFileSync(article.pdf.path, buffer);
      article.pdf.status = 'downloaded';
      article.pdf.error = '';
    } catch (error) {
      article.pdf.status = 'failed';
      article.pdf.error = error instanceof Error ? error.message : String(error);
      article.pdf.path = '';
    }
  }

  return {
    ...recordSet,
    articles,
    summary: buildFetchSummary(articles),
    artifacts: {
      pdfDirectory: directories.pdfDir,
    },
  };
}

export async function summarizeQueryArticles({
  projectRoot,
  query,
  now = new Date(),
  fetchImpl = fetch,
  extractTextImpl = extractTextFromPdfFile,
  articleSummarizer = summarizeArticleText,
  browserRuntime,
  browserFactory = createPlaywrightBrowserRuntime,
} = {}) {
  const fetchResult = await fetchQueryPdfs({
    projectRoot,
    query,
    fetchImpl,
  });
  const directories = ensureArtifactDirs(projectRoot);
  const runtimeConfig = resolveDigestConfig(projectRoot);
  let ownedBrowserRuntime = null;

  async function getBrowserRuntime() {
    if (browserRuntime) {
      return browserRuntime;
    }

    if (!ownedBrowserRuntime) {
      ownedBrowserRuntime = await browserFactory(runtimeConfig.defaults);
    }

    return ownedBrowserRuntime;
  }

  try {
    for (const article of fetchResult.articles) {
      let text = '';
      const sourceConfig = runtimeConfig.sources?.[article.record.source] ?? {};
      try {
        text = await ensureArticleText({
          article,
          directories,
          query,
          projectRoot,
          fetchImpl,
          extractTextImpl,
          browserRuntimeResolver: getBrowserRuntime,
          sourceConfig,
          defaultConfig: runtimeConfig.defaults,
        });
      } catch (error) {
        article.text.status = 'failed';
        article.text.error = error instanceof Error ? error.message : String(error);
        article.text.path = '';
      }

      if (!article.text.path || !['cached', 'extracted'].includes(article.text.status)) {
        article.summary.status = 'failed';
        article.summary.error = article.text.error || 'Text extraction failed.';
        continue;
      }

      try {
        const sections = await articleSummarizer({
          record: article.record,
          text,
          projectRoot,
          query,
          articleId: article.articleId,
          profile: fetchResult.profile,
        });
        const summaryJsonPath = join(directories.summaryJsonDir, `${article.articleId}.json`);
        const summaryMarkdownPath = join(directories.summaryMarkdownDir, `${article.articleId}.md`);
        const summaryTextPath = join(directories.summaryJsonDir, `${article.articleId}.txt`);
        const summaryPayload = {
          articleId: article.articleId,
          query,
          generatedAt: now.toISOString(),
          record: article.record,
          sections,
          pdfPath: article.pdf.path,
          textPath: article.text.path,
          textSource: article.text.source,
        };

        writeFileSync(summaryJsonPath, JSON.stringify(summaryPayload, null, 2), 'utf8');
        writeFileSync(
          summaryMarkdownPath,
          buildArticleSummaryMarkdown({
            record: article.record,
            generatedAt: now.toISOString(),
            pdfPath: article.pdf.path,
            textPath: article.text.path,
            textSource: article.text.source,
            sections,
          }),
          'utf8',
        );
        writeFileSync(
          summaryTextPath,
          buildArticleSummaryPlainText({
            record: article.record,
            generatedAt: now.toISOString(),
            sections,
          }),
          'utf8',
        );

        article.summary.status = 'completed';
        article.summary.jsonPath = summaryJsonPath;
        article.summary.markdownPath = summaryMarkdownPath;
        article.summary.textPath = summaryTextPath;
        article.summary.error = '';
        article.summary.sections = sections;
      } catch (error) {
        article.summary.status = 'failed';
        article.summary.error = error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    if (ownedBrowserRuntime) {
      await ownedBrowserRuntime.close();
    }
  }

  return {
    ...fetchResult,
    summary: buildSummarizeSummary(fetchResult.articles),
    artifacts: {
      ...fetchResult.artifacts,
      textDirectory: directories.textDir,
      summaryJsonDirectory: directories.summaryJsonDir,
      summaryTextDirectory: directories.summaryJsonDir,
      summaryMarkdownDirectory: directories.summaryMarkdownDir,
    },
  };
}

export async function digestQueryArticles({
  projectRoot,
  query,
  now = new Date(),
  fetchImpl = fetch,
  extractTextImpl = extractTextFromPdfFile,
  articleSummarizer = summarizeArticleText,
  digestSummarizer = summarizeSearchDigest,
  browserRuntime,
  browserFactory = createPlaywrightBrowserRuntime,
} = {}) {
  const summaryResult = await summarizeQueryArticles({
    projectRoot,
    query,
    now,
    fetchImpl,
    extractTextImpl,
    articleSummarizer,
    browserRuntime,
    browserFactory,
  });
  const directories = ensureArtifactDirs(projectRoot);
  const successfulArticles = summaryResult.articles.filter((article) => article.summary.status === 'completed');

  if (successfulArticles.length === 0) {
    throw new Error('No article summaries were generated, so a digest could not be created.');
  }

  const articleSummaries = successfulArticles.map((article) => ({
    articleId: article.articleId,
    record: article.record,
    sections: article.summary.sections,
    pdfPath: article.pdf.path,
    textPath: article.text.path,
    textSource: article.text.source,
    summary: {
      jsonPath: article.summary.jsonPath,
      markdownPath: article.summary.markdownPath,
    },
  }));
  const crossPaperSummary = await digestSummarizer({
    query,
    articleSummaries,
    projectRoot,
    profile: summaryResult.profile,
  });
  const runId = buildRunId(query, now, 'digest');
  const digestJsonPath = join(directories.digestJsonDir, `${runId}.json`);
  const digestMarkdownPath = join(directories.digestMarkdownDir, `${runId}.md`);
  const digestPayload = {
    query,
    generatedAt: now.toISOString(),
    matchedFiles: summaryResult.matchedFiles,
    articleSummaries,
    crossPaperSummary,
  };

  writeFileSync(digestJsonPath, JSON.stringify(digestPayload, null, 2), 'utf8');
  writeFileSync(
    digestMarkdownPath,
    buildDigestMarkdown({
      query,
      generatedAt: now.toISOString(),
      crossPaperSummary,
      articleSummaries,
    }),
    'utf8',
  );

  return {
    ...summaryResult,
    summary: buildSummarizeSummary(summaryResult.articles, 1),
    artifacts: {
      ...summaryResult.artifacts,
      digestJson: digestJsonPath,
      digestMarkdown: digestMarkdownPath,
    },
    crossPaperSummary,
    articleSummaries,
  };
}
