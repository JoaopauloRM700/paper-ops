#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportQueryResultsToCsv } from './src/lib/csv-export.mjs';

function main(argv = process.argv.slice(2)) {
  const query = argv.join(' ').trim();

  if (!query) {
    console.error('Usage: node json_to_csv.mjs "<query>"');
    process.exit(1);
  }

  const result = exportQueryResultsToCsv({
    projectRoot: process.cwd(),
    query,
  });

  console.log(`CSV generated at ${result.csvPath}`);
  console.log(`Matching runs: ${result.matchedFiles.length}`);
  console.log(`Unique papers: ${result.uniqueRecords}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export { main };
