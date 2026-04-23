#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportAllQueriesToCsv } from './src/lib/csv-export.mjs';

function main() {
  const results = exportAllQueriesToCsv({
    projectRoot: process.cwd(),
  });

  if (results.length === 0) {
    console.log('No saved search outputs were found.');
    return;
  }

  console.log(`Generated ${results.length} CSV file(s):`);
  for (const result of results) {
    console.log(`- ${result.query} -> ${result.csvPath}`);
  }
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
