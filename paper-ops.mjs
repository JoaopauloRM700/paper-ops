#!/usr/bin/env node

import { resolve } from 'node:path';

import { processBatchQueries } from './src/lib/batch.mjs';
import { routeCliInput, renderHelpMenu } from './src/lib/cli.mjs';
import { readSourcesConfig } from './src/lib/config.mjs';
import { processQueuedSearches } from './src/lib/pipeline.mjs';
import { runSearchAndPersist } from './src/lib/search-runner.mjs';
import { readSearchHistory } from './src/lib/tracker.mjs';

async function main() {
  const routed = routeCliInput(process.argv.slice(2));
  const projectRoot = resolve(routed.flags.projectRoot || process.cwd());

  if (routed.mode === 'help' || !routed.query && routed.mode === 'search') {
    console.log(renderHelpMenu());
    return;
  }

  const config = readSourcesConfig(projectRoot);
  if (routed.flags.fixtures) {
    config.defaults.fixture_mode = true;
    for (const [sourceName, sourceConfig] of Object.entries(config.sources)) {
      sourceConfig.mode = sourceConfig.fixture ? 'fixture' : sourceConfig.mode;
      if (sourceName === 'google_scholar' && !sourceConfig.fixture) {
        sourceConfig.enabled = false;
      }
    }
  }

  const fixtureDir = new URL('./tests/fixtures/', import.meta.url);

  switch (routed.mode) {
    case 'search': {
      const result = await runSearchAndPersist({
        query: routed.query,
        config,
        projectRoot,
        fixtureDir,
      });
      console.log(`Saved markdown report: ${result.artifacts.markdownReport}`);
      console.log(`Saved JSON export: ${result.artifacts.jsonExport}`);
      break;
    }
    case 'pipeline': {
      const results = await processQueuedSearches({
        config,
        projectRoot,
        fixtureDir,
      });
      console.log(`Processed ${results.length} queued search(es).`);
      break;
    }
    case 'tracker':
      console.log(readSearchHistory(projectRoot));
      break;
    case 'batch': {
      const results = await processBatchQueries({
        config,
        projectRoot,
        fixtureDir,
      });
      console.log(`Processed ${results.length} batch search(es).`);
      break;
    }
    default:
      console.log(renderHelpMenu());
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
