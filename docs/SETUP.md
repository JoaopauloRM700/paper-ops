# Setup

## Requirements

- Node.js 18+
- Optional source credentials:
  - `SCOPUS_API_KEY`
  - `IEEE_API_KEY`

## First Run

1. Review `config/sources.yml`
2. Run `node doctor.mjs`
3. Run `npm test`
4. Run a fixture-backed search:

```bash
node paper-ops.mjs search "\"systematic review\" AND rag" --fixtures
```

## Live Sources

- Scopus: provide `SCOPUS_API_KEY`
- IEEE: provide `IEEE_API_KEY`
- ACM: works through a lightweight Crossref-backed path in v1
- Google Scholar: experimental and disabled by default in live mode
