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

export function renderPdfFetchSummary(result) {
  const rows = result.articles.slice(0, 5).map((article, index) => ({
    index: String(index + 1),
    source: formatSourceName(article.record.source),
    pdf: article.pdf.status,
    title: article.record.title || '-',
  }));

  const sections = [
    'paper-ops fetch-pdfs complete',
    '',
    `Query: ${result.query}`,
    `Matching runs: ${result.matchedFiles.length}`,
    `Unique records: ${result.records.length}`,
    `Downloaded PDFs: ${result.summary.downloaded}`,
    `Cached PDFs: ${result.summary.cached}`,
    `Skipped (no PDF): ${result.summary.skippedNoPdf}`,
    `Failed downloads: ${result.summary.failed}`,
    '',
    'PDF status',
    renderTable(
      [
        { key: 'index', label: '#', width: 2 },
        { key: 'source', label: 'Source', width: 16 },
        { key: 'pdf', label: 'PDF', width: 12 },
        { key: 'title', label: 'Title', width: 54 },
      ],
      rows.length > 0
        ? rows
        : [{ index: '-', source: '-', pdf: '-', title: 'No saved records found' }],
    ),
    '',
    'Artifacts',
    `PDF directory: ${result.artifacts.pdfDirectory}`,
  ];

  return sections.join('\n');
}

export function renderArticleSummaryWorkflowSummary(modeName, result) {
  const rows = result.articles.slice(0, 5).map((article, index) => ({
    index: String(index + 1),
    source: formatSourceName(article.record.source),
    pdf: article.pdf.status,
    text: article.text.status,
    textSource: article.text.source || '-',
    summary: article.summary.status,
    title: article.record.title || '-',
  }));
  const sections = [
    `paper-ops ${modeName} complete`,
    '',
    `Query: ${result.query}`,
    `Matching runs: ${result.matchedFiles.length}`,
    `Unique records: ${result.records.length}`,
    `Downloaded PDFs: ${result.summary.downloaded}`,
    `Cached PDFs: ${result.summary.cached}`,
    `Text extracted: ${result.summary.textExtracted}`,
    `Text cached: ${result.summary.textCached}`,
    `Text from PDFs: ${result.summary.textFromPdf}`,
    `Text from saved abstracts: ${result.summary.textFromRecordAbstract}`,
    `Text from landing pages: ${result.summary.textFromLandingPageAbstract}`,
    `Summaries completed: ${result.summary.summarized}`,
    `Summary failures: ${result.summary.summaryFailed}`,
  ];

  if (result.summary.digestGenerated) {
    sections.push(`Digest generated: ${result.summary.digestGenerated}`);
  }

  sections.push(
    '',
    'Article workflow status',
    renderTable(
      [
        { key: 'index', label: '#', width: 2 },
        { key: 'source', label: 'Source', width: 16 },
        { key: 'pdf', label: 'PDF', width: 12 },
        { key: 'text', label: 'Text', width: 10 },
        { key: 'textSource', label: 'Text Source', width: 20 },
        { key: 'summary', label: 'Summary', width: 10 },
        { key: 'title', label: 'Title', width: 28 },
      ],
      rows.length > 0
        ? rows
        : [{ index: '-', source: '-', pdf: '-', text: '-', textSource: '-', summary: '-', title: 'No saved records found' }],
    ),
    '',
    'Artifacts',
    `PDF directory: ${result.artifacts.pdfDirectory}`,
    `Text directory: ${result.artifacts.textDirectory}`,
    `Summary JSON directory: ${result.artifacts.summaryJsonDirectory}`,
    `Summary markdown directory: ${result.artifacts.summaryMarkdownDirectory}`,
  );

  if (result.artifacts.digestMarkdown) {
    sections.push(`Digest markdown: ${result.artifacts.digestMarkdown}`);
  }

  if (result.artifacts.digestJson) {
    sections.push(`Digest JSON: ${result.artifacts.digestJson}`);
  }

  return sections.join('\n');
}

