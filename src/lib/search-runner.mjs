import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { runSourceSearch } from './adapters/index.mjs';
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

function buildRunId(query, now) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${now.toISOString().slice(0, 10)}-${slugify(query) || 'search'}-${timestamp}`;
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
  const formatSourceName = (sourceName) =>
    sourceName
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const coverageRows = Object.entries(summary.sourceCoverage)
    .map(([source, details]) => `| ${formatSourceName(source)} | ${details.status} | ${details.records} | ${details.reason || '-'} |`)
    .join('\n');

  const recordRows = records
    .map((record, index) => `| ${index + 1} | ${record.source} | ${record.title} | ${record.year ?? '-'} | ${record.venue || '-'} | ${record.doi || '-'} | ${record.url} |`)
    .join('\n');

  return `# Academic Paper Search Report\n\n**Query:** ${query}\n**Generated At:** ${now.toISOString()}\n**Raw Records:** ${summary.totalRawRecords}\n**Unique Records:** ${records.length}\n**Duplicates Removed:** ${summary.duplicatesRemoved}\n\n## Source Coverage\n\n| Source | Status | Records | Reason |\n|---|---|---:|---|\n${coverageRows}\n\n## Results\n\n| # | Source | Title | Year | Venue | DOI | URL |\n|---|---|---|---:|---|---|---|\n${recordRows || '| - | - | No results | - | - | - | - |'}\n`;
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
  const relativeMarkdown = markdownPath.replace(/\\/g, '/');
  const relativeJson = jsonPath.replace(/\\/g, '/');
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
}) {
  const retrievedAt = now.toISOString();
  const limit = config.defaults.per_source_limit;
  const sourceNames = Object.keys(config.sources);
  const sourceResults = [];

  for (const sourceName of sourceNames) {
    const result = await runSourceSearch(sourceName, {
      query,
      sourceConfig: config.sources[sourceName],
      env,
      fixtureDir,
      retrievedAt,
      fetchImpl,
      limit,
    });
    sourceResults.push(result);
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
}) {
  ensureProjectDirs(projectRoot);
  const runId = buildRunId(query, now);
  const searchResult = await runConfiguredSearch({
    query,
    config,
    fixtureDir,
    env,
    now,
    fetchImpl,
  });

  const markdownPath = join('reports', `${runId}.md`);
  const jsonPath = join('output', `${runId}.json`);
  const historyPath = ensureHistoryIndex(projectRoot);

  writeFileSync(
    join(projectRoot, markdownPath),
    renderMarkdownReport({
      query,
      now,
      summary: searchResult.summary,
      records: searchResult.records,
    }),
    'utf8',
  );

  writeFileSync(
    join(projectRoot, jsonPath),
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
      markdownReport: join(projectRoot, markdownPath),
      jsonExport: join(projectRoot, jsonPath),
      historyIndex: historyPath,
    },
  };
}
