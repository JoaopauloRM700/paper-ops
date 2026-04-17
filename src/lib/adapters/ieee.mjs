import { completedSourceResult, readFixtureFile, skippedSourceResult } from './common.mjs';

function mapIeeeArticle(article, query, retrievedAt) {
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
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

export async function runIeeeSearch({ query, sourceConfig, env, fixtureDir, retrievedAt, fetchImpl, limit }) {
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

  if (!sourceConfig.api_key_env || !env[sourceConfig.api_key_env]) {
    return skippedSourceResult('ieee', `Missing required credential: ${sourceConfig.api_key_env}`);
  }

  const url = new URL(sourceConfig.endpoint);
  url.searchParams.set('querytext', query);
  url.searchParams.set('max_records', String(limit));
  url.searchParams.set('apikey', env[sourceConfig.api_key_env]);

  const response = await fetchImpl(url);
  if (!response.ok) {
    return skippedSourceResult('ieee', `IEEE request failed: ${response.status}`);
  }

  const payload = await response.json();
  const articles = payload.articles ?? [];
  return completedSourceResult(
    'ieee',
    articles.slice(0, limit).map((article) => mapIeeeArticle(article, query, retrievedAt)),
  );
}
