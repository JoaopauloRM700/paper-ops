import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  answerQuestionFromEvidenceChunks,
  answerQuestionFromArticleTexts,
  summarizeArticleText,
  summarizeSearchDigest,
} from './article-summarizer.mjs';
import { createPlaywrightBrowserRuntime } from './browser-runtime.mjs';
import { readSourcesConfig } from './config.mjs';
import { readSavedSearchExports } from './csv-export.mjs';
import { deduplicatePaperRecords } from './papers.mjs';
import { extractTextFromPdfFile } from './pdf-extractor.mjs';
import { ensureWorkspaceArtifactDirs, resolveWorkspacePaths } from './workspace.mjs';

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

function sanitizeFilename(input, maxLength = 120) {
  return String(input ?? '')
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid Windows filename characters
    .replace(/\s+/g, ' ')
    .trim()
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
  return ensureWorkspaceArtifactDirs(projectRoot);
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

function buildQuestionAnswerMarkdown({ query, question, generatedAt, answerPayload, articleTexts }) {
  const evidence = answerPayload.supporting_evidence
    .map((entry) => `- ${entry.title} (${entry.page}): "${entry.quote}"`)
    .join('\n') || '- No direct supporting quote was returned.';
  const limitations = answerPayload.limitations.map((item) => `- ${item}`).join('\n') || '- None reported.';
  const sources = articleTexts
    .map((entry, index) => `${index + 1}. ${entry.record.title} (${entry.record.year ?? 'unknown'}) - ${entry.textSource}`)
    .join('\n') || 'No article text was available.';

  return `# Paper Question Answer

**Query:** ${query}
**Question:** ${question}
**Generated At:** ${generatedAt}
**Confidence:** ${answerPayload.confidence}

## Answer

${answerPayload.answer}

## Supporting Evidence

${evidence}

## Limitations

${limitations}

## Sources Consulted

${sources}
`;
}

function escapeJsonl(value) {
  return `${JSON.stringify(value)}\n`;
}

function normalizeMarkdownFromText(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  return normalized ? normalized : 'No text extracted.';
}

function buildStructuredFallbackFromText(text, textSource, record) {
  return [
    {
      type: 'paragraph',
      source: textSource,
      'page number': textSource === 'pdf_parse' ? 1 : null,
      'bounding box': null,
      title: record.title || 'unknown',
      content: normalizeMarkdownFromText(text),
    },
  ];
}

function extractPageNumber(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractBoundingBox(value) {
  return Array.isArray(value) && value.length === 4 ? value : null;
}

function buildHeadingAwareChunks(markdown, options = {}) {
  const maxChars = options.maxChars ?? 2200;
  const sections = [];
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  let currentHeading = '';
  let currentLines = [];

  function flushCurrent() {
    if (currentLines.length === 0) {
      return;
    }

    sections.push({
      heading: currentHeading || 'Document',
      text: currentLines.join('\n').trim(),
    });
    currentLines = [];
  }

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line.trim())) {
      flushCurrent();
      currentHeading = line.trim().replace(/^#{1,6}\s+/, '');
      currentLines.push(line.trim());
      continue;
    }

    currentLines.push(line);
  }

  flushCurrent();

  const chunks = [];
  for (const section of sections) {
    const sectionText = section.text.trim();
    if (!sectionText) {
      continue;
    }

    if (sectionText.length <= maxChars) {
      chunks.push({ heading: section.heading, text: sectionText });
      continue;
    }

    let cursor = 0;
    while (cursor < sectionText.length) {
      const slice = sectionText.slice(cursor, cursor + maxChars).trim();
      if (slice) {
        chunks.push({ heading: section.heading, text: slice });
      }
      cursor += maxChars;
    }
  }

  return chunks;
}

