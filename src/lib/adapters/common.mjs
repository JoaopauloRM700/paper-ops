import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizePaperRecord } from '../papers.mjs';

export function readFixtureFile(fixtureDir, fixtureName) {
  const fixtureRoot = fixtureDir instanceof URL ? fixtureDir : new URL(`file://${fixtureDir.replace(/\\/g, '/')}/`);
  const fixtureUrl = new URL(fixtureName, fixtureRoot);
  return JSON.parse(readFileSync(fixtureUrl, 'utf8'));
}

export function completedSourceResult(sourceName, records) {
  return {
    source: sourceName,
    status: 'completed',
    records: records.map((record) => normalizePaperRecord(record)),
  };
}

export function skippedSourceResult(sourceName, reason) {
  return {
    source: sourceName,
    status: 'skipped',
    reason,
    records: [],
  };
}

export function buildFixturePath(projectRoot, fixtureName) {
  return join(projectRoot, 'tests', 'fixtures', fixtureName);
}
