function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) {
    return [];
  }

  return authors
    .map((author) => {
      if (typeof author === 'string') {
        return normalizeWhitespace(author);
      }

      if (author && typeof author.name === 'string') {
        return normalizeWhitespace(author.name);
      }

      if (author && typeof author.full_name === 'string') {
        return normalizeWhitespace(author.full_name);
      }

      return '';
    })
    .filter(Boolean);
}

function normalizeYear(year) {
  if (year === null || year === undefined || year === '') {
    return null;
  }

  const normalized = parseInt(String(year).slice(0, 4), 10);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeDoi(doi) {
  return normalizeWhitespace(doi).toLowerCase();
}

function sourceIdentityKey(record) {
  const sourceId = normalizeWhitespace(record.source_id);
  const url = normalizeWhitespace(record.url);

  if (sourceId) {
    return `${record.source}::${sourceId}`;
  }

  if (url) {
    return `${record.source}::${url}`;
  }

  return '';
}

function titleYearKey(record) {
  const title = normalizeWhitespace(record.title).toLowerCase();
  if (!title || !record.year) {
    return '';
  }

  return `${title}::${record.year}`;
}

export function normalizePaperRecord(input) {
  return {
    source: normalizeWhitespace(input.source).toLowerCase(),
    source_id: normalizeWhitespace(input.source_id),
    title: normalizeWhitespace(input.title),
    authors: normalizeAuthors(input.authors),
    year: normalizeYear(input.year),
    venue: normalizeWhitespace(input.venue),
    doi: normalizeDoi(input.doi),
    url: normalizeWhitespace(input.url),
    abstract: normalizeWhitespace(input.abstract),
    matched_query: normalizeWhitespace(input.matched_query),
    retrieved_at: normalizeWhitespace(input.retrieved_at),
  };
}

export function deduplicatePaperRecords(records) {
  const seenDoi = new Set();
  const seenSourceIdentity = new Set();
  const seenTitleYear = new Set();
  const uniqueRecords = [];
  const removedByRule = {
    doi: 0,
    sourceIdentity: 0,
    titleYear: 0,
  };

  for (const record of records) {
    const normalized = normalizePaperRecord(record);
    const doiKey = normalized.doi;
    const sourceKey = sourceIdentityKey(normalized);
    const titleKey = titleYearKey(normalized);

    if (doiKey && seenDoi.has(doiKey)) {
      removedByRule.doi += 1;
      continue;
    }

    if (sourceKey && seenSourceIdentity.has(sourceKey)) {
      removedByRule.sourceIdentity += 1;
      continue;
    }

    if (titleKey && seenTitleYear.has(titleKey)) {
      removedByRule.titleYear += 1;
      continue;
    }

    if (doiKey) {
      seenDoi.add(doiKey);
    }

    if (sourceKey) {
      seenSourceIdentity.add(sourceKey);
    }

    if (titleKey) {
      seenTitleYear.add(titleKey);
    }

    uniqueRecords.push(normalized);
  }

  return {
    uniqueRecords,
    stats: {
      totalInput: records.length,
      duplicatesRemoved: records.length - uniqueRecords.length,
      removedByRule,
    },
  };
}
