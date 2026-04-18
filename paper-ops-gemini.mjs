#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGeminiPaperOps } from './src/lib/gemini-cli.mjs';

async function main(argv = process.argv.slice(2)) {
  await runGeminiPaperOps(argv);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { main };
