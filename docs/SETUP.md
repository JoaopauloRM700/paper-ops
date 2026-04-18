# Setup

## Requirements

- Node.js 18+
- Playwright package installed in the repo
- Chromium browser installed for Playwright

## First Run

1. Run `npm install`
2. Run `npx playwright install chromium`
3. Create `.env` from the tracked template and add your API keys:

```text
.env
SCOPUS_API_KEY=<your-scopus-key>
IEEE_API_KEY=<your-ieee-key>
```

You can also keep using `config/keys.txt` as a fallback, but `.env` is now the primary local configuration path.

Environment variable precedence is:

1. process environment
2. `.env`
3. `config/keys.txt`

4. Review `config/sources.yml`
5. Run `node doctor.mjs`
6. Run `npm test`
7. Run a fixture-backed search:

```bash
node paper-ops.mjs search "\"systematic review\" AND rag" --fixtures
```

## Gemini CLI Usage

Interactive:

```bash
gemini
```

Then type:

```text
paper-ops search "\"systematic review\" AND rag"
paper-ops tracker
```

One-shot:

```bash
node paper-ops-gemini.mjs search "\"systematic review\" AND rag" --fixtures
```

The local runtime still writes `reports/*.md` and `output/*.json`, but it now also renders a terminal summary with source coverage, top results, PDF availability, and artifact paths.

## Live Sources

- Scopus: official Scopus Search API when `mode` is `api`, browser extraction otherwise
- IEEE: official IEEE Xplore Metadata API when `mode` is `api`, browser extraction otherwise
- ACM: browser-driven results extraction from the ACM Digital Library
- Google Scholar: experimental browser-driven extraction and best-effort only
