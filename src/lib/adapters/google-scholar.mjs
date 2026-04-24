import {
  buildSearchUrl,
  completedSourceResult,
  extractBlocks,
  extractFirst,
  extractHref,
  parseYear,
  readFixtureFile,
  resolvePdfMetadata,
  skippedSourceResult,
  splitAuthors,
} from './common.mjs';

const DEFAULT_SCHOLAR_URL = 'https://scholar.google.com/scholar';
const SCHOLAR_PAGE_SIZE = 10;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapScholarItem(item, query, retrievedAt) {
  const pdf = resolvePdfMetadata({
    pdfUrl: item.pdf_url,
    pdfAvailable: item.pdf_available,
  });

  return {
    source: 'google_scholar',
    source_id: item.result_id ?? '',
    title: item.title ?? '',
    authors: item.authors ?? [],
    year: item.year ?? '',
    venue: item.venue ?? 'Google Scholar',
    doi: item.doi ?? '',
    url: item.url ?? '',
    abstract: item.abstract ?? '',
    pdf_available: pdf.pdf_available,
    pdf_url: pdf.pdf_url,
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

function parseScholarMeta(metaLine) {
  const parts = String(metaLine ?? '')
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { authors: [], venue: 'Google Scholar', year: '' };
  }

  const year = parseYear(parts[parts.length - 1]);
  const venueIndex = parts.length >= 2 ? parts.length - (year ? 2 : 1) : -1;

  return {
    authors: splitAuthors(parts[0]),
    venue: venueIndex >= 1 ? parts[venueIndex] : 'Google Scholar',
    year,
  };
}

function extractScholarSourceId(url, fallback) {
  if (fallback) {
    return fallback;
  }

  const match = String(url ?? '').match(/[?&]cluster=([^&]+)/i);
  return match ? match[1] : '';
}

export async function extractGoogleScholarResultsFromPage(page, { query, limit, retrievedAt }) {
  const html = await page.content();
  return extractGoogleScholarResultsFromHtml(html, {
    query,
    limit,
    retrievedAt,
    baseUrl: page.url?.() ?? DEFAULT_SCHOLAR_URL,
  });
}

function buildScholarNextPageUrl(currentUrl, query, nextStart) {
  const url = new URL(currentUrl || DEFAULT_SCHOLAR_URL);
  if (!url.searchParams.get('q')) {
    url.searchParams.set('q', query);
  }
  url.searchParams.set('start', String(nextStart));
  return url.toString();
}

function scholarRecordKey(record) {
  if (record.source_id) {
    return `id:${record.source_id}`;
  }

  if (record.url) {
    return `url:${record.url}`;
  }

  return `title:${record.title}|year:${record.year ?? ''}`;
}

export async function extractPaginatedGoogleScholarResultsFromPage(page, {
  query,
  limit,
  retrievedAt,
  loadPage,
  maxPages,
  pageDelayMs,
}) {
  const collected = [];
  const seenKeys = new Set();
  let currentStart = Number(new URL(page.url?.() ?? DEFAULT_SCHOLAR_URL).searchParams.get('start') ?? '0');
  let pagesVisited = 1;
  const requestedMaxPages = Number(maxPages ?? Math.ceil(limit / SCHOLAR_PAGE_SIZE));
  const effectiveMaxPages = Number.isFinite(requestedMaxPages) && requestedMaxPages > 0
    ? Math.floor(requestedMaxPages)
    : Math.ceil(limit / SCHOLAR_PAGE_SIZE);

  while (collected.length < limit) {
    const html = await page.content();
    const pageRecords = extractGoogleScholarResultsFromHtml(html, {
      query,
      limit: limit - collected.length,
      retrievedAt,
      baseUrl: page.url?.() ?? DEFAULT_SCHOLAR_URL,
    });

    let newlyAdded = 0;
    for (const record of pageRecords) {
      const key = scholarRecordKey(record);
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      collected.push(record);
      newlyAdded += 1;

      if (collected.length >= limit) {
        break;
      }
    }

    if (
      collected.length >= limit ||
      pageRecords.length === 0 ||
      newlyAdded === 0 ||
      pageRecords.length < SCHOLAR_PAGE_SIZE ||
      typeof loadPage !== 'function' ||
      pagesVisited >= effectiveMaxPages
    ) {
      break;
    }

    currentStart += SCHOLAR_PAGE_SIZE;
    if ((pageDelayMs ?? 0) > 0) {
      await delay(pageDelayMs);
    }
    await loadPage(buildScholarNextPageUrl(page.url?.(), query, currentStart));
    pagesVisited += 1;
  }

  return collected;
}

export function extractGoogleScholarResultsFromHtml(html, { query, limit, retrievedAt, baseUrl = DEFAULT_SCHOLAR_URL }) {
  return extractBlocks(html, /<div\b[^>]*class="[^"]*gs_r[^"]*gs_or[^"]*gs_scl[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi)
    .slice(0, limit)
    .map((block) => {
      const url = extractHref(block, [
        /<h3[^>]*class="[^"]*gs_rt[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"/i,
      ], baseUrl);
      const pdf = resolvePdfMetadata({
        pdfUrl: extractHref(block, [
          /<div[^>]*class="[^"]*gs_or_ggsm[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"/i,
          /<a[^>]*href="([^"]+\.pdf(?:\?[^"]*)?)"/i,
        ], baseUrl),
      });
      const meta = parseScholarMeta(extractFirst(block, [
        /<div[^>]*class="[^"]*gs_a[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ]));

      return {
        source: 'google_scholar',
        source_id: extractScholarSourceId(url, extractFirst(block, [
          /data-cid="([^"]+)"/i,
        ])),
        title: extractFirst(block, [
          /<h3[^>]*class="[^"]*gs_rt[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
          /<h3[^>]*class="[^"]*gs_rt[^"]*"[^>]*>([\s\S]*?)<\/h3>/i,
        ]),
        authors: meta.authors,
        year: meta.year,
        venue: meta.venue,
        doi: '',
        url,
        abstract: extractFirst(block, [
          /<div[^>]*class="[^"]*gs_rs[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ]),
        pdf_available: pdf.pdf_available,
        pdf_url: pdf.pdf_url,
        matched_query: query,
        retrieved_at: retrievedAt,
      };
    });
}

