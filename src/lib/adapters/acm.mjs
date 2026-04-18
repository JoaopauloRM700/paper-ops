import {
  buildSearchUrl,
  completedSourceResult,
  extractAll,
  extractBlocks,
  extractFirst,
  extractHref,
  parseDoi,
  parseYear,
  readFixtureFile,
  resolvePdfMetadata,
  skippedSourceResult,
} from './common.mjs';

const DEFAULT_ACM_URL = 'https://dl.acm.org/action/doSearch';

function mapAcmItem(item, query, retrievedAt) {
  const pdf = resolvePdfMetadata({
    pdfUrl: item.pdf_url,
    pdfAvailable: item.pdf_available,
  });

  return {
    source: 'acm',
    source_id: item.id ?? '',
    title: item.title ?? '',
    authors: item.authors ?? [],
    year: item.publicationDate ?? '',
    venue: item.containerTitle ?? '',
    doi: item.doi ?? '',
    url: item.url ?? '',
    abstract: item.abstract ?? '',
    pdf_available: pdf.pdf_available,
    pdf_url: pdf.pdf_url,
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

function extractAcmSourceId(url, fallback) {
  if (fallback) {
    return fallback;
  }

  const match = String(url ?? '').match(/doi\/([^/?#]+)/i);
  return match ? match[1] : '';
}

export async function extractAcmResultsFromPage(page, { query, limit, retrievedAt }) {
  const html = await page.content();
  return extractAcmResultsFromHtml(html, {
    query,
    limit,
    retrievedAt,
    baseUrl: page.url?.() ?? DEFAULT_ACM_URL,
  });
}

export function extractAcmResultsFromHtml(html, { query, limit, retrievedAt, baseUrl = DEFAULT_ACM_URL }) {
  return extractBlocks(html, /<li\b[^>]*class="[^"]*issue-item-container[^"]*"[\s\S]*?<\/li>\s*(?=<li\b[^>]*class="[^"]*issue-item-container[^"]*"|<\/ul>)/gi)
    .slice(0, limit)
    .map((block) => {
      const url = extractHref(block, [
        /<h5[^>]*class="[^"]*issue-item__title[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"/i,
        /<h2[^>]*class="[^"]*issue-item__title[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"/i,
        /<a[^>]*href="([^"]*\/doi\/[^"]+)"/i,
      ], baseUrl);
      const pdf = resolvePdfMetadata({
        pdfUrl: extractHref(block, [
          /<a[^>]*class="[^"]*issue-item__pdf[^"]*"[^>]*href="([^"]+)"/i,
          /<a[^>]*href="([^"]*\/doi\/pdf\/[^"]+)"/i,
        ], baseUrl),
      });
      const doi = parseDoi(extractFirst(block, [
        /data-doi="([^"]+)"/i,
      ])) || parseDoi(url);

      return {
        source: 'acm',
        source_id: extractAcmSourceId(url, extractFirst(block, [
          /data-doi="([^"]+)"/i,
        ])),
        title: extractFirst(block, [
          /<h5[^>]*class="[^"]*issue-item__title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
          /<h2[^>]*class="[^"]*issue-item__title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
        ]),
        authors: extractAll(block, /<div[^>]*class="[^"]*issue-item__authors[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/div>/gi),
        year: parseYear(extractFirst(block, [
          /<span[^>]*class="[^"]*dot-separator[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
          /<span[^>]*class="[^"]*bookPubDate[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        ])),
        venue: extractFirst(block, [
          /<span[^>]*class="[^"]*epub-section__title[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
          /<div[^>]*class="[^"]*issue-item__detail[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ]),
        doi,
        url,
        abstract: extractFirst(block, [
          /<div[^>]*class="[^"]*issue-item__abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*class="[^"]*search-result__item__abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ]),
        pdf_available: pdf.pdf_available,
        pdf_url: pdf.pdf_url,
        matched_query: query,
        retrieved_at: retrievedAt,
      };
    });
}

export async function runAcmSearch({ query, sourceConfig, fixtureDir, retrievedAt, browserRuntime, browserStartupError, limit }) {
  if (!sourceConfig.enabled) {
    return skippedSourceResult('acm', 'Source disabled');
  }

  if (sourceConfig.mode === 'fixture') {
    const payload = readFixtureFile(fixtureDir, sourceConfig.fixture);
    const items = payload.items ?? [];
    return completedSourceResult(
      'acm',
      items.slice(0, limit).map((item) => mapAcmItem(item, query, retrievedAt)),
    );
  }

  if (!browserRuntime) {
    return skippedSourceResult('acm', browserStartupError ? `Browser automation unavailable: ${browserStartupError}` : 'Browser automation unavailable');
  }

  try {
    const records = await browserRuntime.runSearch({
      sourceName: 'acm',
      searchUrl: buildSearchUrl(sourceConfig.search_url ?? DEFAULT_ACM_URL, 'AllField', query),
      extractor: extractAcmResultsFromPage,
      query,
      limit,
      retrievedAt,
      waitForSelector: sourceConfig.wait_for_selector ?? 'li.issue-item-container, .search-result__xsl-body li',
      settleTimeMs: sourceConfig.settle_time_ms,
    });
    return completedSourceResult('acm', records);
  } catch (error) {
    return skippedSourceResult('acm', `ACM browser search failed: ${error.message}`);
  }
}
