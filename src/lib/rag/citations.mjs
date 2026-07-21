function normalizeForCompare(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function firstEvidenceSentence(text, maxLength = 260) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  const sentence = normalized.match(/^(.{40,}?[.!?])\s/)?.[1] ?? normalized;
  return sentence.length <= maxLength ? sentence : `${sentence.slice(0, maxLength - 3).trim()}...`;
}

function findChunkForEvidence(entry, chunks) {
  if (entry?.chunkId) {
    const byId = chunks.find((chunk) => chunk.chunkId === entry.chunkId);
    if (byId) {
      return byId;
    }
  }

  const title = normalizeForCompare(entry?.title);
  const page = normalizeForCompare(entry?.page);
  return chunks.find((chunk) => {
    const titleMatches = !title || normalizeForCompare(chunk.title) === title;
    const pageMatches = !page || normalizeForCompare(chunk.pageStart) === page || normalizeForCompare(chunk.pageEnd) === page;
    return titleMatches && pageMatches;
  }) ?? chunks[0];
}

export function verifySupportingEvidence(supportingEvidence, chunks) {
  return (supportingEvidence ?? []).map((entry) => {
    const chunk = findChunkForEvidence(entry, chunks);
    const proposedQuote = String(entry?.quote ?? '').replace(/\s+/g, ' ').trim();
    const chunkText = String(chunk?.text ?? '').replace(/\s+/g, ' ').trim();
    const verified = proposedQuote && normalizeForCompare(chunkText).includes(normalizeForCompare(proposedQuote));

    return {
      chunkId: chunk?.chunkId ?? entry?.chunkId ?? '',
      articleId: chunk?.articleId ?? '',
      title: chunk?.title ?? entry?.title ?? 'unknown',
      page: entry?.page || chunk?.pageStart || 'unknown',
      pageStart: chunk?.pageStart ?? entry?.page ?? 'unknown',
      pageEnd: chunk?.pageEnd ?? entry?.page ?? 'unknown',
      quote: verified ? proposedQuote : firstEvidenceSentence(chunkText || proposedQuote),
      verified,
      score: chunk?.score ?? null,
      doi: chunk?.doi ?? '',
      url: chunk?.url ?? '',
    };
  }).filter((entry) => entry.quote);
}

export function buildSourceLabel(evidence) {
  const page = evidence.pageStart && evidence.pageStart !== 'unknown'
    ? `, p. ${evidence.pageStart}`
    : '';
  const doi = evidence.doi ? `, DOI: ${evidence.doi}` : '';
  return `${evidence.title}${page}${doi}`;
}
