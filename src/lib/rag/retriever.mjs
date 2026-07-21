import { normalizeQueryKey } from '../article-texts.mjs';

function tokenizeForFts(text) {
  return Array.from(new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9_]+/i)
      .filter((token) => token.length >= 3),
  ));
}

function buildFtsQuery(question) {
  const tokens = tokenizeForFts(question);
  if (tokens.length === 0) {
    return '';
  }

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

function mapChunk(row) {
  return {
    chunkId: row.chunk_id,
    articleId: row.article_id,
    title: row.title,
    authors: JSON.parse(row.authors_json || '[]'),
    year: row.year,
    venue: row.venue,
    doi: row.doi,
    url: row.url,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    section: row.section,
    text: row.text,
    score: row.score,
  };
}

export function retrieveEvidenceChunks({ db, query, question, topK = 12 } = {}) {
  const queryKey = normalizeQueryKey(query);
  const ftsQuery = buildFtsQuery(question);
  if (!queryKey || !ftsQuery) {
    return [];
  }

  return db.prepare(`
    SELECT
      c.chunk_id,
      c.article_id,
      c.page_start,
      c.page_end,
      c.section,
      c.text,
      a.title,
      a.authors_json,
      a.year,
      a.venue,
      a.doi,
      a.url,
      bm25(chunk_fts) AS score
    FROM chunk_fts
    JOIN chunks c ON c.chunk_id = chunk_fts.chunk_id
    JOIN articles a ON a.article_id = c.article_id
    WHERE chunk_fts MATCH ?
      AND c.query_key = ?
    ORDER BY score ASC, c.chunk_index ASC
    LIMIT ?
  `).all(ftsQuery, queryKey, topK).map(mapChunk);
}
