import { createHash } from 'node:crypto';

import { ensureQueryArticleTexts, normalizeQueryKey } from '../article-texts.mjs';
import { getDefaultDatabasePath, openPaperOpsDatabase } from '../db/database.mjs';
import { initializePaperOpsSchema } from '../db/schema.mjs';
import { ocrQueryPdfs } from '../ocr/workflow.mjs';
import { chunkArticleText } from './chunker.mjs';
import { embedQueryChunks } from './embeddings/indexer.mjs';
import { formatAbntReference, formatApaReference, formatBibtexReference } from './references.mjs';

function textHash(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex');
}

function json(value) {
  return JSON.stringify(value ?? null);
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

function upsertArticle(db, articleText, now) {
  const record = articleText.record;
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
      pdf_path = excluded.pdf_path,
      text_path = excluded.text_path,
      updated_at = excluded.updated_at
  `).run({
    articleId: articleText.articleId,
    source: record.source || '',
    sourceId: record.source_id || '',
    title: record.title || 'unknown',
    authorsJson: json(Array.isArray(record.authors) ? record.authors : []),
    year: record.year ?? null,
    venue: record.venue || '',
    doi: record.doi || '',
    url: record.url || '',
    pdfPath: articleText.pdfPath || '',
    textPath: articleText.textPath || '',
    createdAt: now,
    updatedAt: now,
  });
}

function upsertDocument(db, queryKey, articleText, hash, now) {
  db.prepare(`
    INSERT INTO documents (
      article_id, query_key, text_source, status, text_hash, text_path,
      character_count, error, updated_at
    )
    VALUES (
      @articleId, @queryKey, @textSource, @status, @textHash, @textPath,
      @characterCount, @error, @updatedAt
    )
    ON CONFLICT(article_id) DO UPDATE SET
      query_key = excluded.query_key,
      text_source = excluded.text_source,
      status = excluded.status,
      text_hash = excluded.text_hash,
      text_path = excluded.text_path,
      character_count = excluded.character_count,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run({
    articleId: articleText.articleId,
    queryKey,
    textSource: articleText.textSource,
    status: articleText.status,
    textHash: hash,
    textPath: articleText.textPath || '',
    characterCount: articleText.text.length,
    error: articleText.error || '',
    updatedAt: now,
  });
}

function deleteArticleChunks(db, queryKey, articleId) {
  const chunkIds = db.prepare('SELECT chunk_id FROM chunks WHERE query_key = ? AND article_id = ?').all(queryKey, articleId);
  for (const row of chunkIds) {
    db.prepare('DELETE FROM chunk_fts WHERE chunk_id = ?').run(row.chunk_id);
  }
  db.prepare('DELETE FROM chunks WHERE query_key = ? AND article_id = ?').run(queryKey, articleId);
}

function insertChunks(db, queryKey, title, chunks, now) {
  const insertChunk = db.prepare(`
    INSERT INTO chunks (
      chunk_id, query_key, article_id, chunk_index, page_start, page_end,
      section, text, char_start, char_end, created_at
    )
    VALUES (
      @chunkId, @queryKey, @articleId, @chunkIndex, @pageStart, @pageEnd,
      @section, @text, @charStart, @charEnd, @createdAt
    )
  `);
  const insertFts = db.prepare(`
    INSERT INTO chunk_fts (chunk_id, query_key, article_id, title, text)
    VALUES (@chunkId, @queryKey, @articleId, @title, @text)
  `);

  for (const chunk of chunks) {
    insertChunk.run({
      ...chunk,
      queryKey,
      createdAt: now,
    });
    insertFts.run({
      chunkId: chunk.chunkId,
      queryKey,
      articleId: chunk.articleId,
      title,
      text: chunk.text,
    });
  }
}

function upsertReference(db, queryKey, articleText, now) {
  const record = articleText.record;
  const referenceRecord = {
    articleId: articleText.articleId,
    authors: Array.isArray(record.authors) ? record.authors : [],
    title: record.title || 'unknown',
    year: record.year ?? null,
    venue: record.venue || '',
    doi: record.doi || '',
    url: record.url || '',
  };

  db.prepare(`
    INSERT INTO "references" (
      article_id, query_key, authors_json, title, year, venue, doi, url,
      abnt, bibtex, apa, updated_at
    )
    VALUES (
      @articleId, @queryKey, @authorsJson, @title, @year, @venue, @doi, @url,
      @abnt, @bibtex, @apa, @updatedAt
    )
    ON CONFLICT(article_id) DO UPDATE SET
      query_key = excluded.query_key,
      authors_json = excluded.authors_json,
      title = excluded.title,
      year = excluded.year,
      venue = excluded.venue,
      doi = excluded.doi,
      url = excluded.url,
      abnt = excluded.abnt,
      bibtex = excluded.bibtex,
      apa = excluded.apa,
      updated_at = excluded.updated_at
  `).run({
    articleId: articleText.articleId,
    queryKey,
    authorsJson: json(referenceRecord.authors),
    title: referenceRecord.title,
    year: referenceRecord.year,
    venue: referenceRecord.venue,
    doi: referenceRecord.doi,
    url: referenceRecord.url,
    abnt: formatAbntReference(referenceRecord),
    bibtex: formatBibtexReference(referenceRecord),
    apa: formatApaReference(referenceRecord),
    updatedAt: now,
  });
}

function shouldSkipChunkRefresh(db, { queryKey, articleId, hash, refreshIndex }) {
  if (refreshIndex) {
    return false;
  }

  const existing = db.prepare('SELECT text_hash FROM documents WHERE article_id = ?').get(articleId);
  const chunkCount = db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE query_key = ? AND article_id = ?').get(queryKey, articleId).count;
  return existing?.text_hash === hash && chunkCount > 0;
}

export async function indexQueryForRag({
  projectRoot,
  query,
  now = new Date(),
  refreshText = false,
  refreshIndex = false,
  ocr = false,
  ocrLanguage = process.env.PAPER_OPS_OCR_LANG || 'eng',
  ocrRunner,
  embed = false,
  refreshEmbeddings = false,
  embeddingProviderName = process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
  embeddingModel = process.env.PAPER_OPS_EMBEDDING_MODEL || (embeddingProviderName === 'fixture' ? 'fixture-64' : 'text-embedding-3-small'),
  embeddingProvider,
  fetchImpl = fetch,
  extractTextImpl,
  databasePath,
} = {}) {
  const indexedAt = now.toISOString();
  const ocrResult = ocr
    ? await ocrQueryPdfs({
        projectRoot,
        query,
        language: ocrLanguage,
        now,
        fetchImpl,
        ...(ocrRunner ? { ocrRunner } : {}),
        ...(extractTextImpl ? { extractTextImpl } : {}),
        databasePath,
      })
    : null;
  const recordSet = await ensureQueryArticleTexts({
    projectRoot,
    query,
    refreshText,
    ocr,
    fetchImpl,
    ...(extractTextImpl ? { extractTextImpl } : {}),
  });
  const db = openPaperOpsDatabase({ projectRoot, databasePath });
  initializePaperOpsSchema(db);

  const summary = {
    articlesIndexed: 0,
    articlesSkipped: 0,
    textFailed: 0,
    chunksIndexed: 0,
  };

  try {
    const work = db.transaction(() => {
      upsertSearchRun(db, recordSet, indexedAt);

      for (const articleText of recordSet.articleTexts) {
        upsertArticle(db, articleText, indexedAt);
        db.prepare(`
          INSERT OR IGNORE INTO search_run_articles (query_key, article_id)
          VALUES (?, ?)
        `).run(recordSet.queryKey, articleText.articleId);

        if (articleText.status === 'failed' || !articleText.text) {
          upsertDocument(db, recordSet.queryKey, articleText, '', indexedAt);
          summary.textFailed += 1;
          continue;
        }

        const hash = textHash(articleText.text);
        upsertDocument(db, recordSet.queryKey, articleText, hash, indexedAt);
        upsertReference(db, recordSet.queryKey, articleText, indexedAt);

        if (shouldSkipChunkRefresh(db, {
          queryKey: recordSet.queryKey,
          articleId: articleText.articleId,
          hash,
          refreshIndex,
        })) {
          summary.articlesSkipped += 1;
          continue;
        }

        deleteArticleChunks(db, recordSet.queryKey, articleText.articleId);
        const chunks = chunkArticleText({
          articleId: articleText.articleId,
          text: articleText.text,
          textSource: articleText.textSource,
        });
        insertChunks(db, recordSet.queryKey, articleText.record.title || 'unknown', chunks, indexedAt);
        summary.articlesIndexed += 1;
        summary.chunksIndexed += chunks.length;
      }
    });

    work();
  } finally {
    db.close();
  }

  const embeddingResult = embed
    ? await embedQueryChunks({
        projectRoot,
        query: recordSet.query,
        provider: embeddingProviderName,
        model: embeddingModel,
        refreshEmbeddings,
        now,
        databasePath,
        ...(embeddingProvider ? { embeddingProvider } : {}),
      })
    : null;

  return {
    query: recordSet.query,
    queryKey: normalizeQueryKey(recordSet.query),
    matchedFiles: recordSet.matchedFiles,
    summary,
    ocr: ocrResult?.summary ?? null,
    embeddings: embeddingResult?.summary ?? null,
    artifacts: {
      databasePath: databasePath ?? getDefaultDatabasePath(projectRoot),
    },
  };
}
