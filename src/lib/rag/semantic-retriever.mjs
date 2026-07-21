import { normalizeQueryKey } from '../article-texts.mjs';
import { createEmbeddingProvider, cosineSimilarity } from './embeddings/provider.mjs';

function parseAuthors(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseVector(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapSemanticRow(row, score) {
  return {
    chunkId: row.chunk_id,
    articleId: row.article_id,
    title: row.title,
    authors: parseAuthors(row.authors_json),
    year: row.year,
    venue: row.venue,
    doi: row.doi,
    url: row.url,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    section: row.section,
    text: row.text,
    score,
    semanticScore: score,
    retrievalMode: 'semantic',
    retrievalSources: ['semantic'],
  };
}

export async function retrieveSemanticChunks({
  db,
  query,
  question,
  topK = 12,
  provider = process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
  model = process.env.PAPER_OPS_EMBEDDING_MODEL || (provider === 'fixture' ? 'fixture-64' : 'text-embedding-3-small'),
  embeddingProvider,
} = {}) {
  const queryKey = normalizeQueryKey(query);
  if (!queryKey || !question) {
    return [];
  }

  const providerInstance = embeddingProvider ?? createEmbeddingProvider({ provider, model });
  const providerName = providerInstance.provider || provider;
  const modelName = providerInstance.model || model;
  const queryEmbedding = await providerInstance.embedTexts([question]);
  const queryVector = queryEmbedding.vectors[0] ?? [];
  if (queryVector.length === 0) {
    return [];
  }

  const rows = db.prepare(`
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
      e.vector_json
    FROM embeddings e
    JOIN chunks c ON c.chunk_id = e.chunk_id
    JOIN articles a ON a.article_id = c.article_id
    WHERE c.query_key = ?
      AND e.provider = ?
      AND e.model = ?
  `).all(queryKey, providerName, modelName);

  return rows
    .map((row) => mapSemanticRow(row, cosineSimilarity(queryVector, parseVector(row.vector_json))))
    .filter((row) => Number.isFinite(row.score))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}
