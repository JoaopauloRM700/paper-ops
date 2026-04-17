#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyHistoryLinks(projectRoot = process.cwd(), io = {}) {
  const { stdout = console.log } = io;
  const historyPath = join(projectRoot, 'data', 'search-history.md');

  if (!existsSync(historyPath)) {
    stdout('OK  No search history yet.');
    return { failures: 0, missing: [] };
  }

  const lines = readFileSync(historyPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| 20'));

  let failures = 0;
  const missing = [];

  for (const line of lines) {
    const parts = line.split('|').map((part) => part.trim());
    const reportLink = parts[5] ?? '';
    const jsonLink = parts[6] ?? '';
    const reportMatch = reportLink.match(/\(([^)]+)\)/);
    const jsonMatch = jsonLink.match(/\(([^)]+)\)/);

    if (reportMatch && !existsSync(join(projectRoot, reportMatch[1]))) {
      stdout(`ERR Missing report artifact: ${reportMatch[1]}`);
      failures += 1;
      missing.push(reportMatch[1]);
    }

    if (jsonMatch && !existsSync(join(projectRoot, jsonMatch[1]))) {
      stdout(`ERR Missing json artifact: ${jsonMatch[1]}`);
      failures += 1;
      missing.push(jsonMatch[1]);
    }
  }

  if (failures === 0) {
    stdout('OK  Search history links are valid.');
  }

  return { failures, missing };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = verifyHistoryLinks();
  process.exit(result.failures === 0 ? 0 : 1);
}
