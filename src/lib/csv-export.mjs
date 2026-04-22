import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { deduplicatePaperRecords } from './papers.mjs';

function normalizeQuery(query) {
  return String(query ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function slugify(input) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function parseGeneratedAt(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildCsvContent(records) {
  const header = [
    'Source',
    'SourceID',
    'Title',
    'Authors',
    'Year',
    'Venue',
    'DOI',
    'URL',
    'PDFAvailable',
    'PDFURL',
    'MatchedQuery',
    'RetrievedAt',
  ];

  const rows = records.map((record) => [
    record.source,
    record.source_id,
    record.title,
    Array.isArray(record.authors) ? record.authors.join('; ') : '',
    record.year ?? '',
    record.venue,
    record.doi,
    record.url,
    record.pdf_available === null ? '' : String(record.pdf_available),
    record.pdf_url,
    record.matched_query,
    record.retrieved_at,
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => csvEscape(cell)).join(','))
    .join('\n');
}

export function readSavedSearchExports(projectRoot) {
  const outputDir = join(projectRoot, 'output');
  if (!existsSync(outputDir)) {
    return [];
  }

  return readdirSync(outputDir)
    .filter((filename) => filename.endsWith('.json'))
    .flatMap((filename) => {
      const filePath = join(outputDir, filename);

      try {
        const payload = JSON.parse(readFileSync(filePath, 'utf8'));
        if (typeof payload.query !== 'string' || !Array.isArray(payload.records)) {
          return [];
        }

        return [{
          filePath,
          filename,
          query: payload.query,
          queryKey: normalizeQuery(payload.query),
          generatedAt: payload.generatedAt ?? '',
          records: payload.records,
        }];
      } catch {
        return [];
      }
    });
}

export function exportQueryResultsToCsv({ projectRoot, query, outputPath } = {}) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    throw new Error('A search query is required to export CSV results.');
  }

  const matchingExports = readSavedSearchExports(projectRoot)
    .filter((entry) => entry.queryKey === normalizedQuery)
    .sort((left, right) => parseGeneratedAt(right.generatedAt) - parseGeneratedAt(left.generatedAt));

  if (matchingExports.length === 0) {
    throw new Error(`No saved search results found for query: ${query}`);
  }

  const rawRecords = matchingExports.flatMap((entry) => entry.records);
  const deduped = deduplicatePaperRecords(rawRecords);
  const finalOutputPath = outputPath ?? join(projectRoot, 'output', `search-results-${slugify(query) || 'query'}.csv`);

  mkdirSync(join(projectRoot, 'output'), { recursive: true });
  writeFileSync(finalOutputPath, buildCsvContent(deduped.uniqueRecords), 'utf8');

  return {
    query,
    matchedFiles: matchingExports.map((entry) => entry.filePath),
    totalRawRecords: rawRecords.length,
    uniqueRecords: deduped.uniqueRecords.length,
    duplicatesRemoved: deduped.stats.duplicatesRemoved,
    csvPath: finalOutputPath,
  };
}

export function exportAllQueriesToCsv({ projectRoot } = {}) {
  const exportsByQuery = new Map();

  for (const entry of readSavedSearchExports(projectRoot)) {
    if (!exportsByQuery.has(entry.queryKey)) {
      exportsByQuery.set(entry.queryKey, entry.query);
    }
  }

  return Array.from(exportsByQuery.values())
    .sort((left, right) => left.localeCompare(right))
    .map((query) => exportQueryResultsToCsv({ projectRoot, query }));
}
