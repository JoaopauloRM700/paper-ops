#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processBatchQueries } from './src/lib/batch.mjs';
import { routeCliInput, renderHelpMenu } from './src/lib/cli.mjs';
import { readSourcesConfig } from './src/lib/config.mjs';
import { processQueuedSearches } from './src/lib/pipeline.mjs';
import { runSearchAndPersist } from './src/lib/search-runner.mjs';
import { readSearchHistory } from './src/lib/tracker.mjs';
import {
  renderSearchCollectionSummary,
  renderSearchHistorySummary,
  renderSearchRunSummary,
} from './src/lib/terminal-ui.mjs';

export async function main(argv = process.argv.slice(2), io = {}) {
  const { stdout = console.log } = io;
  const routed = routeCliInput(argv);
  const projectRoot = resolve(routed.flags.projectRoot || process.cwd());

  if (routed.mode === 'help' || !routed.query && routed.mode === 'search') {
    stdout(renderHelpMenu());
    return { mode: 'help' };
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
      stdout(renderSearchRunSummary(result));
      return result;
    }
    case 'pipeline': {
      const results = await processQueuedSearches({
        config,
        projectRoot,
        fixtureDir,
      });
      stdout(renderSearchCollectionSummary('pipeline', results));
      return results;
    }
    case 'tracker':
      {
        const history = readSearchHistory(projectRoot);
        stdout(renderSearchHistorySummary(history));
        return history;
      }
    case 'batch': {
      const results = await processBatchQueries({
        config,
        projectRoot,
        fixtureDir,
      });
      stdout(renderSearchCollectionSummary('batch', results));
      return results;
    }
    default:
      stdout(renderHelpMenu());
      return { mode: 'help' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
