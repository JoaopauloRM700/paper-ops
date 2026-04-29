import { readFileSync } from 'node:fs';

const WINDOWS_1252_BYTES = new Map([
  ['€', 0x80],
  ['‚', 0x82],
  ['ƒ', 0x83],
  ['„', 0x84],
  ['…', 0x85],
  ['†', 0x86],
  ['‡', 0x87],
  ['ˆ', 0x88],
  ['‰', 0x89],
  ['Š', 0x8a],
  ['‹', 0x8b],
  ['Œ', 0x8c],
  ['Ž', 0x8e],
  ['‘', 0x91],
  ['’', 0x92],
  ['“', 0x93],
  ['”', 0x94],
  ['•', 0x95],
  ['–', 0x96],
  ['—', 0x97],
  ['˜', 0x98],
  ['™', 0x99],
  ['š', 0x9a],
  ['›', 0x9b],
  ['œ', 0x9c],
  ['ž', 0x9e],
  ['Ÿ', 0x9f],
]);

function countMojibakeSignals(text) {
  return (String(text ?? '').match(/[ÃÂâ][\s\S]?|�/g) ?? []).length;
}

function encodeAsWindows1252Bytes(text) {
  const bytes = [];

  for (const character of String(text ?? '')) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }

    const mappedByte = WINDOWS_1252_BYTES.get(character);
    if (mappedByte === undefined) {
      return null;
    }

    bytes.push(mappedByte);
  }

  return Buffer.from(bytes);
}

function repairMojibake(text) {
  const source = String(text ?? '');
  const sourceSignals = countMojibakeSignals(source);
  if (sourceSignals === 0) {
    return source;
  }

  const bytes = encodeAsWindows1252Bytes(source);
  if (!bytes) {
    return source;
  }

  const repaired = bytes.toString('utf8');
  if (repaired.includes('�')) {
    return source;
  }

  return countMojibakeSignals(repaired) < sourceSignals ? repaired : source;
}

function normalizeExtractedText(text) {
  return repairMojibake(text)
    .replace(/\r/g, '')
    .replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

async function loadPdfParse() {
  const module = await import('pdf-parse');
  return module.default ?? module.PDFParse ?? module;
}

function isClassConstructorCallError(error) {
  return error instanceof TypeError
    && /class constructor|cannot be invoked without 'new'|without new/i.test(error.message);
}

function buildTextFromParsedResult(result) {
  if (Array.isArray(result?.pages) && result.pages.length > 0) {
    return result.pages
      .map((page, index) => {
        const pageNumber = page?.num ?? index + 1;
        return `--- Page ${pageNumber} ---\n${page?.text ?? ''}`;
      })
      .join('\n\n');
  }

  return result?.text ?? '';
}

async function parsePdfBuffer(buffer, pdfParse) {
  if (typeof pdfParse === 'function') {
    try {
      const parsed = await pdfParse(buffer);
      return buildTextFromParsedResult(parsed);
    } catch (error) {
      if (!isClassConstructorCallError(error)) {
        throw error;
      }
    }

    const parser = new pdfParse({ data: buffer });
    try {
      const result = await parser.getText();
      return buildTextFromParsedResult(result);
    } finally {
      await parser.destroy?.();
    }
  }

  const ParserClass = pdfParse?.PDFParse ?? pdfParse?.default?.PDFParse;
  if (typeof ParserClass === 'function') {
    const parser = new ParserClass({ data: buffer });
    try {
      const result = await parser.getText();
      return buildTextFromParsedResult(result);
    } finally {
      await parser.destroy?.();
    }
  }

  throw new Error('Unsupported pdf-parse export shape.');
}

export async function extractTextFromPdfFile(pdfPath, options = {}) {
  const {
    pdfParseImpl,
    minimumCharacters = 200,
  } = options;
  const buffer = readFileSync(pdfPath);
  const pdfParse = pdfParseImpl ?? await loadPdfParse();
  const normalizedText = normalizeExtractedText(await parsePdfBuffer(buffer, pdfParse));

  if (normalizedText.length < minimumCharacters) {
    throw new Error('Extracted text is too short; the PDF may be scanned, empty, or unreadable.');
  }

  return normalizedText;
}
