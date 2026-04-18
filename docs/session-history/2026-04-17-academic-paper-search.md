# Session History: Academic Paper Search Replatform

**Date:** 2026-04-17
**Project:** `paper-ops`
**Working directory:** `D:\workspace\paper-ops`

## Why This Repo Exists

This project was split out as a new standalone repository after the original inherited workspace was confirmed to be a separate, dirty job-search project with unrelated changes.

The user explicitly redirected the work from "adapt the existing repo in place" to:

- create a completely new project
- use the academic-paper-search plan as the base
- prepare it for eventual GitHub publishing under `JoaopauloRM700`

## Locked Decisions

- Project name: `paper-ops`
- Target environment: Gemini CLI first
- Public router: `paper-ops`
- V1 output: saved result set
- Primary sources: Scopus, IEEE, ACM
- Google Scholar: experimental, non-blocking, disabled by default in live mode
- Config surface: `config/sources.yml`
- Normalized record shape: `PaperRecord`

## Implementation Actions Completed

1. Created a fresh standalone project directory: `D:\workspace\paper-ops`
2. Initialized a new git repository on `main`
3. Added red tests first for:
   - `PaperRecord` normalization
   - deduplication behavior
   - CLI routing behavior
   - fixture-backed search run persistence
   - missing-credential partial success behavior
4. Verified the initial red failure
5. Implemented:
   - config loading
   - source adapters
   - deduplication
   - artifact writing
   - queue and batch helpers
   - CLI entrypoint
   - doctor/verify scripts
6. Re-ran tests to green
7. Added project docs, mode files, Codex/Gemini entrypoints, and plugin metadata

## Current State

Core runtime exists and passes the current test suite.

Artifacts now supported:

- `reports/*.md`
- `output/*.json`
- `data/search-history.md`
- `data/search-queue.md`

## Verification Evidence

The following commands were run successfully in the new repository:

```bash
node --test --test-isolation=none tests/*.test.mjs
node doctor.mjs
node paper-ops.mjs search "\"systematic review\" AND \"retrieval augmented generation\"" --fixtures
node verify.mjs
```

Observed results:

- 5 tests passed, 0 failed
- doctor checks passed
- fixture-backed smoke search wrote a markdown report and JSON export
- search-history link verification passed
- a disposable temp-project smoke run also passed without polluting the repo commit scope

## Remaining Blockers

- `gh` is not installed in the environment, so automated GitHub repo creation / PR workflows are currently blocked
- Pushing to `https://github.com/JoaopauloRM700` will require either:
  - `gh` installed and authenticated, or
  - an existing remote repo plus authenticated git push access
- The local repo remote was configured as `https://github.com/JoaopauloRM700/paper-ops.git`
- An earlier direct push attempt reached GitHub and failed with `Repository not found`
- The repository was later created or made accessible, and push to branch `Workspace` succeeded

## Next Steps

1. Continue implementation on branch `Workspace`
2. Optionally install/authenticate `gh` for future GitHub automation
3. Create additional commits and push them to `origin/Workspace`

## Original Repo Evaluation

The original `D:\workspace\article researcher` repo was re-evaluated as a transplant source after the standalone `paper-ops` scaffold was created.

### High-value transplant candidates

1. **Batch orchestrator design**
   - Source: `batch/batch-runner.sh`
   - Why: It already has lock files, resumable state, retry handling, agent autodetection, per-item logs, and parallel worker orchestration.
   - Relevance to `paper-ops`: strong fit for batch processing many search strings or source URLs.

2. **Comprehensive verification harness**
   - Source: `test-all.mjs`
   - Why: It checks syntax, script execution, build health, data contract assumptions, and repo hygiene in one place.
   - Relevance to `paper-ops`: strong fit, but should be adapted to search-specific artifacts instead of job-search files.

3. **Doctor/setup ergonomics**
   - Source: `doctor.mjs`
   - Why: Better UX than the current minimal `paper-ops` doctor script.
   - Relevance to `paper-ops`: medium-high fit if rewritten around source credentials, config, and optional dependencies.

4. **Plugin and router integration pattern**
   - Source: plugin skill files and OpenCode command wrappers
   - Why: The original repo has a fuller multi-surface integration story across Codex, Gemini, Claude, and OpenCode.
   - Relevance to `paper-ops`: high fit, especially if multi-agent prompt surfaces matter.

5. **Dashboard architecture pattern**
   - Source: `dashboard/`
   - Why: The Bubble Tea TUI is structurally reusable even though the current data model is job-search-specific.
   - Relevance to `paper-ops`: medium fit for a later phase; not worth transplanting before the search runtime matures.

### Low-value or avoid-for-now transplants

- Job-evaluation modes and prompts
- CV/PDF generation pipeline
- Tracker merge/status scripts tied to application workflows
- Any onboarding/data-contract assumptions centered on CVs, job portals, or recruiting actions

