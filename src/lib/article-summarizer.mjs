import { spawn } from 'node:child_process';

const DEFAULT_SUMMARY_COMMAND = 'gemini';
const DEFAULT_TIMEOUT_MS = 180000;
const CHUNK_MAX_CHARS = 12000;
const CHUNK_OVERLAP_CHARS = 400;

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function chunkText(text, options = {}) {
  const maxChars = options.maxChars ?? CHUNK_MAX_CHARS;
  const overlapChars = options.overlapChars ?? CHUNK_OVERLAP_CHARS;
  const paragraphs = String(text ?? '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    const overlap = current.slice(Math.max(0, current.length - overlapChars)).trim();
    current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function extractFirstJsonObject(text) {
  const source = String(text ?? '');
  const startIndex = source.indexOf('{');
  if (startIndex < 0) {
    throw new Error('The summarizer did not return JSON.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  throw new Error('The summarizer returned malformed JSON.');
}

function normalizeArticleSummary(payload) {
  return {
    objective: normalizeText(payload?.objective) || 'unknown',
    method: normalizeText(payload?.method) || 'unknown',
    dataset_or_context: normalizeText(payload?.dataset_or_context) || 'unknown',
    key_findings: normalizeList(payload?.key_findings),
    limitations: normalizeList(payload?.limitations),
    contribution: normalizeText(payload?.contribution) || 'unknown',
    keywords: normalizeList(payload?.keywords),
  };
}

function normalizeDigestSummary(payload) {
  return {
    overview: normalizeText(payload?.overview) || 'unknown',
    common_themes: normalizeList(payload?.common_themes),
    common_methods: normalizeList(payload?.common_methods),
    evidence_gaps: normalizeList(payload?.evidence_gaps),
    recommended_next_reads: normalizeList(payload?.recommended_next_reads),
  };
}

function buildArticlePrompt({ record, text, profile }) {
  let profileContext = '';
  if (profile) {
    profileContext = `\nResearch Context:
Project: ${profile['Projeto/Pesquisa']?.[0] || 'unknown'}
Approach: ${profile['Abordagem / Detalhe']?.join('; ') || 'unknown'}
Target Keywords: ${profile['Palavras-chave']?.join(', ') || 'unknown'}\n`;
  }

  return `You are summarizing one academic paper. Return strict JSON only with this exact schema:
{
  "objective": "string",
  "method": "string",
  "dataset_or_context": "string",
  "key_findings": ["string"],
  "limitations": ["string"],
  "contribution": "string",
  "keywords": ["string"]
}

Rules:
- Use only the evidence in the text provided.
- If a field cannot be determined, use "unknown" or an empty array.
- Be concise and factual.${profileContext}

Paper metadata:
Title: ${record.title || 'unknown'}
Source: ${record.source || 'unknown'}
Year: ${record.year ?? 'unknown'}
Venue: ${record.venue || 'unknown'}
DOI: ${record.doi || 'unknown'}

Paper text:
${text}`;
}

function buildChunkPrompt({ record, chunkIndex, totalChunks, text, profile }) {
  let profileContext = '';
  if (profile) {
    profileContext = `\nResearch Context: ${profile['Projeto/Pesquisa']?.[0] || 'unknown'}\n`;
  }

  return `You are reviewing chunk ${chunkIndex} of ${totalChunks} from one academic paper. Return strict JSON only with this exact schema:
{
  "objective": ["string"],
  "method": ["string"],
  "dataset_or_context": ["string"],
  "key_findings": ["string"],
  "limitations": ["string"],
  "contribution": ["string"],
  "keywords": ["string"]
}

Rules:
- Extract only evidence that appears in this chunk.
- Use short factual statements.
- If a section is not present, return an empty array for it.${profileContext}

Paper title: ${record.title || 'unknown'}

Chunk text:
${text}`;
}

function buildChunkSynthesisPrompt({ record, chunkPayloads, profile }) {
  let profileContext = '';
  if (profile) {
    profileContext = `\nResearch Context: ${profile['Projeto/Pesquisa']?.[0] || 'unknown'}\n`;
  }

  return `You are merging chunk-level notes into one structured academic paper summary. Return strict JSON only with this exact schema:
{
  "objective": "string",
  "method": "string",
  "dataset_or_context": "string",
  "key_findings": ["string"],
  "limitations": ["string"],
  "contribution": "string",
  "keywords": ["string"]
}

Rules:
- Consolidate repeated points.
- Use only the evidence from the chunk notes.
- If a field cannot be determined, use "unknown" or an empty array.${profileContext}

Paper title: ${record.title || 'unknown'}

Chunk notes JSON:
${JSON.stringify(chunkPayloads, null, 2)}`;
}

function buildDigestPrompt({ query, articleSummaries, profile }) {
  let profileContext = '';
  if (profile) {
    profileContext = `\nResearch Context:
Project: ${profile['Projeto/Pesquisa']?.[0] || 'unknown'}
Approach: ${profile['Abordagem / Detalhe']?.join('; ') || 'unknown'}
Target Keywords: ${profile['Palavras-chave']?.join(', ') || 'unknown'}\n`;
  }

  return `You are synthesizing multiple article summaries from one literature search. Return strict JSON only with this exact schema:
{
  "overview": "string",
  "common_themes": ["string"],
  "common_methods": ["string"],
  "evidence_gaps": ["string"],
  "recommended_next_reads": ["string"]
}

Rules:
- Use only the provided article summaries.
- Focus on cross-paper patterns, not individual article repetition.
- If a section cannot be determined, use "unknown" or an empty array.${profileContext}

Search query:
${query}

Article summaries JSON:
${JSON.stringify(articleSummaries, null, 2)}`;
}

async function runCliJsonPrompt(prompt, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    spawnImpl = spawn,
    command = env.PAPER_OPS_SUMMARY_CLI || DEFAULT_SUMMARY_COMMAND,
    timeoutMs = Number.parseInt(env.PAPER_OPS_SUMMARY_TIMEOUT_MS ?? '', 10) || DEFAULT_TIMEOUT_MS,
  } = options;

  const { stdout, stderr } = await new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(command, ['-p', prompt], {
      cwd,
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      rejectPromise(new Error(`Summarizer timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      rejectPromise(error);
    });

    child.once('exit', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);

      if (code === 0) {
        resolvePromise({
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
        return;
      }

      rejectPromise(new Error(stderrBuffer.trim() || `Summarizer exited with code ${code}.`));
    });
  });

  return JSON.parse(extractFirstJsonObject(stdout || stderr));
}

export async function summarizeArticleText(input, legacyText, legacyOptions = {}) {
  const {
    record,
    text,
    chunking,
    runner,
    profile,
  } = typeof input === 'object' && input !== null && 'record' in input
    ? input
    : {
        record: input,
        text: legacyText,
        profile: null,
        ...legacyOptions,
      };
  const chunks = chunkText(text, chunking);

  if (chunks.length === 0) {
    throw new Error('No text was available to summarize.');
  }

  if (chunks.length === 1) {
    return normalizeArticleSummary(
      await runCliJsonPrompt(buildArticlePrompt({ record, text: chunks[0], profile }), runner),
    );
  }

  const partialPayloads = [];

  for (const [index, chunk] of chunks.entries()) {
    partialPayloads.push(
      await runCliJsonPrompt(
        buildChunkPrompt({
          record,
          chunkIndex: index + 1,
          totalChunks: chunks.length,
          text: chunk,
          profile,
        }),
        runner,
      ),
    );
  }

  return normalizeArticleSummary(
    await runCliJsonPrompt(buildChunkSynthesisPrompt({ record, chunkPayloads: partialPayloads, profile }), runner),
  );
}

export async function summarizeSearchDigest(input, legacySummaries, legacyOptions = {}) {
  const {
    query,
    articleSummaries,
    runner,
    profile,
  } = typeof input === 'object' && input !== null && 'query' in input
    ? input
    : {
        query: input,
        articleSummaries: legacySummaries,
        profile: null,
        ...legacyOptions,
      };
  if (!Array.isArray(articleSummaries) || articleSummaries.length === 0) {
    throw new Error('At least one article summary is required to build a digest.');
  }

  return normalizeDigestSummary(
    await runCliJsonPrompt(buildDigestPrompt({ query, articleSummaries, profile }), runner),
  );
}
