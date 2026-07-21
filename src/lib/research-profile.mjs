import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

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
  const explicitSearchStrings = sections['String de busca'] ?? sections['Search String'] ?? [];
  if (explicitSearchStrings.length > 0) {
    return explicitSearchStrings.join(' ').trim();
  }

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
  const normalizedInput = String(input ?? '').trim();
  const fullPath = resolve(projectRoot, normalizedInput);

  if (existsSync(fullPath)) {
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      const briefPath = join(fullPath, 'brief.md');
      if (existsSync(briefPath)) {
        const profile = parseResearchProfile(briefPath);
        if (profile) {
          return {
            query: generateQueryFromProfile(profile),
            profile,
            isProfile: true,
            isWorkspace: true,
            profilePath: briefPath,
            workspace: {
              id: basename(fullPath),
              root: fullPath,
              briefPath,
            },
          };
        }
      }
    }

    if (normalizedInput.toLowerCase().endsWith('.md')) {
      const profile = parseResearchProfile(fullPath);
      if (profile) {
        const generatedQuery = generateQueryFromProfile(profile);
        return {
          query: generatedQuery,
          profile,
          isProfile: true,
          isWorkspace: false,
          profilePath: input,
          workspace: null,
        };
      }
    }
  }

  return {
    query: normalizedInput,
    profile: null,
    isProfile: false,
    isWorkspace: false,
    workspace: null,
  };
}
