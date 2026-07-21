import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { readSavedSearchExports } from './csv-export.mjs';
import { deduplicatePaperRecords } from './papers.mjs';
import { extractTextFromPdfFile } from './pdf-extractor.mjs';

export function normalizeQueryKey(query) {
  return String(query ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function slugify(input, maxLength = 80) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

export function buildArticleArtifactId(record) {
  if (record.doi) {
    return `doi-${slugify(record.doi, 80)}`;
  }

  if (record.source_id) {
    return `${slugify(record.source, 24)}-${slugify(record.source_id, 80)}`;
  }

  return `${slugify(record.source, 24)}-${slugify(record.title || 'paper', 80)}-${record.year ?? 'unknown'}`;
}

function parseGeneratedAt(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function looksLikePdf(buffer) {
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
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
    `No PDF was available. The text relies on ${sourceLabel}.`,
    '',
    '--- Page abstract ---',
    abstractText,
  ].join('\n');
}

function ensureArticleTextDirs(projectRoot) {
  const directories = {
    pdfDir: join(projectRoot, 'output', 'pdfs'),
    textDir: join(projectRoot, 'output', 'pdf-text'),
    ocrPdfDir: join(projectRoot, 'output', 'ocr-pdfs'),
    ocrTextDir: join(projectRoot, 'output', 'ocr-text'),
  };

  for (const directory of Object.values(directories)) {
    mkdirSync(directory, { recursive: true });
  }

  return directories;
}

async function downloadPdfIfNeeded({ articleId, record, pdfDir, fetchImpl }) {
  if (!record.pdf_url) {
    return '';
  }

  const pdfPath = join(pdfDir, `${articleId}.pdf`);
  if (existsSync(pdfPath)) {
    return pdfPath;
  }

  const response = await fetchImpl(record.pdf_url);
  if (!response.ok) {
    throw new Error(`PDF download failed with HTTP ${response.status}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
  if (!looksLikePdf(buffer) && !contentType.includes('application/pdf')) {
    throw new Error('The PDF URL did not return a PDF document.');
  }

  writeFileSync(pdfPath, buffer);
  return pdfPath;
}

async function ensureArticleText({ record, articleId, directories, refreshText, fetchImpl, extractTextImpl, ocr }) {
  const textPath = join(directories.textDir, `${articleId}.txt`);
  const ocrTextPath = join(directories.ocrTextDir, `${articleId}.txt`);
  const ocrPdfPath = join(directories.ocrPdfDir, `${articleId}.pdf`);

  if (ocr && existsSync(ocrTextPath)) {
    return {
      text: readFileSync(ocrTextPath, 'utf8'),
      textPath: ocrTextPath,
      textSource: 'ocr_pdf',
      pdfPath: existsSync(ocrPdfPath) ? ocrPdfPath : '',
      status: 'ocr_extracted',
      error: '',
    };
  }

  if (!refreshText && existsSync(textPath)) {
    return {
      text: readFileSync(textPath, 'utf8'),
      textPath,
      textSource: record.pdf_url ? 'pdf_cached' : 'record_abstract',
      pdfPath: record.pdf_url ? join(directories.pdfDir, `${articleId}.pdf`) : '',
      status: 'cached',
      error: '',
    };
  }

  if (record.pdf_url) {
    try {
      const pdfPath = await downloadPdfIfNeeded({
        articleId,
        record,
        pdfDir: directories.pdfDir,
        fetchImpl,
      });
      const extractedText = await extractTextImpl(pdfPath, { record, articleId });
      writeFileSync(textPath, extractedText, 'utf8');
      return {
        text: extractedText,
        textPath,
        textSource: 'pdf',
        pdfPath,
        status: 'extracted',
        error: '',
      };
    } catch (error) {
      const abstractText = normalizeText(record.abstract);
      if (!abstractText) {
        throw error;
      }
    }
  }

  const abstractText = normalizeText(record.abstract);
  if (abstractText) {
    const fallbackText = buildFallbackTextFromAbstract(record, abstractText, 'the saved record abstract');
    writeFileSync(textPath, fallbackText, 'utf8');
    return {
      text: fallbackText,
      textPath,
      textSource: 'record_abstract',
      pdfPath: '',
      status: 'extracted',
      error: '',
    };
  }

  throw new Error('No usable PDF text or abstract was available for this article.');
}

export function resolveSavedQueryRecords(projectRoot, query) {
  const queryKey = normalizeQueryKey(query);
  if (!queryKey) {
    throw new Error('A search query is required.');
  }

  const matchingExports = readSavedSearchExports(projectRoot)
    .filter((entry) => entry.queryKey === queryKey)
    .sort((left, right) => parseGeneratedAt(right.generatedAt) - parseGeneratedAt(left.generatedAt));

  if (matchingExports.length === 0) {
    throw new Error(`No saved search results found for query: ${query}`);
  }

  const rawRecords = matchingExports.flatMap((entry) => entry.records);
  const deduped = deduplicatePaperRecords(rawRecords);

  return {
    query,
    queryKey,
    matchedFiles: matchingExports.map((entry) => entry.filePath),
    profile: matchingExports.find((entry) => entry.profile)?.profile ?? null,
    rawRecords,
    records: deduped.uniqueRecords,
    duplicatesRemoved: deduped.stats.duplicatesRemoved,
    generatedAt: matchingExports[0]?.generatedAt ?? '',
  };
}

export async function ensureQueryArticleTexts({
  projectRoot,
  query,
  refreshText = false,
  ocr = false,
  fetchImpl = fetch,
  extractTextImpl = extractTextFromPdfFile,
} = {}) {
  const recordSet = resolveSavedQueryRecords(projectRoot, query);
  const directories = ensureArticleTextDirs(projectRoot);
  const articleTexts = [];

  for (const record of recordSet.records) {
    const articleId = buildArticleArtifactId(record);
    try {
      const textResult = await ensureArticleText({
        record,
        articleId,
        directories,
        refreshText,
        ocr,
        fetchImpl,
        extractTextImpl,
      });
      articleTexts.push({
        articleId,
        record,
        ...textResult,
      });
    } catch (error) {
      articleTexts.push({
        articleId,
        record,
        text: '',
        textPath: '',
        textSource: 'unavailable',
        pdfPath: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ...recordSet,
    articleTexts,
  };
}