### Conclusion

The original repo is worth using as an **operational scaffolding source**, not as a domain-logic source.

The best next transplants into `paper-ops` are:

1. batch orchestration
2. richer repo-wide verification
3. improved doctor/setup checks
4. optional multi-surface command/plugin wrappers

## Transferred Files Review and Remediation

After the indicated files were copied from the original repo into `paper-ops`, the project was reviewed again to identify which transfers were useful and which ones reintroduced stale `career-ops` behavior.

### Problems found

1. `doctor.mjs` had been overwritten with job-search onboarding checks (`cv.md`, `profile.yml`, `portals.yml`, fonts, Playwright).
2. The Codex plugin metadata and skill file had reverted from `paper-ops` back to `career-ops`.
3. `batch/batch-runner.sh`, `batch/batch-prompt.md`, and `batch/worker-output.schema.json` were copied over in job-offer form.
4. `test-all.mjs` had been copied over as a career-search validation suite instead of a paper-search validation suite.
5. Some public-facing text files had encoding artifacts after the file transfer.

### Adjustments made

1. Restored the plugin metadata and skill file so the public Codex surface is once again `paper-ops`.
2. Rewrote `doctor.mjs` around the actual `paper-ops` contract:
   - config parsing
   - required directories
   - fixture presence
   - batch asset presence
   - plugin surface presence
   - optional agent CLI detection
   - warning-only checks for missing live API credentials
3. Rewrote `test-all.mjs` into a repo-level validation suite for:
   - syntax
   - required files
   - stale `career-ops` term regressions on active public files
   - unit tests
   - doctor
   - verify
   - fixture-backed smoke search
   - batch runner shell syntax
4. Reworked the transferred batch files so they now describe and execute batch literature searches rather than batch job-offer evaluation.
5. Normalized transferred public text back to ASCII where practical and fixed `_shared.md`.
6. Updated `.gitignore` for runtime-generated batch and data artifacts.
7. Exposed `test:all` in `package.json` and documented the shell batch runner in `README.md`.

### Deferred

- `dashboard/` remains a deferred transplant candidate.
- It is still structurally useful, but its model and imports are still tied to the old job-search domain and were intentionally left out of the active verification surface for now.

### Verification after remediation

The adjusted runtime and repo-level checks were rerun successfully:

```bash
node --test --test-isolation=none tests/*.test.mjs
node doctor.mjs
node verify.mjs
node test-all.mjs
```

Observed results:

- unit tests: 5 passed, 0 failed
- `doctor.mjs`: passed with warning-only missing credential notices for live Scopus and IEEE keys
- `verify.mjs`: passed
- `test-all.mjs`: 51 passed, 0 failed, 2 warnings

Current warnings are expected:

1. live API credentials are not set locally for Scopus and IEEE
2. `dashboard/` is still present only as a deferred transplant candidate, not an active verified surface

## Branch Transition

The reviewed remediation work is being moved off `Workspace` into a new development branch so the legacy branch can be removed cleanly.

Intent:

1. create a new branch for the transferred-file remediation work
2. commit the current `paper-ops` adjustments there
3. delete `Workspace` after the replacement branch is established

## Browser-Driven Live Search Pivot

The project direction was clarified after implementation had already assumed API-backed live sources for Scopus and IEEE.

### Correction from the user

- Live searches should not depend on source APIs
- Searches should be performed in web browsers
- Result links and article metadata should be extracted from the source result pages
- This applies to all configured sources, including ACM and Google Scholar

### Implementation changes

1. Added `playwright` as the runtime dependency for live browser automation.
2. Replaced API-era live-source assumptions in config with browser `search_url` settings.
3. Added a shared Playwright browser runtime:
   - one browser per search run
   - one page per source search
   - browser lifecycle managed in `search-runner`
4. Reworked all live adapters to build source-specific search URLs and extract visible metadata from browser-loaded result pages.
5. Kept fixture mode as the primary automated verification path.
6. Reworked doctor checks to validate Playwright plus Chromium availability instead of API credentials.
7. Added browser-oriented tests for:
   - per-source result extraction
   - browser live mode without API keys
   - graceful skipping when the browser runtime cannot start

### Updated verification evidence

```bash
node --test --test-isolation=none tests/*.test.mjs
node doctor.mjs
```

Observed results after the browser pivot:

- 7 tests passed, 0 failed
- `doctor.mjs` passed with Playwright and Chromium detected

## PDF Availability Enrichment

The result model was extended so each normalized `PaperRecord` now also carries:

- `pdf_available`
- `pdf_url`

### Behavior

1. Fixture-backed and browser-driven adapters now attempt to detect direct PDF links per source.
2. IEEE and ACM currently populate direct PDF URLs from both fixtures and browser result pages where available.
3. Scopus and Google Scholar default to `null` PDF availability when the result page does not expose a reliable PDF link.
4. Deduplication now enriches the retained canonical record with PDF metadata discovered on later duplicate records instead of discarding that metadata.
5. Markdown reports now include `PDF Available` and `PDF URL` columns, and JSON exports include both fields in each record.

