import { createHash } from 'node:crypto';

import { normalizeQueryKey } from '../../article-texts.mjs';
import { openPaperOpsDatabase } from '../../db/database.mjs';
import { initializePaperOpsSchema } from '../../db/schema.mjs';
import { createEmbeddingProvider } from './provider.mjs';

function textHash(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex');
}

function buildEmbeddingRunId(queryKey, provider, model, now) {
  const hash = createHash('sha1')
    .update(`${queryKey}\n${provider}\n${model}\n${now.toISOString()}`)
    .digest('hex')
    .slice(0, 10);
  return `embedding-${now.toISOString().replace(/[:.]/g, '-')}-${hash}`;
}

function loadChunksNeedingEmbeddings(db, { queryKey, provider, model, refreshEmbeddings }) {
  const chunks = db.prepare(`
    SELECT c.chunk_id, c.text
    FROM chunks c
    WHERE c.query_key = ?
    ORDER BY c.chunk_index
  `).all(queryKey);

  if (refreshEmbeddings) {
    return { chunksTotal: chunks.length, chunksToEmbed: chunks, chunksSkipped: 0 };
  }

  const existing = db.prepare(`
    SELECT text_hash
    FROM embeddings
    WHERE chunk_id = ? AND provider = ? AND model = ?
  `);
  const chunksToEmbed = [];
  let chunksSkipped = 0;
  for (const chunk of chunks) {
    const hash = textHash(chunk.text);
    const row = existing.get(chunk.chunk_id, provider, model);
    if (row?.text_hash === hash) {
      chunksSkipped += 1;
    } else {
      chunksToEmbed.push(chunk);
    }
  }

  return { chunksTotal: chunks.length, chunksToEmbed, chunksSkipped };
}

export async function embedQueryChunks({
  projectRoot,
  query,
  provider = process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
  model = process.env.PAPER_OPS_EMBEDDING_MODEL || (provider === 'fixture' ? 'fixture-64' : 'text-embedding-3-small'),
  refreshEmbeddings = false,
  now = new Date(),
  databasePath,
  embeddingProvider,
} = {}) {
  const queryKey = normalizeQueryKey(query);
  const db = openPaperOpsDatabase({ projectRoot, databasePath });
  initializePaperOpsSchema(db);
  const providerInstance = embeddingProvider ?? createEmbeddingProvider({ provider, model });
  const providerName = providerInstance.provider || provider;
  const modelName = providerInstance.model || model;
  const embeddingRunId = buildEmbeddingRunId(queryKey, providerName, modelName, now);
  const timestamp = now.toISOString();

  try {
    const { chunksTotal, chunksToEmbed, chunksSkipped } = loadChunksNeedingEmbeddings(db, {
      queryKey,
      provider: providerName,
      model: modelName,
      refreshEmbeddings,
    });
    const texts = chunksToEmbed.map((chunk) => chunk.text);
    const embeddingResult = await providerInstance.embedTexts(texts);
    const dimension = embeddingResult.dimension ?? embeddingResult.vectors[0]?.length ?? 0;

    const work = db.transaction(() => {
      db.prepare(`
        INSERT INTO embedding_runs (
          embedding_run_id, query_key, provider, model, dimension, status,
          chunks_total, chunks_embedded, error, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        embeddingRunId,
        queryKey,
        providerName,
        modelName,
        dimension,
        'embedded',
        chunksTotal,
        chunksToEmbed.length,
        '',
        timestamp,
        timestamp,
      );

      const insert = db.prepare(`
        INSERT INTO embeddings (
          chunk_id, provider, model, vector_json, created_at, dimension, text_hash, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
          vector_json = excluded.vector_json,
          dimension = excluded.dimension,
          text_hash = excluded.text_hash,
          updated_at = excluded.updated_at
      `);

      for (const [index, chunk] of chunksToEmbed.entries()) {
        insert.run(
          chunk.chunk_id,
          providerName,
          modelName,
          JSON.stringify(embeddingResult.vectors[index] ?? []),
          timestamp,
          dimension,
          textHash(chunk.text),
          timestamp,
        );
      }
    });
    work();

    return {
      query,
      queryKey,
      provider: providerName,
      model: modelName,
      dimension,
      summary: {
        chunksTotal,
        chunksEmbedded: chunksToEmbed.length,
        chunksSkipped,
      },
      artifacts: {
        databasePath: db.name,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      INSERT INTO embedding_runs (
        embedding_run_id, query_key, provider, model, dimension, status,
        chunks_total, chunks_embedded, error, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(embeddingRunId, queryKey, providerName, modelName, 0, 'failed', 0, 0, message, timestamp, timestamp);
    throw error;
  } finally {
    db.close();
  }
}
