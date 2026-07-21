import {
  buildSearchUrl,
  completedSourceResult,
  extractBlocks,
  extractFirst,
  extractHref,
  fetchJson,
  parseDoi,
  parseYear,
  readFixtureFile,
  resolvePdfMetadata,
  skippedSourceResult,
  splitAuthors,
} from './common.mjs';

const DEFAULT_SCIELO_URL = 'https://search.scielo.org/';
const DEFAULT_SCIELO_API_URL = 'https://search.scielo.org/';

function firstLanguageValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return firstLanguageValue(value[0]);
  }

  if (value && typeof value === 'object') {
    return value.en ?? value.pt ?? value.es ?? Object.values(value).find(Boolean) ?? '';
  }

  return '';
}

function normalizeScieloAuthors(authors) {
  if (!Array.isArray(authors)) {
    return [];
  }

  return authors
    .map((author) => (typeof author === 'string'
      ? author
      : (author?.name ?? author?.full_name ?? author?.surname_names ?? author?.displayName ?? '')))
    .filter(Boolean);
}

function mapScieloItem(item, query, retrievedAt) {
  const pdf = resolvePdfMetadata({
    pdfUrl: item.pdf_url,
    pdfAvailable: item.pdf_available,
  });

  return {
    source: 'scielo',
    source_id: item.id ?? item.doi ?? item.url ?? '',
    title: item.title ?? '',
    authors: item.authors ?? [],
    year: item.year ?? item.publication_year ?? item.date ?? '',
    venue: item.venue ?? item.journal ?? item.source ?? '',
    doi: item.doi ?? '',
    url: item.url ?? '',
    abstract: item.abstract ?? '',
    pdf_available: pdf.pdf_available,
    pdf_url: pdf.pdf_url,
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

function mapScieloApiDoc(doc, query, retrievedAt) {
  const pid = doc.pid ?? doc.code ?? doc.id ?? '';
  const doi = firstLanguageValue(doc.doi) || parseDoi(firstLanguageValue(doc.url));
  const pdfUrl = firstLanguageValue(doc.pdf_url ?? doc.pdf ?? doc.pdfUrl ?? doc.fulltext_pdf ?? doc.fulltext_url_pdf);
  const pdf = resolvePdfMetadata({
    pdfUrl,
    pdfAvailable: doc.pdf_available,
  });

  return {
    source: 'scielo',
    source_id: pid || doi || firstLanguageValue(doc.url),
    title: firstLanguageValue(doc.title),
    authors: normalizeScieloAuthors(doc.authors ?? doc.author),
    year: doc.publication_year ?? doc.year ?? parseYear(doc.publication_date ?? doc.date),
    venue: firstLanguageValue(doc.journal_title ?? doc.source ?? doc.venue ?? doc.journal),
    doi,
    url: firstLanguageValue(doc.url) || (pid ? `https://scielo.org/article/${pid}` : ''),
    abstract: firstLanguageValue(doc.abstract),
    pdf_available: pdf.pdf_available,
    pdf_url: pdf.pdf_url,
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

function extractScieloPayloadRecords(payload) {
  return payload.docs
    ?? payload.results
    ?? payload.items
    ?? payload.objects
    ?? [];
}

function extractScieloSourceId(url, fallback, doi) {
  if (fallback) {
    return fallback;
  }

  if (doi) {
    return doi;
  }

  const match = String(url ?? '').match(/pid=([^&?#]+)/i);
  return match ? match[1] : '';
}

export async function extractScieloResultsFromPage(page, { query, limit, retrievedAt }) {
  const html = await page.content();
  return extractScieloResultsFromHtml(html, {
    query,
    limit,
    retrievedAt,
    baseUrl: page.url?.() ?? DEFAULT_SCIELO_URL,
  });
}

export function extractScieloResultsFromHtml(html, { query, limit, retrievedAt, baseUrl = DEFAULT_SCIELO_URL }) {
  const articleBlocks = extractBlocks(html, /<article\b[^>]*>[\s\S]*?<\/article>/gi);
  const itemBlocks = extractBlocks(html, /<div\b[^>]*class="[^"]*item[^"]*"[^>]*>[\s\S]*?<\/div>[\s\S]*?<\/div>/gi);
  const fallbackBlocks = articleBlocks.length > 0 ? articleBlocks : itemBlocks;

  return fallbackBlocks
    .slice(0, limit)
    .map((block) => {
      const url = extractHref(block, [
        /<h[23][^>]*[\s\S]*?<a[^>]*href="([^"]+)"/i,
        /<a[^>]*class="[^"]*(?:title|result-title)[^"]*"[^>]*href="([^"]+)"/i,
        /<a[^>]*href="([^"]*(?:scielo|article|pid=)[^"]*)"/i,
      ], baseUrl);
      const doi = parseDoi(extractFirst(block, [
        /<[^>]*class="[^"]*doi[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        /data-doi="([^"]+)"/i,
      ])) || parseDoi(url);
      const authors = extractFirst(block, [
        /<[^>]*class="[^"]*(?:authors?|autores?)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i,
      ]);
      const pdf = resolvePdfMetadata({
        pdfUrl: extractHref(block, [
          /<a[^>]*class="[^"]*pdf[^"]*"[^>]*href="([^"]+)"/i,
          /<a[^>]*href="([^"]*\.pdf[^"]*)"/i,
          /<a[^>]*href="([^"]*\/pdf\/[^"]*)"/i,
        ], baseUrl),
      });

      return {
        source: 'scielo',
        source_id: extractScieloSourceId(url, extractFirst(block, [
          /data-scielo-id="([^"]+)"/i,
          /data-pid="([^"]+)"/i,
        ]), doi),
        title: extractFirst(block, [
          /<h[23][^>]*[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
          /<a[^>]*class="[^"]*(?:title|result-title)[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
        ]),
        authors: splitAuthors(authors),
        year: parseYear(extractFirst(block, [
          /<[^>]*class="[^"]*(?:year|date|publication-date)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i,
          /<time[^>]*>([\s\S]*?)<\/time>/i,
        ])),
        venue: extractFirst(block, [
          /<[^>]*class="[^"]*(?:journal|source|venue|collection)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        ]),
        doi,
        url,
        abstract: extractFirst(block, [
          /<[^>]*class="[^"]*(?:abstract|snippet|description|resumo)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        ]),
        pdf_available: pdf.pdf_available,
        pdf_url: pdf.pdf_url,
        matched_query: query,
        retrieved_at: retrievedAt,
      };
    })
    .filter((record) => record.title || record.url || record.doi);
}

