import {
  buildSearchUrl,
  completedSourceResult,
  fetchJson,
  parseDoi,
  parseYear,
  readFixtureFile,
  resolvePdfMetadata,
  skippedSourceResult,
} from './common.mjs';

const DEFAULT_WEB_OF_SCIENCE_API_URL = 'https://api.clarivate.com/apis/wos-starter/v1/documents';

function firstValue(value) {
  if (Array.isArray(value)) {
    return value.find((entry) => entry !== undefined && entry !== null && entry !== '') ?? '';
  }

  return value ?? '';
}

function values(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    return [];
  }

  return [value];
}

function titleFromArray(titles, preferredTypes = []) {
  const entries = values(titles);
  for (const preferredType of preferredTypes) {
    const found = entries.find((entry) => String(entry?.type ?? '').toLowerCase() === preferredType);
    if (found) {
      return found.content ?? found.value ?? found.title ?? '';
    }
  }

  const first = entries[0];
  return typeof first === 'string' ? first : (first?.content ?? first?.value ?? first?.title ?? '');
}

function extractAuthors(record) {
  const starterAuthors = record.names?.authors;
  if (Array.isArray(starterAuthors)) {
    return starterAuthors.map((author) => author.displayName ?? author.display_name ?? author.fullName ?? author.full_name ?? author.name ?? author);
  }

  const expandedNames = values(record.static_data?.summary?.names?.name);
  if (expandedNames.length > 0) {
    return expandedNames
      .filter((name) => !name.role || String(name.role).toLowerCase() === 'author')
      .map((name) => name.display_name ?? name.full_name ?? name.wos_standard ?? name.content ?? name.name);
  }

  return values(record.authors).map((author) => author.displayName ?? author.display_name ?? author.fullName ?? author.full_name ?? author.name ?? author);
}

function extractIdentifiers(record) {
  return [
    ...values(record.identifiers),
    ...values(record.dynamic_data?.cluster_related?.identifiers?.identifier),
    ...values(record.static_data?.item?.ids?.id),
  ];
}

function extractDoi(record) {
  const direct = record.doi ?? record.identifiers?.doi ?? record.UID?.doi;
  if (direct) {
    return direct;
  }

  for (const identifier of extractIdentifiers(record)) {
    if (typeof identifier === 'string') {
      const doi = parseDoi(identifier);
      if (doi) {
        return doi;
      }
      continue;
    }

    const type = String(identifier?.type ?? identifier?.id_type ?? '').toLowerCase();
    const value = identifier?.value ?? identifier?.content ?? identifier?.id ?? '';
    if (type === 'doi' && value) {
      return value;
    }

    const doi = parseDoi(value);
    if (doi) {
      return doi;
    }
  }

  return '';
}

function extractUrl(record) {
  const links = values(record.links);
  const preferredLink = links.find((link) => ['record', 'source-record', 'self'].includes(String(link?.type ?? link?.rel ?? '').toLowerCase())) ?? links[0];
  return record.url
    ?? record.links?.record
    ?? record.links?.self
    ?? preferredLink?.url
    ?? preferredLink?.href
    ?? '';
}

function extractAbstract(record) {
  const starterAbstract = firstValue([record.abstract, record.summary, record.description]);
  if (starterAbstract) {
    return starterAbstract;
  }

  const abstractText = record.static_data?.fullrecord_metadata?.abstracts?.abstract?.abstract_text;
  if (Array.isArray(abstractText?.p)) {
    return abstractText.p.join(' ');
  }

  return abstractText?.p ?? abstractText ?? '';
}

function extractVenue(record) {
  return firstValue([
    record.source?.sourceTitle,
    record.source?.source_title,
    record.source?.title,
    record.journal,
    titleFromArray(record.static_data?.summary?.titles?.title, ['source']),
    record.static_data?.summary?.pub_info?.pubtype,
  ]);
}

function extractYear(record) {
  return parseYear(firstValue([
    record.source?.publishYear,
    record.source?.publish_year,
    record.publicationYear,
    record.publication_year,
    record.year,
    record.static_data?.summary?.pub_info?.pubyear,
    record.static_data?.summary?.pub_info?.sortdate,
  ]));
}

function extractPayloadRecords(payload) {
  return payload.hits
    ?? payload.documents
    ?? payload.records
    ?? payload.Records?.records?.REC
    ?? payload.Data?.Records?.records?.REC
    ?? [];
}

function formatWebOfScienceQuery(query, sourceConfig) {
  if (sourceConfig.raw_query === true) {
    return query;
  }

  const trimmed = String(query ?? '').trim();
  if (/^[A-Z]{2,5}\s*=/.test(trimmed)) {
    return trimmed;
  }

  return `TS=(${trimmed})`;
}

export function mapWebOfScienceRecord(record, query, retrievedAt) {
  const doi = extractDoi(record);
  const pdf = resolvePdfMetadata({
    pdfUrl: record.pdf_url ?? record.pdfUrl,
    pdfAvailable: record.pdf_available,
  });

  return {
    source: 'web_of_science',
    source_id: record.uid ?? record.UID ?? record.id ?? doi,
    title: record.title ?? titleFromArray(record.static_data?.summary?.titles?.title, ['item']) ?? '',
    authors: extractAuthors(record),
    year: extractYear(record),
    venue: extractVenue(record),
    doi,
    url: extractUrl(record),
    abstract: extractAbstract(record),
    pdf_available: pdf.pdf_available,
    pdf_url: pdf.pdf_url,
    matched_query: query,
    retrieved_at: retrievedAt,
  };
}

export async function runWebOfScienceSearch({ query, sourceConfig, fixtureDir, retrievedAt, limit, fetchImpl }) {
  if (!sourceConfig.enabled) {
    return skippedSourceResult('web_of_science', 'Source disabled');
  }

  if (sourceConfig.mode === 'fixture') {
    const payload = readFixtureFile(fixtureDir, sourceConfig.fixture);
    const records = extractPayloadRecords(payload);
    return completedSourceResult(
      'web_of_science',
      records.slice(0, limit).map((record) => mapWebOfScienceRecord(record, query, retrievedAt)),
    );
  }

  if (sourceConfig.mode !== 'api') {
    return skippedSourceResult('web_of_science', 'Web of Science supports api or fixture mode only');
  }

  if (!sourceConfig.api_key) {
    return skippedSourceResult('web_of_science', 'API key not configured');
  }

  try {
    const payload = await fetchJson(
      fetchImpl,
      buildSearchUrl(sourceConfig.api_url ?? DEFAULT_WEB_OF_SCIENCE_API_URL, sourceConfig.query_param ?? 'q', formatWebOfScienceQuery(query, sourceConfig), {
        [sourceConfig.limit_param ?? 'limit']: limit,
      }),
      {
        headers: {
          Accept: 'application/json',
          'X-ApiKey': sourceConfig.api_key,
        },
        sourceLabel: 'Web of Science API',
      },
    );
    const records = extractPayloadRecords(payload);
    return completedSourceResult(
      'web_of_science',
      records.slice(0, limit).map((record) => mapWebOfScienceRecord(record, query, retrievedAt)),
    );
  } catch (error) {
    return skippedSourceResult('web_of_science', `Web of Science API search failed: ${error.message}`);
  }
}
