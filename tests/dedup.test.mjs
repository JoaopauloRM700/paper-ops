import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deduplicatePaperRecords,
  normalizePaperRecord,
} from '../src/lib/papers.mjs';

test('normalizePaperRecord returns the agreed PaperRecord shape', () => {
  const now = '2026-04-17T15:00:00.000Z';
  const record = normalizePaperRecord({
    source: 'scopus',
    source_id: 'SCOPUS-1',
    title: ' Retrieval-Augmented Generation for Systematic Reviews ',
    authors: ['Ada Lovelace', 'Grace Hopper'],
    year: '2025',
    venue: 'Journal of Applied AI',
    doi: '10.1000/RAG-SR',
    url: 'https://example.org/paper/rag-systematic-reviews',
    abstract: 'A survey of RAG-assisted evidence synthesis.',
    pdf_available: true,
    pdf_url: ' https://example.org/paper/rag-systematic-reviews.pdf ',
    matched_query: '("retrieval augmented generation" AND "systematic review")',
    retrieved_at: now,
  });

  assert.deepEqual(record, {
    source: 'scopus',
    source_id: 'SCOPUS-1',
    title: 'Retrieval-Augmented Generation for Systematic Reviews',
    authors: ['Ada Lovelace', 'Grace Hopper'],
    year: 2025,
    venue: 'Journal of Applied AI',
    doi: '10.1000/rag-sr',
    url: 'https://example.org/paper/rag-systematic-reviews',
    abstract: 'A survey of RAG-assisted evidence synthesis.',
    pdf_available: true,
    pdf_url: 'https://example.org/paper/rag-systematic-reviews.pdf',
    matched_query: '("retrieval augmented generation" AND "systematic review")',
    retrieved_at: now,
  });
});

test('deduplicatePaperRecords prefers DOI, then source identity, then title plus year', () => {
  const records = [
    normalizePaperRecord({
      source: 'scopus',
      source_id: 'SCOPUS-ALPHA',
      title: 'Evidence Mapping with RAG Pipelines',
      authors: ['Ada Lovelace'],
      year: 2024,
      venue: 'Scopus Venue',
      doi: '10.1000/alpha',
      url: 'https://example.org/alpha-scopus',
      abstract: 'alpha from scopus',
      pdf_available: null,
      pdf_url: '',
      matched_query: 'rag evidence mapping',
      retrieved_at: '2026-04-17T15:00:00.000Z',
    }),
    normalizePaperRecord({
      source: 'ieee',
      source_id: 'IEEE-ALPHA',
      title: 'Evidence Mapping with RAG Pipelines',
      authors: ['Ada Lovelace'],
      year: 2024,
      venue: 'IEEE Venue',
      doi: '10.1000/alpha',
      url: 'https://example.org/alpha-ieee',
      abstract: 'alpha from ieee',
      pdf_available: true,
      pdf_url: 'https://example.org/alpha-ieee.pdf',
      matched_query: 'rag evidence mapping',
      retrieved_at: '2026-04-17T15:00:00.000Z',
    }),
    normalizePaperRecord({
      source: 'acm',
      source_id: 'ACM-BETA',
      title: 'Knowledge Graphs for Literature Screening',
      authors: ['Grace Hopper'],
      year: 2023,
      venue: 'ACM Venue',
      doi: '',
      url: 'https://example.org/beta',
      abstract: 'beta from acm',
      pdf_available: null,
      pdf_url: '',
      matched_query: 'knowledge graphs literature screening',
      retrieved_at: '2026-04-17T15:00:00.000Z',
    }),
    normalizePaperRecord({
      source: 'scholar',
      source_id: 'SCHOLAR-BETA',
      title: ' Knowledge Graphs for Literature Screening ',
      authors: ['Grace Hopper'],
      year: 2023,
      venue: 'Scholar Venue',
      doi: '',
      url: 'https://scholar.example.org/beta',
      abstract: 'beta from scholar',
      pdf_available: true,
      pdf_url: 'https://scholar.example.org/beta.pdf',
      matched_query: 'knowledge graphs literature screening',
      retrieved_at: '2026-04-17T15:00:00.000Z',
    }),
    normalizePaperRecord({
      source: 'ieee',
      source_id: 'IEEE-GAMMA',
      title: 'Neural Topic Models for Evidence Synthesis',
      authors: ['Barbara Liskov'],
      year: 2022,
      venue: 'IEEE Venue',
      doi: '10.1000/gamma',
      url: 'https://example.org/gamma',
      abstract: 'gamma',
      pdf_available: false,
      pdf_url: '',
      matched_query: 'topic model evidence synthesis',
      retrieved_at: '2026-04-17T15:00:00.000Z',
    }),
  ];

  const result = deduplicatePaperRecords(records);

  assert.equal(result.uniqueRecords.length, 3);
  assert.equal(result.stats.totalInput, 5);
  assert.equal(result.stats.duplicatesRemoved, 2);
  assert.deepEqual(result.stats.removedByRule, {
    doi: 1,
    sourceIdentity: 0,
    titleYear: 1,
  });
  assert.equal(result.uniqueRecords[0].pdf_available, true);
  assert.equal(result.uniqueRecords[0].pdf_url, 'https://example.org/alpha-ieee.pdf');
  assert.equal(result.uniqueRecords[1].pdf_available, true);
  assert.equal(result.uniqueRecords[1].pdf_url, 'https://scholar.example.org/beta.pdf');
});
