import { completedSourceResult, readFixtureFile, skippedSourceResult } from './common.mjs';

function mapScopusEntry(entry, query, retrievedAt) {
  return {
    source: 'scopus',
    source_id: String(entry['dc:identifier'] ?? '').replace('SCOPUS_ID:', ''),
    title: entry['dc:title'] ?? '',
    authors: [entry['dc:creator'] ?? ''].filter(Boolean),
    year: entry['prism:coverDate'] ?? '',
    venue: entry['prism:publicationName'] ?? '',
    doi: entry['prism:doi'] ?? '',
    url: entry['prism:url'] ?? '',
    abstract: entry['dc:description'] ?? '',
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

export async function runScopusSearch({ query, sourceConfig, env, fixtureDir, retrievedAt, fetchImpl, limit }) {
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

  if (!sourceConfig.api_key_env || !env[sourceConfig.api_key_env]) {
    return skippedSourceResult('scopus', `Missing required credential: ${sourceConfig.api_key_env}`);
  }

  const url = new URL(sourceConfig.endpoint);
  url.searchParams.set('query', query);
  url.searchParams.set('count', String(limit));

  const response = await fetchImpl(url, {
    headers: {
      'X-ELS-APIKey': env[sourceConfig.api_key_env],
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return skippedSourceResult('scopus', `Scopus request failed: ${response.status}`);
  }

  const payload = await response.json();
  const entries = payload['search-results']?.entry ?? [];
  return completedSourceResult(
    'scopus',
    entries.slice(0, limit).map((entry) => mapScopusEntry(entry, query, retrievedAt)),
  );
}
