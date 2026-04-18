import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizePaperRecord } from '../papers.mjs';

export function readFixtureFile(fixtureDir, fixtureName) {
  const fixtureRoot = fixtureDir instanceof URL ? fixtureDir : new URL(`file://${fixtureDir.replace(/\\/g, '/')}/`);
  const fixtureUrl = new URL(fixtureName, fixtureRoot);
  return JSON.parse(readFileSync(fixtureUrl, 'utf8'));
}

export function completedSourceResult(sourceName, records) {
  return {
    source: sourceName,
    status: 'completed',
    records: records.map((record) => normalizePaperRecord(record)),
  };
}

export function skippedSourceResult(sourceName, reason) {
  return {
    source: sourceName,
    status: 'skipped',
    reason,
    records: [],
  };
}

export function buildFixturePath(projectRoot, fixtureName) {
  return join(projectRoot, 'tests', 'fixtures', fixtureName);
}

export function buildSearchUrl(baseUrl, queryParam, query, extraParams = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set(queryParam, query);
  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function fetchJson(fetchImpl, url, { headers = {}, sourceLabel = 'API' } = {}) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const body = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`${sourceLabel} request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }

  return response.json();
}

export function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function stripTags(value) {
  return decodeHtmlEntities(String(value ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractBlocks(html, pattern) {
  return Array.from(String(html ?? '').matchAll(pattern), (match) => match[0]);
}

export function extractFirst(html, patterns = [], groupIndex = 1) {
  for (const pattern of patterns) {
    const match = String(html ?? '').match(pattern);
    if (match?.[groupIndex]) {
      return stripTags(match[groupIndex]);
    }
  }

  return '';
}

export function extractAll(html, pattern, groupIndex = 1) {
  return Array.from(String(html ?? '').matchAll(pattern), (match) => stripTags(match[groupIndex]))
    .filter(Boolean);
}

export function extractHref(html, patterns = [], baseUrl = '') {
  for (const pattern of patterns) {
    const match = String(html ?? '').match(pattern);
    if (match?.[1]) {
      try {
        return new URL(decodeHtmlEntities(match[1]), baseUrl || 'https://example.org').toString();
      } catch {
        return decodeHtmlEntities(match[1]);
      }
    }
  }

  return '';
}

export function parseYear(value) {
  const match = String(value ?? '').match(/(19|20)\d{2}/);
  return match ? match[0] : '';
}

export function parseDoi(value) {
  const match = String(value ?? '').match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return match ? match[0] : '';
}

export function splitAuthors(value) {
  return String(value ?? '')
    .split(/,|;|\band\b/gi)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolvePdfMetadata({ pdfUrl = '', pdfAvailable = null } = {}) {
  const normalizedPdfUrl = String(pdfUrl ?? '').trim();

  return {
    pdf_available: normalizedPdfUrl ? true : (pdfAvailable === true ? true : (pdfAvailable === false ? false : null)),
    pdf_url: normalizedPdfUrl,
  };
}
