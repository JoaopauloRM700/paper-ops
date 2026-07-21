const DEFAULT_MAX_CHARS = 2200;
const DEFAULT_OVERLAP_CHARS = 220;

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function splitPages(text, textSource) {
  const source = String(text ?? '');
  const pattern = /^--- Page ([^-]+?) ---\s*$/gim;
  const matches = Array.from(source.matchAll(pattern));

  if (matches.length === 0) {
    return [{
      page: textSource?.includes('abstract') ? 'abstract' : 'unknown',
      text: source,
      start: 0,
    }];
  }

  return matches.map((match, index) => {
    const contentStart = match.index + match[0].length;
    const nextStart = matches[index + 1]?.index ?? source.length;
    return {
      page: match[1].trim(),
      text: source.slice(contentStart, nextStart).trim(),
      start: contentStart,
    };
  }).filter((page) => normalizeWhitespace(page.text));
}

function splitPageIntoChunks(page, options) {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const paragraphs = page.text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks = [];
  let current = '';
  let currentStart = page.start;

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }

    chunks.push({
      pageStart: page.page,
      pageEnd: page.page,
      text: current,
      charStart: currentStart,
      charEnd: currentStart + current.length,
      section: 'unknown',
    });

    const overlap = current.slice(Math.max(0, current.length - overlapChars)).trim();
    currentStart = Math.max(page.start, currentStart + current.length - overlap.length);
    current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    chunks.push({
      pageStart: page.page,
      pageEnd: page.page,
      text: current,
      charStart: currentStart,
      charEnd: currentStart + current.length,
      section: 'unknown',
    });
  }

  return chunks;
}

export function chunkArticleText({ articleId, text, textSource, maxChars, overlapChars } = {}) {
  const pages = splitPages(text, textSource);
  const chunks = [];

  for (const page of pages) {
    for (const chunk of splitPageIntoChunks(page, { maxChars, overlapChars })) {
      const textValue = normalizeWhitespace(chunk.text);
      if (!textValue) {
        continue;
      }

      chunks.push({
        chunkId: `${articleId}::chunk-${chunks.length + 1}`,
        articleId,
        chunkIndex: chunks.length + 1,
        ...chunk,
        text: textValue,
      });
    }
  }

  return chunks;
}
