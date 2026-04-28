import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parses a Research Profile Markdown file.
 * Expects headers like # Categoria, # Projeto/Pesquisa, # Abordagem / Detalhe, # Palavras-chave
 */
export function parseResearchProfile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf8');
  const sections = {};
  let currentSection = null;

  for (const line of content.split(/\r?\n/)) {
    const headerMatch = line.match(/^#+\s+(.*)/);
    if (headerMatch) {
      currentSection = headerMatch[1].trim();
      sections[currentSection] = [];
      continue;
    }

    if (currentSection && line.trim().startsWith('-')) {
      sections[currentSection].push(line.trim().replace(/^-\s+/, ''));
    } else if (currentSection && line.trim() !== '' && !line.match(/^#+/)) {
        // Handle non-list content as well
        sections[currentSection].push(line.trim());
    }
  }

  return sections;
}

/**
 * Generates a search query string from a research profile.
 * Prioritizes 'Palavras-chave' section.
 */
export function generateQueryFromProfile(sections) {
  const keywordLines = sections['Palavras-chave'] || [];
  if (keywordLines.length === 0) {
    // Fallback to Projeto/Pesquisa if no keywords
    const projects = sections['Projeto/Pesquisa'] || [];
    return projects.length > 0 ? projects[0] : '';
  }

  // Usually, lines in keywords represent different facets or sets of synonyms.
  // For a broad search, we can OR all terms.
  // For a more structured search, we might AND the lines and OR the terms within lines.
  
  const groups = keywordLines.map(line => {
    const terms = line.split(',').map(t => t.trim()).filter(Boolean);
    if (terms.length === 0) return '';
    if (terms.length === 1) return `"${terms[0]}"`;
    return `(${terms.map(t => `"${t}"`).join(' OR ')})`;
  }).filter(Boolean);

  if (groups.length === 1) {
    return groups[0];
  }

  return groups.join(' AND ');
}

/**
 * Resolves the input to either a raw query or a profile-based query.
 */
export function resolveQueryInput(input, projectRoot) {
  if (input.toLowerCase().endsWith('.md')) {
    const fullPath = resolve(projectRoot, input);
    if (existsSync(fullPath)) {
      const profile = parseResearchProfile(fullPath);
      if (profile) {
        const generatedQuery = generateQueryFromProfile(profile);
        return {
          query: generatedQuery,
          profile,
          isProfile: true,
          profilePath: input
        };
      }
    }
  }

  return {
    query: input,
    profile: null,
    isProfile: false
  };
}
