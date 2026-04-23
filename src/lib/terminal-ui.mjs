function normalizeText(value) {
  return String(value ?? '').trim();
}

function truncate(value, maxWidth) {
  const text = normalizeText(value) || '-';
  if (text.length <= maxWidth) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxWidth - 3))}...`;
}

function padCell(value, width) {
  return truncate(value, width).padEnd(width, ' ');
}

function renderTable(columns, rows) {
  const header = columns.map((column) => padCell(column.label, column.width)).join('  ');
  const divider = columns.map((column) => ''.padEnd(column.width, '-')).join('  ');
  const body = rows.map((row) =>
    columns
      .map((column) => padCell(row[column.key], column.width))
      .join('  '),
  );

  return [header, divider, ...body].join('\n');
}

function formatPdfAvailability(value) {
  if (value === true) {
    return 'yes';
  }

  if (value === false) {
    return 'no';
  }

  return 'unknown';
}

function formatSourceName(sourceName) {
  return normalizeText(sourceName).replace(/_/g, ' ') || '-';
}

function renderResultLinks(records, maxResults) {
  const lines = [];

  for (const [index, record] of records.slice(0, maxResults).entries()) {
    lines.push(`[${index + 1}] URL: ${record.url || '-'}`);
    lines.push(`    PDF: ${record.pdf_url || '-'}`);
    lines.push(`    DOI: ${record.doi || '-'}`);
  }

  return lines.join('\n');
}

export function renderSearchRunSummary(result, options = {}) {
  const maxResults = options.maxResults ?? 5;
  const coverageRows = Object.entries(result.summary.sourceCoverage).map(([source, details]) => ({
    source: formatSourceName(source),
    status: details.status,
    records: String(details.records),
    reason: details.reason || '-',
  }));
  const resultRows = result.records.slice(0, maxResults).map((record, index) => ({
    index: String(index + 1),
    year: record.year ?? '-',
    source: formatSourceName(record.source),
    pdf: formatPdfAvailability(record.pdf_available),
    title: record.title || '-',
  }));

  const sections = [
    'paper-ops search complete',
    '',
    `Query: ${result.query}`,
    `Generated: ${result.now.toISOString()}`,
    `Raw records: ${result.summary.totalRawRecords}`,
    `Unique records: ${result.summary.uniqueRecords}`,
    `Duplicates removed: ${result.summary.duplicatesRemoved}`,
    '',
    'Source coverage',
    renderTable(
      [
        { key: 'source', label: 'Source', width: 16 },
        { key: 'status', label: 'Status', width: 10 },
        { key: 'records', label: 'Records', width: 7 },
        { key: 'reason', label: 'Reason', width: 40 },
      ],
      coverageRows,
    ),
    '',
    'Results',
    renderTable(
      [
        { key: 'index', label: '#', width: 2 },
        { key: 'year', label: 'Year', width: 4 },
        { key: 'source', label: 'Source', width: 16 },
        { key: 'pdf', label: 'PDF', width: 7 },
        { key: 'title', label: 'Title', width: 52 },
      ],
      resultRows.length > 0
        ? resultRows
        : [{ index: '-', year: '-', source: '-', pdf: '-', title: 'No results' }],
    ),
  ];

  if (result.records.length > 0) {
    sections.push('', 'Result links', renderResultLinks(result.records, maxResults));
  }

  if (result.records.length > maxResults) {
    sections.push('', `... ${result.records.length - maxResults} more result(s) saved to the report and JSON export.`);
  }

  if (result.artifacts) {
    sections.push(
      '',
      'Saved artifacts',
      `Markdown: ${result.artifacts.markdownReport}`,
      `JSON: ${result.artifacts.jsonExport}`,
      `History: ${result.artifacts.historyIndex}`,
    );
  }

  return sections.join('\n');
}

export function renderCsvExportSummary(result) {
  return [
    'paper-ops csv complete',
    '',
    `Query: ${result.query}`,
    `Matching runs: ${result.matchedFiles.length}`,
    `Raw records: ${result.totalRawRecords}`,
    `Unique records: ${result.uniqueRecords}`,
    `Duplicates removed: ${result.duplicatesRemoved}`,
    '',
    'Saved artifact',
    `CSV: ${result.csvPath}`,
  ].join('\n');
}

export function renderSearchCollectionSummary(modeName, results) {
  if (results.length === 0) {
    return `paper-ops ${modeName}\n\nNo searches were processed.`;
  }

  const rows = results.map((result, index) => ({
    index: String(index + 1),
    query: result.query,
    unique: String(result.summary.uniqueRecords),
    report: result.artifacts?.markdownReport ?? '-',
  }));

  return [
    `paper-ops ${modeName} complete`,
    '',
    `Processed searches: ${results.length}`,
    '',
    renderTable(
      [
        { key: 'index', label: '#', width: 2 },
        { key: 'query', label: 'Query', width: 48 },
        { key: 'unique', label: 'Unique', width: 6 },
        { key: 'report', label: 'Report', width: 54 },
      ],
      rows,
    ),
  ].join('\n');
}

function parseMarkdownTable(historyText) {
  return historyText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---'))
    .slice(1)
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 6);
}

export function renderSearchHistorySummary(historyText) {
  const rows = parseMarkdownTable(historyText);

  if (rows.length === 0) {
    return 'paper-ops tracker\n\nNo runs yet.';
  }

  return [
    'paper-ops tracker',
    '',
    renderTable(
      [
        { key: 'date', label: 'Date', width: 10 },
        { key: 'query', label: 'Query', width: 46 },
        { key: 'raw', label: 'Raw', width: 4 },
        { key: 'unique', label: 'Unique', width: 6 },
        { key: 'report', label: 'Report', width: 18 },
        { key: 'json', label: 'JSON', width: 18 },
      ],
      rows.map((cells) => ({
        date: cells[0],
        query: cells[1],
        raw: cells[2],
        unique: cells[3],
        report: cells[4],
        json: cells[5],
      })),
    ),
  ].join('\n');
}
