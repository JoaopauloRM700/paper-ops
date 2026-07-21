import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildArticleArtifactId, resolveSavedQueryRecords, slugify } from '../article-texts.mjs';
import { openPaperOpsDatabase } from '../db/database.mjs';
import { initializePaperOpsSchema } from '../db/schema.mjs';
import { extractTextFromPdfFile } from '../pdf-extractor.mjs';
import { createOcrRunId } from './engine.mjs';
import { runOcrForPdf } from './ocrmypdf.mjs';

function json(value) {
  return JSON.stringify(value ?? null);
}

function looksLikePdf(buffer) {
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

async function ensurePdfArtifact({ record, articleId, pdfDir, fetchImpl }) {
  const pdfPath = join(pdfDir, `${articleId}.pdf`);
  if (existsSync(pdfPath)) {
    return pdfPath;
  }

  if (!record.pdf_url) {
    return '';
  }

  const response = await fetchImpl(record.pdf_url);
  if (!response.ok) {
    throw new Error(`PDF download failed with HTTP ${response.status}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  if (!looksLikePdf(buffer) && !contentType.includes('application/pdf')) {
    throw new Error('The PDF URL did not return a PDF document.');
  }

  writeFileSync(pdfPath, buffer);
  return pdfPath;
}

function upsertSearchRun(db, recordSet, now) {
  db.prepare(`
    INSERT INTO search_runs (query_key, query, matched_files_json, profile_json, generated_at, indexed_at)
    VALUES (@queryKey, @query, @matchedFilesJson, @profileJson, @generatedAt, @indexedAt)
    ON CONFLICT(query_key) DO UPDATE SET
      query = excluded.query,
      matched_files_json = excluded.matched_files_json,
      profile_json = excluded.profile_json,
      generated_at = excluded.generated_at,
      indexed_at = excluded.indexed_at
  `).run({
    queryKey: recordSet.queryKey,
    query: recordSet.query,
    matchedFilesJson: json(recordSet.matchedFiles),
    profileJson: recordSet.profile ? json(recordSet.profile) : null,
    generatedAt: recordSet.generatedAt || now,
    indexedAt: now,
  });
}

function upsertArticle(db, articleId, record, now) {
  db.prepare(`
    INSERT INTO articles (
      article_id, source, source_id, title, authors_json, year, venue, doi, url,
      pdf_path, text_path, created_at, updated_at
    )
    VALUES (
      @articleId, @source, @sourceId, @title, @authorsJson, @year, @venue, @doi, @url,
      @pdfPath, @textPath, @createdAt, @updatedAt
    )
    ON CONFLICT(article_id) DO UPDATE SET
      source = excluded.source,
      source_id = excluded.source_id,
      title = excluded.title,
      authors_json = excluded.authors_json,
      year = excluded.year,
      venue = excluded.venue,
      doi = excluded.doi,
      url = excluded.url,
      updated_at = excluded.updated_at
  `).run({
    articleId,
    source: record.source || '',
    sourceId: record.source_id || '',
    title: record.title || 'unknown',
    authorsJson: json(Array.isArray(record.authors) ? record.authors : []),
    year: record.year ?? null,
    venue: record.venue || '',
    doi: record.doi || '',
    url: record.url || '',
    pdfPath: '',
    textPath: '',
    createdAt: now,
    updatedAt: now,
  });
}

function upsertOcrRun(db, recordSet, row, now) {
  db.prepare(`
    INSERT INTO ocr_runs (
      ocr_run_id, article_id, query_key, engine, language, input_pdf_path,
      output_pdf_path, output_text_path, status, page_count, error, created_at, updated_at
    )
    VALUES (
      @ocrRunId, @articleId, @queryKey, @engine, @language, @inputPdfPath,
      @outputPdfPath, @outputTextPath, @status, @pageCount, @error, @createdAt, @updatedAt
    )
    ON CONFLICT(ocr_run_id) DO UPDATE SET
      status = excluded.status,
      output_pdf_path = excluded.output_pdf_path,
      output_text_path = excluded.output_text_path,
      page_count = excluded.page_count,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run({
    ocrRunId: row.ocrRunId,
    articleId: row.articleId,
    queryKey: recordSet.queryKey,
    engine: 'ocrmypdf',
    language: row.language,
    inputPdfPath: row.inputPdfPath || '',
    outputPdfPath: row.outputPdfPath || '',
    outputTextPath: row.outputTextPath || '',
    status: row.status,
    pageCount: row.pageCount ?? null,
    error: row.error || '',
    createdAt: now,
    updatedAt: now,
  });
}

function countPageMarkers(text) {
  const matches = String(text ?? '').match(/^--- Page .+? ---\s*$/gim);
  return matches?.length ?? null;
}

function buildOcrMarkdown(result) {
  const rows = result.rows.map((row) => (
    `| ${row.articleId} | ${row.status} | ${row.outputTextPath || '-'} | ${row.error || '-'} |`
  )).join('\n');

  return `# OCR Run

**Query:** ${result.query}
**Language:** ${result.language}

| Article | Status | Text Artifact | Error |
|---|---|---|---|
${rows || '| - | - | - | - |'}
`;
}

export async function ocrQueryPdfs({
  projectRoot,
  query,
  language = process.env.PAPER_OPS_OCR_LANG || 'eng',
  force = false,
  now = new Date(),
  fetchImpl = fetch,
  ocrRunner = runOcrForPdf,
  extractTextImpl = extractTextFromPdfFile,
  databasePath,
} = {}) {
  const recordSet = resolveSavedQueryRecords(projectRoot, query);
  const timestamp = now.toISOString();
  const pdfDir = join(projectRoot, 'output', 'pdfs');
  const ocrPdfDir = join(projectRoot, 'output', 'ocr-pdfs');
  const ocrTextDir = join(projectRoot, 'output', 'ocr-text');
  const reportDir = join(projectRoot, 'reports', 'ocr', slugify(recordSet.queryKey, 64));
  mkdirSync(pdfDir, { recursive: true });
  mkdirSync(ocrPdfDir, { recursive: true });
  mkdirSync(ocrTextDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  const rows = [];
  const summary = { ocrSucceeded: 0, ocrSkipped: 0, ocrFailed: 0 };

  for (const record of recordSet.records) {
    const articleId = buildArticleArtifactId(record);
    const outputPdfPath = join(ocrPdfDir, `${articleId}.pdf`);
    const outputTextPath = join(ocrTextDir, `${articleId}.txt`);
    const ocrRunId = createOcrRunId(articleId, now);

    if (!force && existsSync(outputTextPath)) {
      summary.ocrSkipped += 1;
      rows.push({
        ocrRunId,
        articleId,
        language,
        status: 'cached',
        outputPdfPath,
        outputTextPath,
      });
      continue;
    }

    try {
      const inputPdfPath = await ensurePdfArtifact({ record, articleId, pdfDir, fetchImpl });
      if (!inputPdfPath) {
        summary.ocrSkipped += 1;
        rows.push({
          ocrRunId,
          articleId,
          language,
          status: 'skipped',
          error: 'PDF artifact not found and no PDF URL is available.',
        });
        continue;
      }

      await ocrRunner({ inputPdfPath, outputPdfPath, language });
      const text = await extractTextImpl(outputPdfPath, { record, articleId });
      writeFileSync(outputTextPath, text, 'utf8');
      summary.ocrSucceeded += 1;
      rows.push({
        ocrRunId,
        articleId,
        language,
        status: 'ocr_extracted',
        inputPdfPath,
        outputPdfPath,
        outputTextPath,
        pageCount: countPageMarkers(text),
      });
    } catch (error) {
      summary.ocrFailed += 1;
      rows.push({
        ocrRunId,
        articleId,
        language,
        status: 'failed',
        outputPdfPath,
        outputTextPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const db = openPaperOpsDatabase({ projectRoot, databasePath });
  initializePaperOpsSchema(db);
  try {
    const work = db.transaction(() => {
      upsertSearchRun(db, recordSet, timestamp);
      for (const record of recordSet.records) {
        const articleId = buildArticleArtifactId(record);
        upsertArticle(db, articleId, record, timestamp);
        db.prepare('INSERT OR IGNORE INTO search_run_articles (query_key, article_id) VALUES (?, ?)').run(recordSet.queryKey, articleId);
      }
      for (const row of rows) {
        upsertOcrRun(db, recordSet, row, timestamp);
      }
    });
    work();
  } finally {
    db.close();
  }

  const result = {
    query: recordSet.query,
    queryKey: recordSet.queryKey,
    language,
    summary,
    rows,
    artifacts: {
      reportMarkdown: join(reportDir, `ocr-${timestamp.replace(/[:.]/g, '-')}.md`),
    },
  };
  writeFileSync(result.artifacts.reportMarkdown, buildOcrMarkdown(result), 'utf8');
  return result;
}