export function renderQuestionAnswerSummary(result) {
  const evidenceRows = result.answer.supporting_evidence.slice(0, 5).map((entry, index) => ({
    index: String(index + 1),
    page: entry.page || '-',
    title: entry.title || '-',
    quote: entry.quote || '-',
  }));
  const sections = [
    'paper-ops ask complete',
    '',
    `Query: ${result.query}`,
    `Question: ${result.question}`,
    `Articles with text: ${result.articleTexts.length}`,
    `Confidence: ${result.answer.confidence}`,
    '',
    'Answer',
    result.answer.answer,
    '',
    'Supporting evidence',
    renderTable(
      [
        { key: 'index', label: '#', width: 2 },
        { key: 'page', label: 'Page', width: 10 },
        { key: 'title', label: 'Title', width: 34 },
        { key: 'quote', label: 'Quote', width: 58 },
      ],
      evidenceRows.length > 0
        ? evidenceRows
        : [{ index: '-', page: '-', title: '-', quote: 'No direct quote returned' }],
    ),
    '',
    'Artifacts',
    `Answer markdown: ${result.artifacts.answerMarkdown}`,
    `Answer JSON: ${result.artifacts.answerJson}`,
  ];

  return sections.join('\n');
}

export function renderDbInitSummary(result) {
  return [
    'paper-ops db init complete',
    '',
    `Database: ${result.databasePath}`,
  ].join('\n');
}

export function renderRagIndexSummary(result) {
  const sections = [
    'paper-ops index complete',
    '',
    `Query: ${result.query}`,
    `Articles indexed: ${result.summary.articlesIndexed}`,
    `Articles skipped: ${result.summary.articlesSkipped}`,
    `Text failures: ${result.summary.textFailed}`,
    `Chunks indexed: ${result.summary.chunksIndexed}`,
    '',
    `Database: ${result.artifacts.databasePath}`,
  ];

  if (result.ocr) {
    sections.splice(
      7,
      0,
      `OCR succeeded: ${result.ocr.ocrSucceeded}`,
      `OCR skipped: ${result.ocr.ocrSkipped}`,
      `OCR failed: ${result.ocr.ocrFailed}`,
    );
  }

  if (result.embeddings) {
    sections.splice(
      7,
      0,
      `Embedding chunks: ${result.embeddings.chunksEmbedded}`,
      `Embedding skipped: ${result.embeddings.chunksSkipped}`,
    );
  }

  return sections.join('\n');
}

export function renderOcrSummary(result) {
  const rows = result.rows.slice(0, 5).map((row, index) => ({
    index: String(index + 1),
    status: row.status,
    article: row.articleId,
    error: row.error || '-',
  }));

  return [
    'paper-ops ocr complete',
    '',
    `Query: ${result.query}`,
    `Language: ${result.language}`,
    `OCR succeeded: ${result.summary.ocrSucceeded}`,
    `OCR skipped: ${result.summary.ocrSkipped}`,
    `OCR failed: ${result.summary.ocrFailed}`,
    '',
    renderTable(
      [
        { key: 'index', label: '#', width: 2 },
        { key: 'status', label: 'Status', width: 14 },
        { key: 'article', label: 'Article', width: 34 },
        { key: 'error', label: 'Error', width: 48 },
      ],
      rows.length > 0
        ? rows
        : [{ index: '-', status: '-', article: '-', error: 'No saved records found' }],
    ),
    '',
    'Artifacts',
    `Report: ${result.artifacts.reportMarkdown}`,
  ].join('\n');
}

