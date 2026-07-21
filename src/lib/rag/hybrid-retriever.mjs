import { retrieveEvidenceChunks } from './retriever.mjs';
import { retrieveSemanticChunks } from './semantic-retriever.mjs';

function rrfScore(rank, k = 60) {
  return 1 / (k + rank + 1);
}

function mergeRankedResults(existing, incoming, source, rank) {
  const fused = existing ?? {
    ...incoming,
    score: 0,
    fusedScore: 0,
    bm25Score: null,
    semanticScore: null,
    retrievalMode: 'hybrid',
    retrievalSources: [],
  };

  fused.fusedScore += rrfScore(rank);
  fused.score = fused.fusedScore;
  if (!fused.retrievalSources.includes(source)) {
    fused.retrievalSources.push(source);
  }
  if (source === 'bm25') {
    fused.bm25Score = incoming.score;
  }
  if (source === 'semantic') {
    fused.semanticScore = incoming.semanticScore ?? incoming.score;
  }
  return fused;
}

export async function retrieveHybridChunks({
  db,
  query,
  question,
  topK = 12,
  bm25TopK = Math.max(topK * 2, 20),
  semanticTopK = Math.max(topK * 2, 20),
  embeddingProvider,
  provider,
  model,
} = {}) {
  const bm25Hits = retrieveEvidenceChunks({ db, query, question, topK: bm25TopK })
    .map((hit) => ({
      ...hit,
      retrievalMode: 'bm25',
      retrievalSources: ['bm25'],
    }));
  const semanticHits = await retrieveSemanticChunks({
    db,
    query,
    question,
    topK: semanticTopK,
    embeddingProvider,
    provider,
    model,
  });

  const byChunk = new Map();
  for (const [rank, hit] of bm25Hits.entries()) {
    byChunk.set(hit.chunkId, mergeRankedResults(byChunk.get(hit.chunkId), hit, 'bm25', rank));
  }
  for (const [rank, hit] of semanticHits.entries()) {
    byChunk.set(hit.chunkId, mergeRankedResults(byChunk.get(hit.chunkId), hit, 'semantic', rank));
  }

  return Array.from(byChunk.values())
    .sort((left, right) => right.fusedScore - left.fusedScore)
    .slice(0, topK);
}
