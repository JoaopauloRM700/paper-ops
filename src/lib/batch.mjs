import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runSearchAndPersist } from './search-runner.mjs';

function ensureBatchInput(projectRoot) {
  const batchDir = join(projectRoot, 'batch');
  mkdirSync(batchDir, { recursive: true });
  return join(batchDir, 'batch-input.tsv');
}

export function readBatchQueries(projectRoot) {
  const inputPath = ensureBatchInput(projectRoot);
  if (!existsSync(inputPath)) {
    return [];
  }

  return readFileSync(inputPath, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [id, query] = line.split('\t');
      return { id, query };
    })
    .filter((entry) => entry.id && entry.query);
}

export async function processBatchQueries({ config, projectRoot, fixtureDir, now = new Date() }) {
  const entries = readBatchQueries(projectRoot);
  const results = [];

  for (const entry of entries) {
    results.push(await runSearchAndPersist({
      query: entry.query,
      config,
      projectRoot,
      fixtureDir,
      now,
      artifactSuffix: `batch-${entry.id}`,
    }));
  }

  return results;
}
