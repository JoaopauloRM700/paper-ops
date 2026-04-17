import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runSearchAndPersist } from './search-runner.mjs';

const QUEUE_HEADER = '# Search Queue\n\n## Pending\n';

export function ensureSearchQueue(projectRoot) {
  const queuePath = join(projectRoot, 'data', 'search-queue.md');
  if (!existsSync(queuePath)) {
    writeFileSync(queuePath, `${QUEUE_HEADER}`, 'utf8');
  }

  return queuePath;
}

export function readPendingQueries(projectRoot) {
  const queuePath = ensureSearchQueue(projectRoot);
  const lines = readFileSync(queuePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('- [ ] '));

  return lines.map((line) => line.replace('- [ ] ', '').trim()).filter(Boolean);
}

export async function processQueuedSearches({ config, projectRoot, fixtureDir, now = new Date() }) {
  const queries = readPendingQueries(projectRoot);
  const results = [];

  for (const query of queries) {
    const result = await runSearchAndPersist({
      query,
      config,
      projectRoot,
      fixtureDir,
      now,
    });
    results.push(result);
  }

  if (queries.length > 0) {
    const queuePath = ensureSearchQueue(projectRoot);
    const content = readFileSync(queuePath, 'utf8');
    let updated = content;
    for (const query of queries) {
      updated = updated.replace(`- [ ] ${query}`, `- [x] ${query}`);
    }
    writeFileSync(queuePath, updated, 'utf8');
  }

  return results;
}
