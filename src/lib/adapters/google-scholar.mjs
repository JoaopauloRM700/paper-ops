import { completedSourceResult, readFixtureFile, skippedSourceResult } from './common.mjs';

function mapScholarItem(item, query, retrievedAt) {
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
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

export async function runGoogleScholarSearch({ query, sourceConfig, fixtureDir, retrievedAt, limit }) {
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

  return skippedSourceResult('google_scholar', 'Experimental source blocked in live mode');
}
