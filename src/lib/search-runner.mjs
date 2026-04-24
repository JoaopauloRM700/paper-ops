import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { runSourceSearch } from './adapters/index.mjs';
import { createPlaywrightBrowserRuntime } from './browser-runtime.mjs';
import { deduplicatePaperRecords } from './papers.mjs';

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function ensureProjectDirs(projectRoot) {
  for (const directory of ['data', 'reports', 'output']) {
    mkdirSync(join(projectRoot, directory), { recursive: true });
  }
}

function buildRunId(query, now, artifactSuffix = '') {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const suffix = slugify(artifactSuffix);
  return `${now.toISOString().slice(0, 10)}-${slugify(query) || 'search'}-${timestamp}${suffix ? `-${suffix}` : ''}`;
}

function buildSourceCoverage(sourceResults) {
  return Object.fromEntries(
    sourceResults.map((result) => [
      result.source,
      {
        status: result.status,
        reason: result.reason ?? '',
        records: result.records.length,
      },
    ]),
  );
}

function renderMarkdownReport({ query, now, summary, records }) {
  const formatPdfAvailability = (value) => {
    if (value === true) {
      return 'yes';
    }

    if (value === false) {
      return 'no';
    }

    return 'unknown';
  };

  const formatSourceName = (sourceName) =>
    sourceName
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const coverageRows = Object.entries(summary.sourceCoverage)
    .map(([source, details]) => `| ${formatSourceName(source)} | ${details.status} | ${details.records} | ${details.reason || '-'} |`)
    .join('\n');

  const recordRows = records
    .map((record, index) => `| ${index + 1} | ${record.source} | ${record.title} | ${record.year ?? '-'} | ${record.venue || '-'} | ${record.doi || '-'} | ${formatPdfAvailability(record.pdf_available)} | ${record.pdf_url || '-'} | ${record.url} |`)
    .join('\n');

  return `# Academic Paper Search Report\n\n**Query:** ${query}\n**Generated At:** ${now.toISOString()}\n**Raw Records:** ${summary.totalRawRecords}\n**Unique Records:** ${records.length}\n**Duplicates Removed:** ${summary.duplicatesRemoved}\n\n## Source Coverage\n\n| Source | Status | Records | Reason |\n|---|---|---:|---|\n${coverageRows}\n\n## Results\n\n| # | Source | Title | Year | Venue | DOI | PDF Available | PDF URL | URL |\n|---|---|---|---:|---|---|---|---|---|\n${recordRows || '| - | - | No results | - | - | - | - | - | - |'}\n`;
}

function ensureHistoryIndex(projectRoot) {
  const historyPath = join(projectRoot, 'data', 'search-history.md');
  if (!existsSync(historyPath)) {
    writeFileSync(
      historyPath,
      '# Search History\n\n| Date | Query | Raw | Unique | Report | JSON |\n|---|---|---:|---:|---|---|\n',
      'utf8',
    );
  }

  return historyPath;
}

function appendHistoryEntry(historyPath, { now, query, summary, markdownPath, jsonPath }) {
  const historyDir = dirname(historyPath);
  const relativeMarkdown = relative(historyDir, markdownPath).replace(/\\/g, '/');
  const relativeJson = relative(historyDir, jsonPath).replace(/\\/g, '/');
  const current = readFileSync(historyPath, 'utf8');
  const nextLine = `| ${now.toISOString().slice(0, 10)} | ${query} | ${summary.totalRawRecords} | ${summary.uniqueRecords} | [report](${relativeMarkdown}) | [json](${relativeJson}) |\n`;
  writeFileSync(historyPath, `${current}${nextLine}`, 'utf8');
}

export async function runConfiguredSearch({
  query,
  config,
  fixtureDir,
  env = process.env,
  now = new Date(),
  fetchImpl = fetch,
  browserRuntime,
  browserFactory = createPlaywrightBrowserRuntime,
}) {
  const retrievedAt = now.toISOString();
  const sourceNames = Object.keys(config.sources);
  const sourceResults = [];
  const hasLiveSource = sourceNames.some((sourceName) => config.sources[sourceName]?.enabled && config.sources[sourceName]?.mode === 'live');
  let ownedBrowserRuntime = null;
  let browserStartupError = '';

  if (!browserRuntime && hasLiveSource) {
    try {
      ownedBrowserRuntime = await browserFactory(config.defaults);
    } catch (error) {
      browserStartupError = error instanceof Error ? error.message : String(error);
    }
  }

  const activeBrowserRuntime = browserRuntime ?? ownedBrowserRuntime;

  try {
    for (const sourceName of sourceNames) {
      const sourceConfig = config.sources[sourceName];
      const result = await runSourceSearch(sourceName, {
        query,
        sourceConfig,
        env,
        fixtureDir,
        retrievedAt,
        fetchImpl,
        limit: sourceConfig.limit ?? config.defaults.per_source_limit,
        browserRuntime: activeBrowserRuntime,
        browserStartupError,
      });
      sourceResults.push(result);
    }
  } finally {
    if (ownedBrowserRuntime) {
      await ownedBrowserRuntime.close();
    }
  }

  const rawRecords = sourceResults.flatMap((result) => result.records);
  const deduped = deduplicatePaperRecords(rawRecords);

  return {
    query,
    now,
    sourceResults,
    rawRecords,
    records: deduped.uniqueRecords,
    summary: {
      totalRawRecords: rawRecords.length,
      duplicatesRemoved: deduped.stats.duplicatesRemoved,
      uniqueRecords: deduped.uniqueRecords.length,
      removedByRule: deduped.stats.removedByRule,
      sourceCoverage: buildSourceCoverage(sourceResults),
    },
  };
}

export async function runSearchAndPersist({
  query,
  config,
  projectRoot,
  fixtureDir,
  env = process.env,
  now = new Date(),
  fetchImpl = fetch,
  browserRuntime,
  browserFactory,
  artifactSuffix = '',
}) {
  ensureProjectDirs(projectRoot);
  const runId = buildRunId(query, now, artifactSuffix);
  const searchResult = await runConfiguredSearch({
    query,
    config,
    fixtureDir,
    env,
    now,
    fetchImpl,
    browserRuntime,
    browserFactory,
  });

  const markdownRelativePath = join('reports', `${runId}.md`);
  const jsonRelativePath = join('output', `${runId}.json`);
  const markdownPath = join(projectRoot, markdownRelativePath);
  const jsonPath = join(projectRoot, jsonRelativePath);
  const historyPath = ensureHistoryIndex(projectRoot);

  writeFileSync(
    markdownPath,
    renderMarkdownReport({
      query,
      now,
      summary: searchResult.summary,
      records: searchResult.records,
    }),
    'utf8',
  );

  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        query,
        generatedAt: now.toISOString(),
        summary: searchResult.summary,
        records: searchResult.records,
      },
      null,
      2,
    ),
    'utf8',
  );

  appendHistoryEntry(historyPath, {
    now,
    query,
    summary: searchResult.summary,
    markdownPath,
    jsonPath,
  });

  return {
    ...searchResult,
    artifacts: {
      markdownReport: markdownPath,
      jsonExport: jsonPath,
      historyIndex: historyPath,
    },
  };
}
