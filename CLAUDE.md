# job-finder: working notes for Claude

Native desktop app (Electron 45 + React 19), pnpm workspace. Full plan: `docs/plans/job-finder.md`; spec: `docs/specs/job-finder.md`.

## Commands

- Install: `pnpm setup` (runs `pnpm install`)
- Dev web renderer only: `pnpm dev` (Vite on http://localhost:5173; no preload, so settings and secrets use an in-memory bridge)
- Dev desktop app: `pnpm desktop:dev`
- Build desktop: `pnpm desktop:build` (output in `apps/desktop/out`)
- Package installers for this OS: `pnpm desktop:dist` (output in `apps/desktop/dist`; release steps in `docs/release.md`)
- Packaged smoke test: `JOB_FINDER_PACKAGED_APP=<executable> pnpm --filter @job-finder/desktop test:e2e:packaged`
- Release notes preview: `node scripts/release-notes.mjs --version <v> [--previous <tag>] [--assets <dir>]`
- Typecheck: `pnpm typecheck` (uses TypeScript 7 via `node node_modules/typescript7/bin/tsc`; tooling uses TypeScript 6)
- Lint: `pnpm lint` (ESLint 10 flat config, `eslint.config.mjs`)
- Format: `pnpm format` / check only: `pnpm format:check`
- Unit tests: `pnpm test` (Vitest projects: core, web, desktop, repo)
- One test file, failures only: `pnpm exec vitest run --reporter=dot apps/web/src/lib/i18n/i18n.test.ts`
- One test project: `pnpm exec vitest run --project desktop --reporter=dot`
- Electron E2E: `pnpm test:e2e:desktop` (builds first, then runs Playwright against `apps/desktop/out`)
- Record AI fixtures (live calls, manual only): `JOB_FINDER_AI_PROVIDER=<anthropic|openai|openai-compatible> JOB_FINDER_AI_MODEL=<model> [JOB_FINDER_AI_BASE_URL=<url>] [JOB_FINDER_AI_API_KEY=<key>] pnpm fixtures:record`; writes sanitized `packages/core/src/ai/fixtures/ai-<provider>.json`
- New migration after a schema change: `pnpm --filter @job-finder/desktop db:generate --name <name>` (drizzle-kit generate; commit the new SQL and `meta/` files, never edit generated files)
- Everything: `pnpm verify`

## Folder map

- `apps/desktop/` Electron shell: `build/` (app icon, `after-pack.mjs` fuses hook), `electron-builder.yml` (installers), `src/main` (window, protocol, logging, security, i18n, `db/` SQLite adapter, migrator, operations and `ingest-operations.ts`, `ingest/` company and job repository and the ingestion service, `scoring/` affinity scoring service (profile and consent checks, hands the run to the engine), `discovery/` search relay to the engine, `engine/` utility-process supervisor, `settings/` repository, `secrets/` safeStorage store, `ai/` connection test, `profile/` versioned profile repository and CV import service, `page-loader/` hidden hardened window that renders JavaScript pages for the engine, `ipc/` guarded handlers), `src/engine` (engine utility process: entry, typed message protocol, runtime, `ingest.ts` run controller and its database-backed store, `scoring.ts` affinity runner; the entry must stay loadable in main, see Conventions), `drizzle/` (generated SQL migrations), `src/preload`, `e2e/` (Playwright: dev smoke and `packaged.spec.ts`), `electron.vite.config.ts`
- `scripts/` repo tooling (`release-notes.mjs`, unit-tested)
- `.github/workflows/` `ci.yml` (typecheck, lint, tests) and `desktop.yml` (installers, packaged smoke, draft release)
- `apps/web/` React renderer: `src/app` (router, shell), `src/features/<name>` (screens; `companies/` finds boards and manages companies, `jobs/` holds the scan, its log and results), `src/lib/i18n` (en.json, it.json), `src/styles.css` (tokens)
- `packages/core/` pure TypeScript domain logic, no Electron or React imports; `src/net/` HTTP client (per-host queue, robots.txt, response cache, backoff, fixture override) and the guarded page render (import as `@job-finder/core/net`); `src/db/schema.ts` holds the drizzle schema; `src/ai/` provider factory (import as `@job-finder/core/ai`), structured output with one repair retry, token check, record/replay fetch and its recorded `fixtures/`; `src/profile/` profile zod schema (import as `@job-finder/core/profile`, zod only); `src/cv/` PDF/DOCX/TXT readers and CV import (import as `@job-finder/core/cv`, Node-only); `src/normalize/` normalized job model, field helpers (locations, work mode, employment, seniority, salary, visa, language) and fingerprint dedupe (import as `@job-finder/core/normalize`); `src/ats/` ATS adapters for eight providers, URL and page detection, recorded `fixtures/` (import as `@job-finder/core/ats`; how to add one: `docs/adding-an-ats-adapter.md`); `src/ingest/` batch planning with fingerprint dedupe, the scan run and the run event type (import as `@job-finder/core/ingest`, events as `@job-finder/core/ingest/events`); `src/discovery/` search query builder, keyless DuckDuckGo source, Common Crawl URL index (pinned collection id in `commoncrawl.ts`), keyed Brave/Tavily/Serper sources and board candidates from result URLs (import as `@job-finder/core/discovery`, types as `@job-finder/core/discovery/types`); `src/careers/` generic careers pages for companies without a supported board: page reduction, AI listing and posting pages one hop away (import as `@job-finder/core/careers`); `src/ranking/` affinity scoring: scoring prompt, job and profile hashes, and the runner over a score store (import as `@job-finder/core/ranking`)
- `packages/bridge/` typed contract between preload and renderer: zod schemas for settings, secrets, profile and IPC payloads
- `tests/repo/` repository-level conventions tests
- `docs/` specs, plans, `release.md` (installers, releases, unsigned apps)

## Conventions

- Everything in the repo is English: code, comments, tests, commits, docs. Only user-facing strings are translated, through i18n keys present in both `en.json` and `it.json` (desktop main: `apps/desktop/src/main/i18n`; renderer: `apps/web/src/lib/i18n`). Key-parity tests enforce this.
- Every test file starts with the card: `// protects=...; fails_when=...; no_claim=...`. The repo test enforces it.
- Renderer never goes online: CSP is set in the main process (`src/main/security/csp.ts`). Renderer reaches the OS only through `window.jobFinder` (preload), typed by `JobFinderBridge` in packages/bridge; screens take it from `useBridge()`.
- IPC: every channel is a zod schema in `packages/bridge/src/ipc.ts`. Main checks the sender (top-level frame at the renderer origin, `security/origin.ts`) and validates the payload before any service runs. The sandboxed preload may import only `electron` and types, so it repeats channel names typed as `IpcChannel`.
- Settings are one JSON row per section (`settings.<section>`). Secrets are safeStorage ciphertext in rows `secret.<name>`; the renderer sees only storage mode and set / not set. Linux `basic_text` keys reach disk only after the Settings opt-in.
- Protocol: the renderer loads from `app://renderer/`, served only through `resolveAppRequest` (path-traversal guard).
- Electron main/preload build as CommonJS (no `"type": "module"` in `apps/desktop`); the preload runs in the sandbox, so it may import only `electron` and types.
- CV import: text is read in `core/cv`, one structured AI call runs in the engine. A cloud provider (`isCloudAiEndpoint` in bridge) needs the user's consent, which main enforces as well as the renderer. Profile saves start a new `profile_versions` row only when scoring fields change (`scoringSnapshot`).
- AI calls run in the engine, never in the renderer. Automated tests never reach the network: they inject `createReplayFetch` (or a scripted fetch) into `createAiModel`. The API key reaches the engine only through the `ai-test` message, never the renderer.
- Only main opens SQLite. The engine asks for database work through the typed `DbCall` batches in `apps/desktop/src/engine/protocol.ts`; main executes them through drizzle's sqlite-proxy over `node:sqlite`.
- Migrations run from `apps/desktop/drizzle` in development and from `resources/drizzle` when packaged (`extraResources` in `electron-builder.yml`). A backup (`VACUUM INTO`) is written before migrating a populated database.
- Install scripts go through `allowBuilds` in `pnpm-workspace.yaml`. Allowed only when the package cannot work without it (`electron: true`, it downloads the runtime). Denied when the package works without it: `esbuild: false` (it uses its platform binary package), `electron-winstaller: false` (Windows Squirrel only; we build NSIS). Record each change in the plan's Decisions.
- `build/after-pack.mjs` is an `.mjs` file because `@electron/fuses` is ESM-only; electron-builder loads it through `afterPack`.
- The bridge is type-checked without Node types, so its tests and sources must not import `core/cv` or `core/ai` at runtime; cross-checks against core live in `apps/desktop`.
- The bundler keeps shared helpers in the engine entry, so main loads that file too. The entry starts its runtime only when `process.parentPort` exists.
- Import boundaries are enforced by ESLint: `core` and `bridge` never import apps or Electron; only `apps/desktop` imports Electron; `apps/web` never imports desktop.
- Tooling-only dependencies stay at the root; app dependencies live in the app's own `package.json`.
- Network: all HTTP (GET and POST) goes through `createHttpClient` (`@job-finder/core/net`), which applies the 1 req/s per-host queue and robots.txt. Tests point it at a loopback fixture server with `JOB_FINDER_FIXTURE_BASE_URL`; main passes that to the engine only when the app is not packaged or under E2E (`main/engine/fixture-env.ts`).
- JavaScript pages: the engine calls `renderPage(url)`; main renders it in the hidden loader (`main/page-loader`) with no preload, all permissions denied, downloads blocked and navigation limited to the requested origin.
- Ingestion: `core/ingest` decides what to write, the engine runs it with batched database calls through main. A company's postings close only after its complete, successful scan; a failed, cancelled or storage-broken scan closes nothing. A run can be limited to one company (a retry from the Companies screen).
- Discovery: `core/discovery` searches keyless sources through the shared HTTP client and keeps only ATS board URLs. A bot challenge is reported as `search-blocked`; the code never works around it. Keyed providers run only with their Settings toggle and a saved key: main reads the key from SecretStore and passes it to the engine in the `discover-companies` message; it never reaches the renderer or a URL.
- Generic careers pages: a company without a supported board is read by `core/careers`. The page is rendered through `renderPage` only when its HTML has no text. The AI lists postings and reports whether the listing is complete. Posting pages are read one hop away, on the careers host only. The AI provider and its key reach the engine in the `ingest-start` message from main; without them the scan fails as `ai-unavailable`. A model that finds no postings fails as `no-parseable-jobs`, never as a complete empty scan. Only public page text goes to the provider; no consent prompt applies.
- Scoring: `core/ranking` scores open jobs with the AI. A stored score (`job_scores`, one row per job and profile version) is reused only when its job hash, profile hash, model, prompt version and explanation language (the UI language) match. Main passes the profile's ranking fields and the key to the engine in `score-jobs`; a cloud provider needs the CV import's consent. Jobs are listed by affinity for the current profile version.
- Commit messages use Conventional Commits (`chore:`, `docs:`, `feat:`), no attribution lines.