export function renderRagAnswerSummary(result) {
  const evidenceRows = result.answer.supporting_evidence.slice(0, 5).map((entry, index) => ({
    index: String(index + 1),
    page: entry.pageStart || entry.page || '-',
    verified: entry.verified ? 'yes' : 'no',
    title: entry.title || '-',
    quote: entry.quote || '-',
  }));

  return [
    'paper-ops ask complete',
    '',
    `Query: ${result.query}`,
    `Question: ${result.question}`,
    `Retrieval: ${result.retrieval.mode || 'bm25'}`,
    `Retrieved chunks: ${result.retrieval.chunksReturned}`,
    `Confidence: ${result.answer.confidence}`,
    '',
    'Answer',
    result.answer.answer,
    '',
    'Supporting evidence',
    renderTable(
      [
        { key: 'index', label: '#', width: 2 },
        { key: 'page', label: 'Page', width: 10 },
        { key: 'verified', label: 'Verified', width: 8 },
        { key: 'title', label: 'Title', width: 32 },
        { key: 'quote', label: 'Quote', width: 56 },
      ],
      evidenceRows.length > 0
        ? evidenceRows
        : [{ index: '-', page: '-', verified: '-', title: '-', quote: 'No direct quote returned' }],
    ),
    '',
    'Artifacts',
    `Answer markdown: ${result.artifacts.answerMarkdown}`,
    `Answer JSON: ${result.artifacts.answerJson}`,
  ].join('\n');
}

export function renderEmbeddingSummary(result) {
  return [
    'paper-ops embed complete',
    '',
    `Query: ${result.query}`,
    `Provider: ${result.provider}`,
    `Model: ${result.model}`,
    `Dimension: ${result.dimension}`,
    `Chunks total: ${result.summary.chunksTotal}`,
    `Chunks embedded: ${result.summary.chunksEmbedded}`,
    `Chunks skipped: ${result.summary.chunksSkipped}`,
    '',
    `Database: ${result.artifacts.databasePath}`,
  ].join('\n');
}

export function renderEvidenceSummary(result) {
  const rows = result.evidenceChunks.slice(0, 5).map((chunk, index) => ({
    index: String(index + 1),
    page: chunk.pageStart || '-',
    title: chunk.title || '-',
    text: chunk.text || '-',
  }));

  return [
    'paper-ops evidence complete',
    '',
    `Query: ${result.query}`,
    `Question: ${result.question}`,
    `Retrieval: ${result.retrieval?.mode || 'bm25'}`,
    `Evidence chunks: ${result.evidenceChunks.length}`,
    '',
    renderTable(
      [
        { key: 'index', label: '#', width: 2 },
        { key: 'page', label: 'Page', width: 10 },
        { key: 'title', label: 'Title', width: 34 },
        { key: 'text', label: 'Evidence', width: 70 },
      ],
      rows.length > 0
        ? rows
        : [{ index: '-', page: '-', title: '-', text: 'No evidence found' }],
    ),
    '',
    'Artifacts',
    `Evidence markdown: ${result.artifacts.evidenceMarkdown}`,
    `Evidence JSON: ${result.artifacts.evidenceJson}`,
  ].join('\n');
}

export function renderReferencesSummary(result) {
  return [
    'paper-ops references complete',
    '',
    `Query: ${result.query}`,
    `References: ${result.references.length}`,
    '',
    'Artifacts',
    `ABNT: ${result.artifacts.abntPath || '-'}`,
    `BibTeX: ${result.artifacts.bibtexPath || '-'}`,
    `APA: ${result.artifacts.apaPath || '-'}`,
  ].join('\n');
}

export function renderMatrixSummary(result) {
  return [
    'paper-ops matrix complete',
    '',
    `Query: ${result.query}`,
    `Rows: ${result.rows.length}`,
    '',
    'Artifacts',
    `Markdown: ${result.artifacts.matrixMarkdown}`,
    `CSV: ${result.artifacts.matrixCsv}`,
  ].join('\n');
}

export function renderDraftSummary(result) {
  return [
    'paper-ops draft complete',
    '',
    `Query: ${result.query}`,
    `Section: ${result.section}`,
    `Evidence chunks: ${result.evidenceChunks.length}`,
    '',
    'Artifacts',
    `Draft markdown: ${result.artifacts.draftMarkdown}`,
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
