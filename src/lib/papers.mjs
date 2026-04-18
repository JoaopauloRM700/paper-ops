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

function normalizePdfUrl(pdfUrl) {
  return normalizeWhitespace(pdfUrl);
}

function normalizePdfAvailability(pdfAvailable, pdfUrl) {
  if (normalizePdfUrl(pdfUrl)) {
    return true;
  }

  if (pdfAvailable === true) {
    return true;
  }

  if (pdfAvailable === false) {
    return false;
  }

  return null;
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

function mergeScalar(preferred, fallback) {
  return normalizeWhitespace(preferred) ? preferred : fallback;
}

function mergeAuthors(preferred, fallback) {
  return preferred.length > 0 ? preferred : fallback;
}

function mergeYear(preferred, fallback) {
  return preferred ?? fallback;
}

function mergePdfMetadata(preferred, fallback) {
  const preferredUrl = normalizePdfUrl(preferred.pdf_url);
  const fallbackUrl = normalizePdfUrl(fallback.pdf_url);
  const pdfUrl = preferredUrl || fallbackUrl;

  if (preferred.pdf_available === true || fallback.pdf_available === true || pdfUrl) {
    return {
      pdf_available: true,
      pdf_url: pdfUrl,
    };
  }

  if (preferred.pdf_available === false) {
    return {
      pdf_available: false,
      pdf_url: preferredUrl,
    };
  }

  if (fallback.pdf_available === false) {
    return {
      pdf_available: false,
      pdf_url: fallbackUrl,
    };
  }

  return {
    pdf_available: null,
    pdf_url: pdfUrl,
  };
}

function mergePaperRecords(preferred, fallback) {
  const pdf = mergePdfMetadata(preferred, fallback);

  return {
    source: mergeScalar(preferred.source, fallback.source),
    source_id: mergeScalar(preferred.source_id, fallback.source_id),
    title: mergeScalar(preferred.title, fallback.title),
    authors: mergeAuthors(preferred.authors, fallback.authors),
    year: mergeYear(preferred.year, fallback.year),
    venue: mergeScalar(preferred.venue, fallback.venue),
    doi: mergeScalar(preferred.doi, fallback.doi),
    url: mergeScalar(preferred.url, fallback.url),
    abstract: mergeScalar(preferred.abstract, fallback.abstract),
    pdf_available: pdf.pdf_available,
    pdf_url: pdf.pdf_url,
    matched_query: mergeScalar(preferred.matched_query, fallback.matched_query),
    retrieved_at: mergeScalar(preferred.retrieved_at, fallback.retrieved_at),
  };
}

export function normalizePaperRecord(input) {
  const pdfUrl = normalizePdfUrl(input.pdf_url);

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
    pdf_available: normalizePdfAvailability(input.pdf_available, pdfUrl),
    pdf_url: pdfUrl,
    matched_query: normalizeWhitespace(input.matched_query),
    retrieved_at: normalizeWhitespace(input.retrieved_at),
  };
}

export function deduplicatePaperRecords(records) {
  const doiIndex = new Map();
  const sourceIdentityIndex = new Map();
  const titleYearIndex = new Map();
  const uniqueRecords = [];
  const removedByRule = {
    doi: 0,
    sourceIdentity: 0,
    titleYear: 0,
  };

  function registerRecordKeys(record) {
    const doiKey = record.doi;
    const sourceKey = sourceIdentityKey(record);
    const titleKey = titleYearKey(record);

    if (doiKey) {
      doiIndex.set(doiKey, record);
    }

    if (sourceKey) {
      sourceIdentityIndex.set(sourceKey, record);
    }

    if (titleKey) {
      titleYearIndex.set(titleKey, record);
    }
  }

  for (const record of records) {
    const normalized = normalizePaperRecord(record);
    const doiKey = normalized.doi;
    const sourceKey = sourceIdentityKey(normalized);
    const titleKey = titleYearKey(normalized);
    const existingByDoi = doiKey ? doiIndex.get(doiKey) : null;
    const existingBySource = sourceKey ? sourceIdentityIndex.get(sourceKey) : null;
    const existingByTitle = titleKey ? titleYearIndex.get(titleKey) : null;
    const existingRecord = existingByDoi ?? existingBySource ?? existingByTitle;

    if (existingRecord) {
      if (existingByDoi) {
        removedByRule.doi += 1;
      } else if (existingBySource) {
        removedByRule.sourceIdentity += 1;
      } else {
        removedByRule.titleYear += 1;
      }

      Object.assign(existingRecord, mergePaperRecords(existingRecord, normalized));
      registerRecordKeys(existingRecord);
      continue;
    }

    uniqueRecords.push(normalized);
    registerRecordKeys(normalized);
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
