#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processBatchQueries } from './src/lib/batch.mjs';
import { digestQueryArticles, fetchQueryPdfs, summarizeQueryArticles } from './src/lib/article-digest.mjs';
import { routeCliInput, renderHelpMenu } from './src/lib/cli.mjs';
import { readSourcesConfig } from './src/lib/config.mjs';
import { exportQueryResultsToCsv } from './src/lib/csv-export.mjs';
import { processQueuedSearches } from './src/lib/pipeline.mjs';
import { resolveQueryInput } from './src/lib/research-profile.mjs';
import { runSearchAndPersist } from './src/lib/search-runner.mjs';
import { readSearchHistory } from './src/lib/tracker.mjs';
import {
  renderCsvExportSummary,
  renderPdfFetchSummary,
  renderArticleSummaryWorkflowSummary,
  renderSearchCollectionSummary,
  renderSearchHistorySummary,
  renderSearchRunSummary,
} from './src/lib/terminal-ui.mjs';

export async function main(argv = process.argv.slice(2), io = {}) {
  const { stdout = console.log } = io;
  const routed = routeCliInput(argv);
  const projectRoot = resolve(routed.flags.projectRoot || process.cwd());

  if (routed.mode === 'help' || (!routed.query && (routed.mode === 'search' || routed.mode === 'csv'))) {
    stdout(renderHelpMenu());
    return { mode: 'help' };
  }

  if (!routed.query && ['fetch-pdfs', 'summarize', 'digest'].includes(routed.mode)) {
    stdout(renderHelpMenu());
    return { mode: 'help' };
  }

  const fixtureDir = new URL('./tests/fixtures/', import.meta.url);

  function loadConfiguredSources() {
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

    return config;
  }

  switch (routed.mode) {
    case 'search': {
      const config = loadConfiguredSources();
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const result = await runSearchAndPersist({
        query: resolved.query,
        profile: resolved.profile,
        config,
        projectRoot,
        fixtureDir,
      });
      stdout(renderSearchRunSummary(result));
      return result;
    }
    case 'pipeline': {
      const config = loadConfiguredSources();
      const results = await processQueuedSearches({
        config,
        projectRoot,
        fixtureDir,
      });
      stdout(renderSearchCollectionSummary('pipeline', results));
      return results;
    }
    case 'csv': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const result = exportQueryResultsToCsv({
        projectRoot,
        query: resolved.query,
      });
      stdout(renderCsvExportSummary(result));
      return result;
    }
    case 'fetch-pdfs': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const result = await fetchQueryPdfs({
        projectRoot,
        query: resolved.query,
      });
      stdout(renderPdfFetchSummary(result));
      return result;
    }
    case 'summarize': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const result = await summarizeQueryArticles({
        projectRoot,
        query: resolved.query,
      });
      stdout(renderArticleSummaryWorkflowSummary('summarize', result));
      return result;
    }
    case 'digest': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const result = await digestQueryArticles({
        projectRoot,
        query: resolved.query,
      });
      stdout(renderArticleSummaryWorkflowSummary('digest', result));
      return result;
    }
    case 'tracker':
      {
        const history = readSearchHistory(projectRoot);
        stdout(renderSearchHistorySummary(history));
        return history;
      }
    case 'batch': {
      const config = loadConfiguredSources();
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