### Verification evidence

The PDF enrichment changes were implemented test-first and verified with:

```bash
node --test --test-isolation=none tests/dedup.test.mjs tests/browser-adapters.test.mjs tests/search-runner.test.mjs
```

Observed results:

- 7 targeted tests passed, 0 failed

## Gemini-First Terminal Surface Restoration

The original project expectation was clarified further: the repo should not only have a local runtime, it should also feel operationally agent-first in the terminal, especially through Gemini CLI.

### Problem

The earlier `paper-ops` implementation had the search engine and saved artifacts, but it still behaved mainly like a direct Node CLI:

- `paper-ops.mjs` only printed artifact paths
- the Gemini-facing docs existed, but the interactive/router-style experience from the original project had not been fully restored
- there was no explicit one-shot Gemini wrapper surface

### Adjustments made

1. Added terminal rendering helpers so `paper-ops` now prints:
   - search summary
   - source coverage
   - top results
   - PDF status
   - artifact paths
2. Added `paper-ops-gemini.mjs` plus package bin wiring as an explicit one-shot Gemini wrapper.
3. Enriched `GEMINI.md`, `README.md`, `docs/SETUP.md`, and mode files so the Gemini usage path now mirrors the operational style of the original repository more closely.
4. Updated `doctor.mjs` to report Gemini CLI availability explicitly instead of only reporting generic agent CLI detection.
5. Added red-first tests for:
   - terminal summary rendering through `main()`
   - Gemini prompt canonicalization for one-shot wrapper usage

### Verification evidence

```bash
node --test --test-isolation=none tests/*.test.mjs
node doctor.mjs
node verify.mjs
node test-all.mjs
npm run search:smoke
```

Observed results:

- 9 unit/integration tests passed, 0 failed
- `doctor.mjs` passed with 1 warning because Gemini CLI is not installed in the current environment PATH
- `test-all.mjs` passed with 2 warnings:
  - Gemini CLI missing locally
  - `dashboard/` still deferred

## IEEE and Scopus API Pivot

Live browser extraction proved unreliable for Scopus and IEEE in the current environment, while the user later supplied official API keys for both systems through `config/keys.txt`.

### Decision

The runtime now uses a hybrid source model:

- `scopus` -> official Scopus Search API
- `ieee` -> official IEEE Xplore Metadata API
- `acm` -> browser-driven extraction
- `google_scholar` -> browser-driven extraction, still experimental

### Adjustments made

1. Added local API key resolution in `src/lib/config.mjs`:
   - reads gitignored `config/keys.txt`
   - allows `SCOPUS_API_KEY` and `IEEE_API_KEY` to override local file values
2. Added `mode: "api"` support for source configs.
3. Reworked `scopus` and `ieee` adapters so they can execute against official APIs instead of Playwright.
4. Updated `config/sources.yml` so Scopus and IEEE now default to `api` mode.
5. Updated `doctor.mjs` so it validates:
   - `api_url` presence for api-mode sources
   - local API credential readiness for api-mode sources
6. Updated docs to reflect the new hybrid architecture and local key handling.

### Verification evidence

```bash
node --test --test-isolation=none tests/*.test.mjs
node doctor.mjs
```

Observed results:

- 12 tests passed, 0 failed
- `doctor.mjs` reports API credentials ready for api-mode sources

### External validation snapshot

One live validation was run outside the sandbox after the adapter changes:

- `scopus` returned records successfully through the official API
- `ieee` returned `HTTP 403` with `Developer Inactive`, indicating the supplied IEEE key is not currently active for metadata search in the upstream service
- `acm` remains browser-driven and can still return zero depending on current site behavior
- `google_scholar` remained browser-driven and returned records in that validation

## Local Environment File Setup

The credential-loading flow was then tightened so the repository supports both a tracked template and a private local key file.

### Adjustments made

1. Added a tracked `.env.example` file with placeholder entries for:
   - `SCOPUS_API_KEY`
   - `IEEE_API_KEY`
2. Added a local `.env` file in the working copy containing the user's real keys.
3. Kept `.env` ignored by git so the real credentials cannot be committed.
4. Kept `config/keys.txt` as a backward-compatible fallback, but changed the preferred local workflow to `.env`.
5. Added `src/lib/env.mjs` to parse `.env` and merge it with process environment variables.
6. Updated `src/lib/config.mjs` so API key resolution precedence is now:
   - process environment
   - local `.env`
   - local `config/keys.txt`
7. Updated docs and repo checks so the tracked template is part of the public contract.

### Intent

This satisfies the repository split the user requested:

- one env file that can be versioned safely as a template
- one env file that stays local with private credentials
