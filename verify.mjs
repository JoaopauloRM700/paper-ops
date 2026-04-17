#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const historyPath = join(projectRoot, 'data', 'search-history.md');

if (!existsSync(historyPath)) {
  console.log('OK  No search history yet.');
  process.exit(0);
}

const lines = readFileSync(historyPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.startsWith('| 20'));

let failures = 0;

for (const line of lines) {
  const parts = line.split('|').map((part) => part.trim());
  const reportLink = parts[5] ?? '';
  const jsonLink = parts[6] ?? '';
  const reportMatch = reportLink.match(/\(([^)]+)\)/);
  const jsonMatch = jsonLink.match(/\(([^)]+)\)/);

  if (reportMatch && !existsSync(join(projectRoot, reportMatch[1]))) {
    console.log(`ERR Missing report artifact: ${reportMatch[1]}`);
    failures += 1;
  }

  if (jsonMatch && !existsSync(join(projectRoot, jsonMatch[1]))) {
    console.log(`ERR Missing json artifact: ${jsonMatch[1]}`);
    failures += 1;
  }
}

if (failures === 0) {
  console.log('OK  Search history links are valid.');
}

process.exit(failures === 0 ? 0 : 1);
