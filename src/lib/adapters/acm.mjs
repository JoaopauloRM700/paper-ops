import { completedSourceResult, readFixtureFile, skippedSourceResult } from './common.mjs';

function mapAcmItem(item, query, retrievedAt) {
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
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

export async function runAcmSearch({ query, sourceConfig, fixtureDir, retrievedAt, fetchImpl, limit }) {
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

  const url = new URL(sourceConfig.endpoint);
  url.searchParams.set('filter', 'publisher-name:Association for Computing Machinery');
  url.searchParams.set('query.bibliographic', query);
  url.searchParams.set('rows', String(limit));

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return skippedSourceResult('acm', `ACM request failed: ${response.status}`);
  }

  const payload = await response.json();
  const items = payload.message?.items ?? [];
  return completedSourceResult(
    'acm',
    items.slice(0, limit).map((item) => ({
      source: 'acm',
      source_id: item.DOI ?? item.URL ?? '',
      title: item.title?.[0] ?? '',
      authors: (item.author ?? []).map((author) => ({
        name: [author.given, author.family].filter(Boolean).join(' '),
      })),
      year: item.issued?.['date-parts']?.[0]?.[0] ?? '',
      venue: item['container-title']?.[0] ?? '',
      doi: item.DOI ?? '',
      url: item.URL ?? '',
      abstract: item.abstract ?? '',
      matched_query: query,
      retrieved_at: retrievedAt,
    })),
  );
}