function inferPageAndBoundingBox(structuredData, chunkText) {
  const normalizedChunk = normalizeText(chunkText).toLowerCase();
  const entries = Array.isArray(structuredData) ? structuredData : [];

  for (const entry of entries) {
    const content = normalizeText(entry?.content ?? entry?.text ?? '').toLowerCase();
    if (!content) {
      continue;
    }

    if (normalizedChunk.includes(content) || content.includes(normalizedChunk.slice(0, Math.min(normalizedChunk.length, 120)))) {
      return {
        page: extractPageNumber(entry['page number'] ?? entry.pageNumber ?? entry.page),
        boundingBox: extractBoundingBox(entry['bounding box'] ?? entry.boundingBox ?? entry.bounding_box),
      };
    }
  }

  return {
    page: extractPageNumber(entries[0]?.['page number'] ?? entries[0]?.pageNumber ?? entries[0]?.page),
    boundingBox: extractBoundingBox(entries[0]?.['bounding box'] ?? entries[0]?.boundingBox ?? entries[0]?.bounding_box),
  };
}

function resolveSavedWorkspaceRecords(projectRoot) {
  const matchingExports = readSavedSearchExports(projectRoot)
    .sort((left, right) => parseGeneratedAt(right.generatedAt) - parseGeneratedAt(left.generatedAt));

  if (matchingExports.length === 0) {
    throw new Error(`No saved search results found in workspace: ${projectRoot}`);
  }

  const rawRecords = matchingExports.flatMap((entry) => entry.records);
  const deduped = deduplicatePaperRecords(rawRecords);
  const profile = matchingExports.find((entry) => entry.profile)?.profile ?? null;

  return {
    query: matchingExports[0].query,
    matchedFiles: matchingExports.map((entry) => entry.filePath),
    profile,
    rawRecords,
    records: deduped.uniqueRecords,
    duplicatesRemoved: deduped.stats.duplicatesRemoved,
  };
}

function buildCorpusChunks({ workspaceId, articleId, record, markdown, structuredData, textSource }) {
  return buildHeadingAwareChunks(markdown).map((chunk, index) => {
    const location = inferPageAndBoundingBox(structuredData, chunk.text);
    return {
      workspace_id: workspaceId,
      article_id: articleId,
      title: record.title || 'unknown',
      year: record.year ?? null,
      source: record.source || 'unknown',
      doi: record.doi || '',
      page: location.page,
      bounding_box: location.boundingBox,
      heading: chunk.heading,
      chunk_index: index + 1,
      text: chunk.text,
      text_source: textSource,
      url: record.url || '',
    };
  });
}

