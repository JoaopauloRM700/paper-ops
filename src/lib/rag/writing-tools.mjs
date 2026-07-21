import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeQueryKey, slugify } from '../article-texts.mjs';
import { openPaperOpsDatabase } from '../db/database.mjs';
import { initializePaperOpsSchema } from '../db/schema.mjs';
import { collectEvidenceForQuestion } from './evidence.mjs';
import { indexQueryForRag } from './indexer.mjs';

function readSummarySections(projectRoot, articleId) {
  const summaryPath = join(projectRoot, 'output', 'article-summaries', `${articleId}.json`);
  if (!existsSync(summaryPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(summaryPath, 'utf8')).sections ?? {};
  } catch {
    return {};
  }
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildMatrixMarkdown(rows) {
  const body = rows.map((row, index) => (
    `| ${index + 1} | ${row.title.replace(/\|/g, '\\|')} | ${row.year ?? '-'} | ${row.objective.replace(/\|/g, '\\|')} | ${row.method.replace(/\|/g, '\\|')} | ${row.keyFindings.replace(/\|/g, '\\|')} | ${row.limitations.replace(/\|/g, '\\|')} |`
  )).join('\n');

  return `# Literature Matrix

| # | Article | Year | Objective | Method | Key Findings | Limitations |
|---:|---|---:|---|---|---|---|
${body || '| - | - | - | - | - | - | - |'}
`;
}

function buildMatrixCsv(rows) {
  const header = ['Title', 'Year', 'Venue', 'DOI', 'Objective', 'Method', 'Key Findings', 'Limitations'];
  const body = rows.map((row) => [
    row.title,
    row.year ?? '',
    row.venue,
    row.doi,
    row.objective,
    row.method,
    row.keyFindings,
    row.limitations,
  ]);

  return [header, ...body].map((row) => row.map(csvEscape).join(',')).join('\n');
}

export async function buildLiteratureMatrix({ projectRoot, query, now = new Date(), databasePath } = {}) {
  const queryKey = normalizeQueryKey(query);
  await indexQueryForRag({ projectRoot, query, now, databasePath });
  const db = openPaperOpsDatabase({ projectRoot, databasePath });
  initializePaperOpsSchema(db);

  try {
    const articles = db.prepare(`
      SELECT a.article_id, a.title, a.year, a.venue, a.doi
      FROM search_run_articles sra
      JOIN articles a ON a.article_id = sra.article_id
      WHERE sra.query_key = ?
      ORDER BY a.year DESC, lower(a.title)
    `).all(queryKey);

    const rows = articles.map((article) => {
      const sections = readSummarySections(projectRoot, article.article_id);
      return {
        articleId: article.article_id,
        title: article.title,
        year: article.year,
        venue: article.venue,
        doi: article.doi,
        objective: sections.objective ?? 'unknown',
        method: sections.method ?? 'unknown',
        keyFindings: Array.isArray(sections.key_findings) ? sections.key_findings.join('; ') : 'unknown',
        limitations: Array.isArray(sections.limitations) ? sections.limitations.join('; ') : 'unknown',
      };
    });

    const reportDir = join(projectRoot, 'reports', 'rag', slugify(queryKey, 64));
    mkdirSync(reportDir, { recursive: true });
    const matrixMarkdown = join(reportDir, 'matrix.md');
    const matrixCsv = join(reportDir, 'matrix.csv');
    writeFileSync(matrixMarkdown, buildMatrixMarkdown(rows), 'utf8');
    writeFileSync(matrixCsv, buildMatrixCsv(rows), 'utf8');

    return {
      query,
      rows,
      artifacts: {
        matrixMarkdown,
        matrixCsv,
      },
    };
  } finally {
    db.close();
  }
}

function buildDraftMarkdown({ query, question, section, evidenceChunks }) {
  const paragraphs = evidenceChunks.map((chunk) => (
    `- ${chunk.text} (${chunk.title}${chunk.pageStart ? `, p. ${chunk.pageStart}` : ''}${chunk.doi ? `, DOI: ${chunk.doi}` : ''})`
  )).join('\n');

  const sources = evidenceChunks
    .map((chunk) => `${chunk.title}${chunk.doi ? ` - DOI: ${chunk.doi}` : ''}`)
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((value) => `- ${value}`)
    .join('\n');

  return `# Draft: ${section}

**Query:** ${query}
**Focus:** ${question}

## Draft

${paragraphs || 'Nao encontrei evidencias suficientes para gerar um rascunho aterrado.'}

## Fontes usadas

${sources || '- Nenhuma fonte usada.'}
`;
}

export async function draftSectionFromEvidence({
  projectRoot,
  query,
  question,
  section = 'custom',
  topK = 12,
  now = new Date(),
  databasePath,
} = {}) {
  const evidenceResult = await collectEvidenceForQuestion({
    projectRoot,
    query,
    question,
    topK,
    now,
    databasePath,
  });
  const reportDir = join(projectRoot, 'reports', 'rag', slugify(normalizeQueryKey(query), 64), 'drafts');
  mkdirSync(reportDir, { recursive: true });
  const draftMarkdown = join(reportDir, `${slugify(section, 32) || 'custom'}-${now.toISOString().replace(/[:.]/g, '-')}.md`);
  writeFileSync(
    draftMarkdown,
    buildDraftMarkdown({
      query,
      question,
      section,
      evidenceChunks: evidenceResult.evidenceChunks,
    }),
    'utf8',
  );

  return {
    query,
    question,
    section,
    evidenceChunks: evidenceResult.evidenceChunks,
    artifacts: {
      draftMarkdown,
    },
  };
}
