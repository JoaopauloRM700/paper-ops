import {
  buildSearchUrl,
  completedSourceResult,
  extractAll,
  extractBlocks,
  extractFirst,
  extractHref,
  fetchJson,
  parseDoi,
  parseYear,
  readFixtureFile,
  resolvePdfMetadata,
  skippedSourceResult,
} from './common.mjs';

const DEFAULT_IEEE_URL = 'https://ieeexplore.ieee.org/search/searchresult.jsp';
const DEFAULT_IEEE_API_URL = 'https://ieeexploreapi.ieee.org/api/v1/search/articles';

function mapIeeeArticle(article, query, retrievedAt) {
  const pdf = resolvePdfMetadata({
    pdfUrl: article.pdf_url,
    pdfAvailable: article.pdf_available,
  });

  return {
    source: 'ieee',
    source_id: article.article_number ?? '',
    title: article.title ?? '',
    authors: article.authors?.authors ?? [],
    year: article.publication_year ?? '',
    venue: article.publication_title ?? '',
    doi: article.doi ?? '',
    url: article.html_url ?? '',
    abstract: article.abstract ?? '',
    pdf_available: pdf.pdf_available,
    pdf_url: pdf.pdf_url,
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

function extractIeeeSourceId(url, fallback) {
  if (fallback) {
    return fallback;
  }

  const match = String(url ?? '').match(/document\/([^/?#]+)/i);
  return match ? match[1] : '';
}

export async function extractIeeeResultsFromPage(page, { query, limit, retrievedAt }) {
  const html = await page.content();
  return extractIeeeResultsFromHtml(html, {
    query,
    limit,
    retrievedAt,
    baseUrl: page.url?.() ?? DEFAULT_IEEE_URL,
  });
}

export function extractIeeeResultsFromHtml(html, { query, limit, retrievedAt, baseUrl = DEFAULT_IEEE_URL }) {
  return extractBlocks(html, /<article\b[^>]*class="[^"]*List-results-item[^"]*"[\s\S]*?<\/article>/gi)
    .slice(0, limit)
    .map((block) => {
      const url = extractHref(block, [
        /<h3[^>]*class="[^"]*result-item-title[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"/i,
        /<a[^>]*href="([^"]*\/document\/[^"]+)"/i,
      ], baseUrl);
      const pdf = resolvePdfMetadata({
        pdfUrl: extractHref(block, [
          /<a[^>]*class="[^"]*stats-document-lh-action-downloadpdf[^"]*"[^>]*href="([^"]+)"/i,
          /<a[^>]*href="([^"]*stamp\/stamp\.jsp[^"]+)"/i,
        ], baseUrl),
      });

      return {
        source: 'ieee',
        source_id: extractIeeeSourceId(url, extractFirst(block, [
          /data-article-number="([^"]+)"/i,
        ])),
        title: extractFirst(block, [
          /<h3[^>]*class="[^"]*result-item-title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
          /<h2[^>]*class="[^"]*result-item-title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
        ]),
        authors: extractAll(block, /<a[^>]*class="[^"]*author-name[^"]*"[^>]*>([\s\S]*?)<\/a>/gi),
        year: parseYear(extractFirst(block, [
          /<span[^>]*class="[^"]*publication-year[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
          /<div[^>]*class="[^"]*publisher-info-container[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ])),
        venue: extractFirst(block, [
          /<span[^>]*class="[^"]*publication-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
          /<span[^>]*class="[^"]*display-pub-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        ]),
        doi: parseDoi(extractFirst(block, [
          /<div[^>]*class="[^"]*stats-document-abstract-doi[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*class="[^"]*document-doi[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ])),
        url,
        abstract: extractFirst(block, [
          /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*class="[^"]*result-item-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ]),
        pdf_available: pdf.pdf_available,
        pdf_url: pdf.pdf_url,
        matched_query: query,
        retrieved_at: retrievedAt,
      };
    });
}

export async function runIeeeSearch({ query, sourceConfig, fixtureDir, retrievedAt, browserRuntime, browserStartupError, limit, fetchImpl }) {
  if (!sourceConfig.enabled) {
    return skippedSourceResult('ieee', 'Source disabled');
  }

  if (sourceConfig.mode === 'fixture') {
    const payload = readFixtureFile(fixtureDir, sourceConfig.fixture);
    const articles = payload.articles ?? [];
    return completedSourceResult(
      'ieee',
      articles.slice(0, limit).map((article) => mapIeeeArticle(article, query, retrievedAt)),
    );
  }

  if (sourceConfig.mode === 'api') {
    if (!sourceConfig.api_key) {
      return skippedSourceResult('ieee', 'API key not configured');
    }

    try {
      const payload = await fetchJson(
        fetchImpl,
        buildSearchUrl(sourceConfig.api_url ?? DEFAULT_IEEE_API_URL, 'querytext', query, {
          apikey: sourceConfig.api_key,
          max_records: limit,
        }),
        { sourceLabel: 'IEEE API' },
      );
      const articles = payload.articles ?? [];
      return completedSourceResult(
        'ieee',
        articles.slice(0, limit).map((article) => mapIeeeArticle(article, query, retrievedAt)),
      );
    } catch (error) {
      return skippedSourceResult('ieee', `IEEE API search failed: ${error.message}`);
    }
  }

  if (!browserRuntime) {
    return skippedSourceResult('ieee', browserStartupError ? `Browser automation unavailable: ${browserStartupError}` : 'Browser automation unavailable');
  }

  try {
    const records = await browserRuntime.runSearch({
      sourceName: 'ieee',
      searchUrl: buildSearchUrl(sourceConfig.search_url ?? DEFAULT_IEEE_URL, 'queryText', query, {
        returnFacets: 'ALL',
        returnType: 'SEARCH',
      }),
      extractor: extractIeeeResultsFromPage,
      query,
      limit,
      retrievedAt,
      waitForSelector: sourceConfig.wait_for_selector ?? 'article.List-results-item, .List-results-items article',
      settleTimeMs: sourceConfig.settle_time_ms,
    });
    return completedSourceResult('ieee', records);
  } catch (error) {
    return skippedSourceResult('ieee', `IEEE browser search failed: ${error.message}`);
  }
}