export async function runScieloSearch({ query, sourceConfig, fixtureDir, retrievedAt, browserRuntime, browserStartupError, limit, fetchImpl }) {
  if (!sourceConfig.enabled) {
    return skippedSourceResult('scielo', 'Source disabled');
  }

  if (sourceConfig.mode === 'fixture') {
    const payload = readFixtureFile(fixtureDir, sourceConfig.fixture);
    const items = payload.items ?? extractScieloPayloadRecords(payload);
    return completedSourceResult(
      'scielo',
      items.slice(0, limit).map((item) => mapScieloItem(item, query, retrievedAt)),
    );
  }

  if (sourceConfig.mode === 'api') {
    try {
      const payload = await fetchJson(
        fetchImpl,
        buildSearchUrl(sourceConfig.api_url ?? DEFAULT_SCIELO_API_URL, sourceConfig.query_param ?? 'q', query, {
          format: 'json',
          [sourceConfig.limit_param ?? 'count']: limit,
          ...(sourceConfig.collection ? { collection: sourceConfig.collection } : {}),
        }),
        { sourceLabel: 'SciELO API', defaultHeaders: false },
      );
      const docs = extractScieloPayloadRecords(payload);
      return completedSourceResult(
        'scielo',
        docs.slice(0, limit).map((doc) => mapScieloApiDoc(doc, query, retrievedAt)),
      );
    } catch (error) {
      return skippedSourceResult('scielo', `SciELO API search failed: ${error.message}`);
    }
  }

  if (!browserRuntime) {
    return skippedSourceResult('scielo', browserStartupError ? `Browser automation unavailable: ${browserStartupError}` : 'Browser automation unavailable');
  }

  try {
    const records = await browserRuntime.runSearch({
      sourceName: 'scielo',
      searchUrl: buildSearchUrl(sourceConfig.search_url ?? DEFAULT_SCIELO_URL, sourceConfig.query_param ?? 'q', query),
      extractor: extractScieloResultsFromPage,
      query,
      limit,
      retrievedAt,
      waitForSelector: sourceConfig.wait_for_selector ?? 'article, .item, .result, .search-result, .result-item',
      settleTimeMs: sourceConfig.settle_time_ms,
    });
    return completedSourceResult('scielo', records);
  } catch (error) {
    return skippedSourceResult('scielo', `SciELO browser search failed: ${error.message}`);
  }
}