function buildAbstractMarkdown(record, abstractText, sourceLabel) {
  return `# ${record.title || 'Untitled Article'}

## Metadata

- Source: ${record.source || 'unknown'}
- Year: ${record.year ?? 'unknown'}
- Venue: ${record.venue || 'unknown'}
- DOI: ${record.doi || 'unknown'}
- URL: ${record.url || 'unknown'}
- Text source: ${sourceLabel}

## Abstract

${normalizeText(abstractText)}
`;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function findGeneratedArtifact(directory, extensions) {
  const filenames = readdirSync(directory);
  for (const extension of extensions) {
    const match = filenames.find((filename) => filename.toLowerCase().endsWith(extension));
    if (match) {
      return join(directory, match);
    }
  }

  return '';
}

async function loadOpenDataLoaderConvert() {
  const module = await import('@opendataloader/pdf');
  return module.convert ?? module.default?.convert ?? module.default;
}

function isJavaAvailable() {
  const result = spawnSync('java', ['-version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return result.status === 0;
}

function resolvePdfParserPreference(projectRoot) {
  const config = resolveDigestConfig(projectRoot);
  return config.defaults?.pdf_parser ?? 'auto';
}

async function convertPdfToCanonicalArtifacts({
  article,
  directories,
  projectRoot,
  extractTextImpl,
  openDataLoaderConvertImpl,
  pdfParserPreference = resolvePdfParserPreference(projectRoot),
}) {
  const markdownPath = join(directories.articleMarkdownDir, `${article.articleId}.md`);
  const structuredPath = join(directories.articleStructuredDir, `${article.articleId}.json`);
  const tempOutputDir = join(directories.articleStructuredDir, `.tmp-${article.articleId}`);
  mkdirSync(tempOutputDir, { recursive: true });

  const canUseOpenDataLoader = pdfParserPreference !== 'pdf-parse'
    && isJavaAvailable()
    && (typeof openDataLoaderConvertImpl === 'function' || await loadOpenDataLoaderConvert().catch(() => null));

  if (canUseOpenDataLoader) {
    const convertImpl = openDataLoaderConvertImpl ?? await loadOpenDataLoaderConvert();
    await convertImpl([article.pdf.path], {
      outputDir: tempOutputDir,
      format: 'markdown,json',
    });

    const generatedMarkdownPath = findGeneratedArtifact(tempOutputDir, ['.md', '.markdown']);
    const generatedJsonPath = findGeneratedArtifact(tempOutputDir, ['.json']);

    if (generatedMarkdownPath && generatedJsonPath) {
      const markdown = readFileSync(generatedMarkdownPath, 'utf8');
      const structured = readJsonFile(generatedJsonPath);
      writeFileSync(markdownPath, markdown, 'utf8');
      writeFileSync(structuredPath, JSON.stringify(structured, null, 2), 'utf8');
      return {
        markdown,
        structured,
        markdownPath,
        structuredPath,
        parser: 'opendataloader',
        textSource: 'pdf_markdown',
      };
    }
  }

  const extractedText = await extractTextImpl(article.pdf.path, {
    record: article.record,
    articleId: article.articleId,
    query: article.record.matched_query,
    projectRoot,
  });
  const markdown = normalizeMarkdownFromText(extractedText);
  const structured = buildStructuredFallbackFromText(extractedText, 'pdf_parse', article.record);
  writeFileSync(markdownPath, markdown, 'utf8');
  writeFileSync(structuredPath, JSON.stringify(structured, null, 2), 'utf8');
  return {
    markdown,
    structured,
    markdownPath,
    structuredPath,
    parser: 'pdf-parse',
    textSource: 'pdf_parse',
  };
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
  refreshText = false,
}) {
  article.text.path = join(directories.textDir, `${article.articleId}.txt`);

  if (!refreshText && existsSync(article.text.path)) {
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

function mergeAnswerCitations(answerPayload, evidenceChunks) {
  const knownByTitleAndPage = new Map(
    evidenceChunks.map((chunk) => [
      `${normalizeText(chunk.title).toLowerCase()}::${normalizeText(chunk.page ?? '').toLowerCase()}`,
      chunk,
    ]),
  );

  const fromEvidence = (answerPayload.supporting_evidence ?? []).map((entry) => {
    const key = `${normalizeText(entry.title).toLowerCase()}::${normalizeText(entry.page).toLowerCase()}`;
    const match = knownByTitleAndPage.get(key);
    return {
      title: entry.title,
      page: entry.page,
      source: match?.source ?? 'unknown',
      doi: match?.doi ?? '',
      bounding_box: match?.bounding_box ?? null,
    };
  });

  const explicit = Array.isArray(answerPayload.citations) ? answerPayload.citations : [];
  const merged = [...explicit, ...fromEvidence];
  const deduped = [];
  const seen = new Set();

  for (const citation of merged) {
    const key = `${citation.title}::${citation.page}::${citation.source}::${citation.doi}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(citation);
  }

  return deduped;
}

export async function ingestWorkspaceCorpus({
  workspaceRoot,
  query = '',
  fetchImpl = fetch,
  extractTextImpl = extractTextFromPdfFile,
  openDataLoaderConvertImpl,
  refreshCorpus = false,
} = {}) {
  const recordSet = resolveSavedWorkspaceRecords(workspaceRoot);
  const effectiveQuery = query || recordSet.query;
  const directories = ensureArtifactDirs(workspaceRoot);
  const workspacePaths = resolveWorkspacePaths(workspaceRoot);
  const fetchResult = await fetchQueryPdfs({
    projectRoot: workspaceRoot,
    query: effectiveQuery,
    fetchImpl,
  });
  const articles = fetchResult.articles;
  const manifestArticles = [];
  const chunkRecords = [];
  const parserCounts = {
    opendataloader: 0,
    pdfParse: 0,
    abstract: 0,
  };

  for (const article of articles) {
    const markdownPath = join(directories.articleMarkdownDir, `${article.articleId}.md`);
    const structuredPath = join(directories.articleStructuredDir, `${article.articleId}.json`);

    let markdown = '';
    let structured = [];
    let parser = 'abstract';
    let textSource = '';

    if (!refreshCorpus && existsSync(markdownPath) && existsSync(structuredPath)) {
      markdown = readFileSync(markdownPath, 'utf8');
      structured = readJsonFile(structuredPath);
      textSource = structured[0]?.source ?? (article.record.pdf_url ? 'pdf_markdown' : 'record_abstract');
      parser = textSource === 'pdf_parse' ? 'pdf-parse' : (textSource === 'pdf_markdown' ? 'opendataloader' : 'abstract');
    } else if (article.pdf.path && ['downloaded', 'cached'].includes(article.pdf.status)) {
      const converted = await convertPdfToCanonicalArtifacts({
        article,
        directories,
        projectRoot: workspaceRoot,
        extractTextImpl,
        openDataLoaderConvertImpl,
      });
      markdown = converted.markdown;
      structured = converted.structured;
      parser = converted.parser;
      textSource = converted.textSource;
    } else if (looksUsefulAbstract(article.record.abstract, 15)) {
      markdown = buildAbstractMarkdown(article.record, article.record.abstract, 'record_abstract');
      structured = buildStructuredFallbackFromText(article.record.abstract, 'record_abstract', article.record);
      writeFileSync(markdownPath, markdown, 'utf8');
      writeFileSync(structuredPath, JSON.stringify(structured, null, 2), 'utf8');
      textSource = 'record_abstract';
      parser = 'abstract';
    } else {
      const fallbackText = await extractFallbackTextFromArticlePage(article.record, fetchImpl);
      if (!looksUsefulAbstract(fallbackText, 40)) {
        continue;
      }

      markdown = buildAbstractMarkdown(article.record, fallbackText, 'landing_page_abstract');
      structured = buildStructuredFallbackFromText(fallbackText, 'landing_page_abstract', article.record);
      writeFileSync(markdownPath, markdown, 'utf8');
      writeFileSync(structuredPath, JSON.stringify(structured, null, 2), 'utf8');
      textSource = 'landing_page_abstract';
      parser = 'abstract';
    }

    if (parser === 'opendataloader') {
      parserCounts.opendataloader += 1;
    } else if (parser === 'pdf-parse') {
      parserCounts.pdfParse += 1;
    } else {
      parserCounts.abstract += 1;
    }

    const articleChunks = buildCorpusChunks({
      workspaceId: workspacePaths.workspaceId,
      articleId: article.articleId,
      record: article.record,
      markdown,
      structuredData: structured,
      textSource,
    });

    manifestArticles.push({
      articleId: article.articleId,
      title: article.record.title,
      year: article.record.year ?? null,
      source: article.record.source,
      doi: article.record.doi || '',
      pdfPath: article.pdf.path || '',
      markdownPath,
      structuredPath,
      parser,
      textSource,
      chunkCount: articleChunks.length,
    });
    chunkRecords.push(...articleChunks);
  }

  writeFileSync(
    workspacePaths.corpusManifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        workspace: {
          id: workspacePaths.workspaceId,
          root: workspaceRoot,
          briefPath: workspacePaths.briefPath,
          query: effectiveQuery,
          profile: recordSet.profile,
        },
        articles: manifestArticles,
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(workspacePaths.chunksPath, chunkRecords.map((chunk) => escapeJsonl(chunk)).join(''), 'utf8');

  return {
    workspace: {
      id: workspacePaths.workspaceId,
      root: workspaceRoot,
      briefPath: workspacePaths.briefPath,
    },
    query: effectiveQuery,
    articles: manifestArticles,
    summary: {
      totalArticles: articles.length,
      ingestedArticles: manifestArticles.length,
      chunkCount: chunkRecords.length,
      parsers: parserCounts,
    },
    artifacts: {
      manifest: workspacePaths.corpusManifestPath,
      chunks: workspacePaths.chunksPath,
      articleMarkdownDirectory: directories.articleMarkdownDir,
      articleStructuredDirectory: directories.articleStructuredDir,
    },
  };
}

function scoreCorpusChunk(questionTokens, chunk) {
  const tokens = new Set(
    normalizeText(chunk.text)
      .toLowerCase()
      .split(/[^a-z0-9_]+/i)
      .filter((token) => token.length >= 3),
  );

  let score = 0;
  for (const token of questionTokens) {
    if (tokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function selectWorkspaceEvidenceChunks(question, chunks, maxChunks = 12) {
  const questionTokens = new Set(
    normalizeText(question)
      .toLowerCase()
      .split(/[^a-z0-9_]+/i)
      .filter((token) => token.length >= 3),
  );

  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      relevanceScore: scoreCorpusChunk(questionTokens, chunk),
    }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  const selected = [];
  const seenArticleIds = new Set();

  for (const chunk of scored) {
    if (selected.length >= maxChunks) {
      break;
    }

    if (chunk.relevanceScore <= 0 && selected.length > 0) {
      continue;
    }

    if (seenArticleIds.has(chunk.article_id) && selected.filter((entry) => entry.article_id === chunk.article_id).length >= 2) {
      continue;
    }

    selected.push({
      title: chunk.title,
      source: chunk.source,
      doi: chunk.doi,
      page: chunk.page ?? 'unknown',
      bounding_box: chunk.bounding_box ?? null,
      textSource: chunk.text_source,
      text: chunk.text,
      article_id: chunk.article_id,
    });
    seenArticleIds.add(chunk.article_id);
  }

  return selected;
}

export async function answerWorkspaceQuestion({
  workspaceRoot,
  query = '',
  question,
  now = new Date(),
  fetchImpl = fetch,
  extractTextImpl = extractTextFromPdfFile,
  openDataLoaderConvertImpl,
  questionAnswerer = answerQuestionFromEvidenceChunks,
  refreshCorpus = false,
} = {}) {
  const workspacePaths = resolveWorkspacePaths(workspaceRoot);

  if (refreshCorpus || !existsSync(workspacePaths.chunksPath) || !existsSync(workspacePaths.corpusManifestPath)) {
    await ingestWorkspaceCorpus({
      workspaceRoot,
      query,
      fetchImpl,
      extractTextImpl,
      openDataLoaderConvertImpl,
      refreshCorpus,
    });
  }

  const manifest = readJsonFile(workspacePaths.corpusManifestPath);
  const chunks = readFileSync(workspacePaths.chunksPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const selectedEvidenceChunks = selectWorkspaceEvidenceChunks(question, chunks);

  if (selectedEvidenceChunks.length === 0) {
    throw new Error('No corpus chunks were available to answer the question.');
  }

  const answerPayload = await questionAnswerer({
    question,
    evidenceChunks: selectedEvidenceChunks,
    profile: manifest.workspace?.profile ?? null,
  });
  answerPayload.citations = mergeAnswerCitations(answerPayload, selectedEvidenceChunks);

  const directories = ensureArtifactDirs(workspaceRoot);
  const effectiveQuery = query || manifest.workspace?.query || 'workspace';
  const runId = buildRunId(effectiveQuery, now, 'answer');
  const answerJsonPath = join(directories.answerJsonDir, `${runId}.json`);
  const answerMarkdownPath = join(directories.answerMarkdownDir, `${runId}.md`);
  const articleTexts = manifest.articles.map((article) => ({
    record: {
      title: article.title,
      year: article.year,
    },
    textSource: article.textSource,
  }));

  const payload = {
    query: effectiveQuery,
    question,
    generatedAt: now.toISOString(),
    answer: answerPayload,
    citations: answerPayload.citations,
    workspace: manifest.workspace,
  };

  writeFileSync(answerJsonPath, JSON.stringify(payload, null, 2), 'utf8');
  writeFileSync(
    answerMarkdownPath,
    buildQuestionAnswerMarkdown({
      query: effectiveQuery,
      question,
      generatedAt: now.toISOString(),
      answerPayload,
      articleTexts,
    }),
    'utf8',
  );

  return {
    query: effectiveQuery,
    question,
    workspace: manifest.workspace,
    answer: answerPayload,
    articleTexts,
    artifacts: {
      answerJson: answerJsonPath,
      answerMarkdown: answerMarkdownPath,
      chunks: workspacePaths.chunksPath,
      manifest: workspacePaths.corpusManifestPath,
    },
  };
}

export async function fetchQueryPdfs({ projectRoot, query, fetchImpl = fetch, targetDir = null, useTitleAsFilename = false } = {}) {
  const recordSet = resolveSavedQueryRecords(projectRoot, query);
  const directories = ensureArtifactDirs(projectRoot);
  const articles = recordSet.records.map(createArticleState);
  const pdfOutputBase = targetDir ? join(projectRoot, targetDir) : directories.pdfDir;

  if (targetDir) {
    mkdirSync(pdfOutputBase, { recursive: true });
  }

  for (const article of articles) {
    if (!article.pdf.url) {
      continue;
    }

    let filename;
    if (useTitleAsFilename) {
      const year = article.record.year ? `[${article.record.year}] ` : '';
      const safeTitle = sanitizeFilename(article.record.title, 100);
      const suffix = article.articleId ? ` - ${article.articleId}` : '';
      filename = safeTitle
        ? `${year}${safeTitle}${suffix}.pdf`
        : `${article.articleId}.pdf`;
      console.log(`[DEBUG] Filename for "${article.record.title}": ${filename}`);
    } else {
      filename = `${article.articleId}.pdf`;
    }

    article.pdf.path = join(pdfOutputBase, filename);

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
      pdfDirectory: pdfOutputBase,
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
  refreshText = false,
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
  refreshText = false,
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
    refreshText,
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

export async function answerQueryFromArticles({
  projectRoot,
  query,
  question,
  now = new Date(),
  fetchImpl = fetch,
  extractTextImpl = extractTextFromPdfFile,
  questionAnswerer = answerQuestionFromArticleTexts,
  browserRuntime,
  browserFactory = createPlaywrightBrowserRuntime,
  refreshText = false,
} = {}) {
  const fetchResult = await fetchQueryPdfs({
    projectRoot,
    query,
    fetchImpl,
  });
  const directories = ensureArtifactDirs(projectRoot);
  const runtimeConfig = resolveDigestConfig(projectRoot);
  let ownedBrowserRuntime = null;
  const articleTexts = [];

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
      const sourceConfig = runtimeConfig.sources?.[article.record.source] ?? {};
      try {
        const text = await ensureArticleText({
          article,
          directories,
          query,
          projectRoot,
          fetchImpl,
          extractTextImpl,
          browserRuntimeResolver: getBrowserRuntime,
          sourceConfig,
          defaultConfig: runtimeConfig.defaults,
          refreshText,
        });
        articleTexts.push({
          articleId: article.articleId,
          record: article.record,
          text,
          textPath: article.text.path,
          textSource: article.text.source,
        });
      } catch (error) {
        article.text.status = 'failed';
        article.text.error = error instanceof Error ? error.message : String(error);
        article.text.path = '';
      }
    }
  } finally {
    if (ownedBrowserRuntime) {
      await ownedBrowserRuntime.close();
    }
  }

  if (articleTexts.length === 0) {
    throw new Error('No PDF text or abstract text was available to answer the question.');
  }

  const answerPayload = await questionAnswerer({
    question,
    articleTexts,
    projectRoot,
    query,
    profile: fetchResult.profile,
  });
  const runId = buildRunId(query, now, 'answer');
  const answerJsonPath = join(directories.answerJsonDir, `${runId}.json`);
  const answerMarkdownPath = join(directories.answerMarkdownDir, `${runId}.md`);
  const payload = {
    query,
    question,
    generatedAt: now.toISOString(),
    matchedFiles: fetchResult.matchedFiles,
    answer: answerPayload,
    articleTexts: articleTexts.map((entry) => ({
      articleId: entry.articleId,
      record: entry.record,
      textPath: entry.textPath,
      textSource: entry.textSource,
    })),
  };

  writeFileSync(answerJsonPath, JSON.stringify(payload, null, 2), 'utf8');
  writeFileSync(
    answerMarkdownPath,
    buildQuestionAnswerMarkdown({
      query,
      question,
      generatedAt: now.toISOString(),
      answerPayload,
      articleTexts,
    }),
    'utf8',
  );

  return {
    ...fetchResult,
    question,
    summary: buildSummarizeSummary(fetchResult.articles),
    artifacts: {
      ...fetchResult.artifacts,
      textDirectory: directories.textDir,
      answerJson: answerJsonPath,
      answerMarkdown: answerMarkdownPath,
    },
    answer: answerPayload,
    articleTexts,
  };
}