export async function runGoogleScholarSearch({ query, sourceConfig, fixtureDir, retrievedAt, browserRuntime, browserStartupError, limit }) {
  if (!sourceConfig.enabled) {
    return skippedSourceResult('google_scholar', 'Disabled by default for v1');
  }

  if (sourceConfig.mode === 'fixture') {
    const payload = readFixtureFile(fixtureDir, sourceConfig.fixture);
    const items = payload.items ?? [];
    return completedSourceResult(
      'google_scholar',
      items.slice(0, limit).map((item) => mapScholarItem(item, query, retrievedAt)),
    );
  }

  if (!browserRuntime) {
    return skippedSourceResult('google_scholar', browserStartupError ? `Browser automation unavailable: ${browserStartupError}` : 'Browser automation unavailable');
  }

  try {
    const records = await browserRuntime.runSearch({
      sourceName: 'google_scholar',
      searchUrl: buildSearchUrl(sourceConfig.search_url ?? DEFAULT_SCHOLAR_URL, 'q', query),
      extractor: extractPaginatedGoogleScholarResultsFromPage,
      query,
      limit,
      retrievedAt,
      waitForSelector: sourceConfig.wait_for_selector ?? 'div.gs_r.gs_or.gs_scl, #gs_res_ccl_mid .gs_r',
      settleTimeMs: sourceConfig.settle_time_ms ?? 2000,
      maxPages: sourceConfig.max_pages ?? Math.ceil(limit / SCHOLAR_PAGE_SIZE),
      pageDelayMs: sourceConfig.page_delay_ms ?? 0,
    });
    return completedSourceResult('google_scholar', records);
  } catch (error) {
    return skippedSourceResult('google_scholar', `Google Scholar browser search failed: ${error.message}`);
  }
}
