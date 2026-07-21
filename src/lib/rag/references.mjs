import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeQueryKey, slugify } from '../article-texts.mjs';
import { openPaperOpsDatabase } from '../db/database.mjs';
import { initializePaperOpsSchema } from '../db/schema.mjs';

function parseAuthors(value) {
  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function splitAuthorName(author) {
  const parts = String(author ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { first: '', last: '' };
  }

  return {
    first: parts.slice(0, -1).join(' '),
    last: parts.at(-1),
  };
}

function formatAbntAuthor(author) {
  const { first, last } = splitAuthorName(author);
  return `${last.toUpperCase()}, ${first}`.trim();
}

function formatApaAuthor(author) {
  const { first, last } = splitAuthorName(author);
  const initials = first
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}.`)
    .join(' ');
  return initials ? `${last}, ${initials}` : last;
}

function bibtexEscape(value) {
  return String(value ?? '').replace(/[{}]/g, '');
}

function firstTitleToken(title) {
  const token = String(title ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((part) => part.length >= 3);
  return token || 'paper';
}

function buildBibtexKey(record) {
  const firstAuthor = splitAuthorName(record.authors?.[0] ?? 'paper').last.toLowerCase() || 'paper';
  return `${slugify(firstAuthor, 24)}${record.year ?? 'unknown'}${slugify(firstTitleToken(record.title), 24)}`;
}

export function formatAbntReference(record) {
  const authors = parseAuthors(record.authors);
  const authorText = authors.length > 0
    ? authors.map(formatAbntAuthor).join('; ')
    : 'AUTORIA DESCONHECIDA';
  const venue = record.venue ? ` ${record.venue},` : '';
  const year = record.year ?? 's.d.';
  const doi = record.doi ? ` DOI: ${record.doi}.` : '';
  const url = record.url ? ` Disponivel em: ${record.url}.` : '';
  return `${authorText}. ${record.title || 'Sem titulo'}.${venue} ${year}.${doi}${url}`.replace(/\s+/g, ' ').trim();
}

export function formatApaReference(record) {
  const authors = parseAuthors(record.authors);
  const authorText = authors.length > 0
    ? authors.map(formatApaAuthor).join(', ')
    : 'Unknown author';
  const year = record.year ?? 'n.d.';
  const venue = record.venue ? ` ${record.venue}.` : '';
  const doiOrUrl = record.doi ? ` https://doi.org/${record.doi}` : (record.url ? ` ${record.url}` : '');
  return `${authorText} (${year}). ${record.title || 'Untitled'}.${venue}${doiOrUrl}`.replace(/\s+/g, ' ').trim();
}

export function formatBibtexReference(record) {
  const authors = parseAuthors(record.authors);
  const lines = [
    `@article{${buildBibtexKey({ ...record, authors })},`,
    `  title = {${bibtexEscape(record.title || 'Untitled')}},`,
    `  author = {${bibtexEscape(authors.join(' and '))}},`,
    `  year = {${record.year ?? ''}},`,
  ];

  if (record.venue) {
    lines.push(`  journal = {${bibtexEscape(record.venue)}},`);
  }

  if (record.doi) {
    lines.push(`  doi = {${bibtexEscape(record.doi)}},`);
  }

  if (record.url) {
    lines.push(`  url = {${bibtexEscape(record.url)}},`);
  }

  lines.push('}');
  return lines.join('\n');
}

function rowsToReferenceRecords(rows) {
  return rows.map((row) => ({
    articleId: row.article_id,
    authors: parseAuthors(row.authors_json),
    title: row.title,
    year: row.year,
    venue: row.venue,
    doi: row.doi,
    url: row.url,
    abnt: row.abnt,
    bibtex: row.bibtex,
    apa: row.apa,
  }));
}

export function exportReferencesForQuery({ projectRoot, query, format = 'all', databasePath } = {}) {
  const queryKey = normalizeQueryKey(query);
  const db = openPaperOpsDatabase({ projectRoot, databasePath });
  initializePaperOpsSchema(db);

  try {
    const references = rowsToReferenceRecords(db.prepare(`
      SELECT *
      FROM "references"
      WHERE query_key = ?
      ORDER BY lower(title)
    `).all(queryKey));

    if (references.length === 0) {
      throw new Error(`No indexed references found for query: ${query}`);
    }

    const outputDir = join(projectRoot, 'reports', 'rag', slugify(queryKey, 64), 'references');
    mkdirSync(outputDir, { recursive: true });

    const result = {
      query,
      references,
      abnt: references.map((entry) => entry.abnt || formatAbntReference(entry)).join('\n\n'),
      bibtex: references.map((entry) => entry.bibtex || formatBibtexReference(entry)).join('\n\n'),
      apa: references.map((entry) => entry.apa || formatApaReference(entry)).join('\n\n'),
      artifacts: {},
    };

    if (format === 'all' || format === 'abnt') {
      result.artifacts.abntPath = join(outputDir, 'references.abnt.txt');
      writeFileSync(result.artifacts.abntPath, result.abnt, 'utf8');
    }

    if (format === 'all' || format === 'bibtex') {
      result.artifacts.bibtexPath = join(outputDir, 'references.bib');
      writeFileSync(result.artifacts.bibtexPath, result.bibtex, 'utf8');
    }

    if (format === 'all' || format === 'apa') {
      result.artifacts.apaPath = join(outputDir, 'references.apa.txt');
      writeFileSync(result.artifacts.apaPath, result.apa, 'utf8');
    }

    return result;
  } finally {
    db.close();
  }
}
