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

const DEFAULT_SCOPUS_URL = 'https://www.scopus.com/results/results.uri';
const DEFAULT_SCOPUS_API_URL = 'https://api.elsevier.com/content/search/scopus';

function resolveScopusEntryUrl(entry) {
  const links = Array.isArray(entry.link) ? entry.link : [];
  const preferredLink = links.find((link) => ['scopus', 'doi', 'full-text'].includes(String(link?.['@ref'] ?? '').toLowerCase()));
  if (preferredLink?.['@href']) {
    return preferredLink['@href'];
  }

  if (entry['prism:doi']) {
    return `https://doi.org/${entry['prism:doi']}`;
  }

  return entry['prism:url'] ?? '';
}

function mapScopusEntry(entry, query, retrievedAt) {
  const pdf = resolvePdfMetadata({
    pdfUrl: entry.pdf_url,
    pdfAvailable: entry.pdf_available,
  });

  return {
    source: 'scopus',
    source_id: String(entry['dc:identifier'] ?? '').replace('SCOPUS_ID:', ''),
    title: entry['dc:title'] ?? '',
    authors: [entry['dc:creator'] ?? ''].filter(Boolean),
    year: entry['prism:coverDate'] ?? '',
    venue: entry['prism:publicationName'] ?? '',
    doi: entry['prism:doi'] ?? '',
    url: resolveScopusEntryUrl(entry),
    abstract: entry['dc:description'] ?? '',
    pdf_available: pdf.pdf_available,
    pdf_url: pdf.pdf_url,
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

function extractScopusSourceId(url, fallback) {
  if (fallback) {
    return fallback;
  }

  const match = String(url ?? '').match(/eid=([^&]+)/i);
  return match ? match[1] : '';
}

export async function extractScopusResultsFromPage(page, { query, limit, retrievedAt }) {
  const html = await page.content();
  return extractScopusResultsFromHtml(html, {
    query,
    limit,
    retrievedAt,
    baseUrl: page.url?.() ?? DEFAULT_SCOPUS_URL,
  });
}

export function extractScopusResultsFromHtml(html, { query, limit, retrievedAt, baseUrl = DEFAULT_SCOPUS_URL }) {
  return extractBlocks(html, /<article\b[^>]*(?:class="[^"]*search-result-item[^"]*"|data-source-id="[^"]*")[\s\S]*?<\/article>/gi)
    .slice(0, limit)
    .map((block) => {
      const url = extractHref(block, [
        /<h2[^>]*class="[^"]*result-title[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"/i,
        /<h2[^>]*class="[^"]*result-list-title-link[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"/i,
        /<a[^>]*href="([^"]*display\.uri[^"]*)"/i,
      ], baseUrl);
      const pdf = resolvePdfMetadata({
        pdfUrl: extractHref(block, [
          /<a[^>]*class="[^"]*pdf-link[^"]*"[^>]*href="([^"]+)"/i,
          /<a[^>]*href="([^"]*\/record\/display\.uri[^"]*pdf[^"]*)"/i,
        ], baseUrl),
      });
      const authors = extractFirst(block, [
        /<span[^>]*class="[^"]*authors[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        /<div[^>]*class="[^"]*author-list[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ]);

      return {
        source: 'scopus',
        source_id: extractScopusSourceId(url, extractFirst(block, [
          /data-source-id="([^"]+)"/i,
        ])),
        title: extractFirst(block, [
          /<h2[^>]*class="[^"]*result-title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
          /<h2[^>]*class="[^"]*result-list-title-link[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
          /<h2[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
        ]),
        authors: splitAuthors(authors),
        year: parseYear(extractFirst(block, [
          /<span[^>]*class="[^"]*year[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
          /<span[^>]*class="[^"]*publication-year[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        ])),
        venue: extractFirst(block, [
          /<span[^>]*class="[^"]*venue[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
          /<span[^>]*class="[^"]*publication-name[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        ]),
        doi: parseDoi(extractFirst(block, [
          /<span[^>]*class="[^"]*doi[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        ])),
        url,
        abstract: extractFirst(block, [
          /<p[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
          /<div[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ]),
        pdf_available: pdf.pdf_available,
        pdf_url: pdf.pdf_url,
        matched_query: query,
        retrieved_at: retrievedAt,
      };
    });
}

export async function runScopusSearch({ query, sourceConfig, fixtureDir, retrievedAt, browserRuntime, browserStartupError, limit, fetchImpl }) {
  if (!sourceConfig.enabled) {
    return skippedSourceResult('scopus', 'Source disabled');
  }

  if (sourceConfig.mode === 'fixture') {
    const payload = readFixtureFile(fixtureDir, sourceConfig.fixture);
    const entries = payload['search-results']?.entry ?? [];
    return completedSourceResult(
      'scopus',
      entries.slice(0, limit).map((entry) => mapScopusEntry(entry, query, retrievedAt)),
    );
  }

  if (sourceConfig.mode === 'api') {
    if (!sourceConfig.api_key) {
      return skippedSourceResult('scopus', 'API key not configured');
    }

    try {
      const payload = await fetchJson(
        fetchImpl,
        buildSearchUrl(sourceConfig.api_url ?? DEFAULT_SCOPUS_API_URL, 'query', query, {
          count: limit,
        }),
        {
          headers: {
            Accept: 'application/json',
            'X-ELS-APIKey': sourceConfig.api_key,
          },
          sourceLabel: 'Scopus API',
        },
      );
      const entries = payload['search-results']?.entry ?? [];
      return completedSourceResult(
        'scopus',
        entries.slice(0, limit).map((entry) => mapScopusEntry(entry, query, retrievedAt)),
      );
    } catch (error) {
      return skippedSourceResult('scopus', `Scopus API search failed: ${error.message}`);
    }
  }

  if (!browserRuntime) {
    return skippedSourceResult('scopus', browserStartupError ? `Browser automation unavailable: ${browserStartupError}` : 'Browser automation unavailable');
  }

  try {
    const records = await browserRuntime.runSearch({
      sourceName: 'scopus',
      searchUrl: buildSearchUrl(sourceConfig.search_url ?? DEFAULT_SCOPUS_URL, 'st1', query, {
        sort: 'plf-f',
        src: 's',
      }),
      extractor: extractScopusResultsFromPage,
      query,
      limit,
      retrievedAt,
      waitForSelector: sourceConfig.wait_for_selector ?? 'article.search-result-item, article[data-source-id], .result-item-content',
      settleTimeMs: sourceConfig.settle_time_ms,
    });
    return completedSourceResult('scopus', records);
  } catch (error) {
    return skippedSourceResult('scopus', `Scopus browser search failed: ${error.message}`);
  }
}
