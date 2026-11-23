# job-finder — implementation plan

Spec: docs/specs/job-finder.md. Architecture: see the Architecture section below.

## Goal

A native desktop app (macOS, Windows, Linux), open source, single-user and local, that
discovers job openings across the web (careers pages and ATS boards first), ranks them
against the user's profile, tracks applications with a duplicate guard, and prepares each
application (tailored CV, cover letter, auto-filled form) for the user to review and submit.

## Rules for every step

- Each step ends with green tests for what it adds and one or more atomic commits.
- Every test carries a card comment `// protects=...; fails_when=...; no_claim=...`.
- Tables are created by the step that first needs them, each in its own drizzle-kit
  migration, with a test that migrates a populated fixture of the previous schema.
- UI kit components (`apps/web/src/components/ui`) are added when first used, not upfront.
- Every new user-facing string (renderer and main process) goes through i18n with keys in
  both `en.json` and `it.json`.
- Every screen has empty, loading and error states; screens that use AI also have an
  "AI unavailable" state. Keyboard navigation and visible focus on every control.
- Network in tests: no live calls. Engine and main code read base URLs through an
  env-guarded override (`JOB_FINDER_FIXTURE_BASE_URL`, honored only when not packaged or
  under E2E) pointing to a local fixture server; AI goes through the record/replay
  provider (step 5).
- `CLAUDE.md` is updated in the same step whenever commands, folders or conventions change.

## Steps

1. **Workspace scaffold.** pnpm workspace (`apps/desktop`, `apps/web`, `packages/core`,
   `packages/bridge`), `tsconfig.base.json`, TypeScript 7 typecheck via the `typescript7`
   alias, ESLint 10 (import boundaries, i18next plugin, react-hooks) + Prettier, Vitest 5
   projects (`core`/node, `web`/jsdom, `desktop`/node, `repo`). `apps/desktop`: electron-vite
   main + preload + renderer wiring, one window with a strict CSP (renderer never goes
   online), `app://` protocol with a path-traversal guard, `requestSingleInstanceLock`
   (second launch focuses the existing window), file logger in `userData/logs` with rotation
   and redaction at the sink, main-process i18n (`apps/desktop/src/main/i18n`, same key-parity
   test). `apps/web`: React 19 + Vite 8 + Tailwind 4 tokens in `styles.css`, router,
   react-i18next with `en.json`/`it.json` + key-parity test. Root scripts: `setup`, `dev`,
   `desktop:dev`, `desktop:build`, `typecheck`, `lint`, `format`, `test`, `test:e2e:desktop`,
   `verify`. `CLAUDE.md`, `README.md`, MIT `LICENSE`, `CONTRIBUTING.md`. Electron E2E smoke
   (window opens, second instance does not open a second window).
2. **Engine walking skeleton and persistence foundation.** `node:sqlite` (`DatabaseSync`) in
   main behind a small adapter used by `drizzle-orm/sqlite-proxy`; migrator for drizzle-kit
   SQL migrations shipped as `extraResources`; backup before each migration via
   `VACUUM INTO`; first migration with `settings` and `runs` tables only. Engine as an
   Electron `utilityProcess` (`apps/desktop/src/engine`) with a typed message port: ping,
   batched DB write and read requests served by main, automatic restart on crash with a
   logged reason, reconcile of runs left `running` after a crash (marked `interrupted`) at
   startup. Tests: sqlite-proxy row mapping, migrator + backup, engine ping/read round trip,
   crash → restart → reconcile.
3. **CI and release pipeline.** `.github/workflows/ci.yml` (typecheck, lint, unit tests on
   ubuntu). `.github/workflows/desktop.yml`: manual dispatch + tags `v*`; version check (tag =
   `apps/desktop/package.json` version); builds on macos-latest (dmg arm64 + x64, ad-hoc
   signed with `identity: '-'`), windows-latest (NSIS x64), ubuntu-latest (AppImage + deb
   x64); `@electron/fuses` hardening; Electron E2E smoke **against the packaged app** on all
   three OSes (Linux under xvfb), including the engine ping and a `node:sqlite` read; draft
   GitHub Release with all installers and notes from `scripts/release-notes.mjs`.
   `apps/desktop/electron-builder.yml` (Electron version pinned), app icon,
   `docs/release.md` (incl. opening unsigned apps).
4. **Bridge, settings and secrets.** Typed IPC contract in `packages/bridge` with zod schemas;
   main validates every payload and checks the sender frame is the app's `app://` window.
   Settings repository; secrets encrypted with `safeStorage`; check
   `safeStorage.getSelectedStorageBackend()`: on Linux `basic_text` the app warns and stores
   keys only after explicit opt-in, otherwise keeps them for the session only. The renderer
   only ever sees "set / not set". Settings screen: AI provider (Anthropic, OpenAI,
   OpenAI-compatible base URL), model, key, context size; search providers and keys; UI
   language; notifications; scheduler interval; close behavior; launch at login (hidden on
   Linux); update check toggle. Renderer repositories over `window.jobFinder` with in-memory
   fakes for web tests.
5. **AI layer.** `packages/core/src/ai/`: provider factory over Vercel AI SDK 7
   (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`) with a per-provider
   capability flag (native structured output vs JSON-mode fallback); `generateStructured`
   helper (zod schema, one repair retry, typed error otherwise); token estimate vs configured
   context size with a warning (Ollama's default context silently truncates); record/replay
   provider for every automated test, `pnpm fixtures:record` to record and sanitize AI and
   HTTP fixtures; "test connection" action.
6. **Onboarding and profile.** Onboarding order: AI provider (with test connection) → CV
   upload → profile review. Consent note before sending the CV when the provider is
   cloud-based. Text extraction (`unpdf`, `mammoth`, plain text), AI extraction into the
   profile zod schema, profile editor (experience, education, skills with aliases,
   languages, certifications, links), application defaults and standard answers. Tables
   `profile`, `profile_versions`; a new version only when scoring-relevant fields change.
7. **Fetch infrastructure and page loader.** `packages/core/src/net/`: HTTP client with
   per-host queue (`p-queue`, 1 req/s), `robots-parser` with cached `robots.txt` (applied to
   search providers too), response cache, backoff on 429/5xx, generic user agent,
   fixture base-URL override. Hidden page loader in main for JS-rendered pages: sandboxed,
   no preload, its own session partition, all permissions denied, downloads blocked,
   `window.open` denied, navigation limited to the requested origin; exposed to the engine
   as `renderPage(url)`. Job HTML is shown in the UI only as sanitized text.
8. **Normalization and ATS adapters.** Normalized job model and helpers (country codes,
   work mode, remote scope, employment type, seniority, salary, language, visa). Identity:
   ATS jobs keyed by (source, source_job_id); fingerprint (company + title + normalized
   location set) only for cross-source dedupe. Adapters for Greenhouse, Lever, Ashby,
   Workable, SmartRecruiters, Personio, Recruitee, Teamtailor against sanitized recorded
   fixtures; ATS detection from URL and page markers. `docs/adding-an-ats-adapter.md`.
9. **Ingestion pipeline vertical slice.** Tables `companies`, `jobs`, `job_sources`,
   `run_events`. Engine run orchestration for a list of companies (ingest via ATS adapters →
   dedupe → persist in batched writes), `closed_at` set only after a complete, successful
   scan of that source, per-source failure isolation, run log, progress events, cancel via
   `AbortSignal`. Minimal results list in the UI to see ingested jobs end to end
   (Greenhouse-only company added by hand is enough to exercise it).
10. **Discovery A: web search and companies.** First verify DuckDuckGo's `robots.txt` and
    terms for the HTML endpoint and record the outcome in Decisions; if disallowed, keep it
    best-effort and document a free-tier key as the default. Source interface; DuckDuckGo
    HTML client (own, cheerio); query builder from saved-search criteria (keywords ×
    location × ATS domains); company registry storing careers URL + detected ATS; manual
    company entry; Companies screen (add by URL, detected ATS, last scan, "no parseable
    jobs", retry).
11. **Discovery B: Common Crawl and keyed providers.** Common Crawl CDX index client
    enumerating company slugs on ATS domains (scoped, cached); optional Brave, Tavily,
    Serper clients enabled only with a key.
12. **Generic careers page adapter.** Fetch (or render) a careers page, reduce HTML to text +
    links, AI-extract postings into the normalized model, follow posting links up to a
    bounded depth; "no parseable jobs" marking.
13. **Matching and ranking.** Table `job_scores`. Affinity score 0–100 + explanation via the
    AI layer, cache key (job content hash, profile hash, model, prompt version), computed
    only for jobs that pass the hard filters, visible/top jobs first, per-run AI budget,
    concurrency limit; jobs without a score still listed when AI is unavailable.
14. **Search and filters UI.** Tables `saved_searches`, `job_flags` (dismissed, new only).
    Filter engine in core (SQL from a typed filter object) covering every spec filter;
    "posted within" falls back to `first_seen_at` when `posted_at` is missing; minimum salary
    compares only same currency and period (no FX). Results view sorted by affinity (toggle
    newest), job detail with all sources, dismiss / bookmark / "new" badge, saved searches
    CRUD, run progress and run log.
15. **Application tracker.** Tables `applications`, `application_events`; bookmark is an
    application with status `bookmarked` (single source of truth). Status machine
    (`bookmarked → preparing → ready → applied → interviewing → offer | rejected | withdrawn`),
    events with timestamps and notes, duplicate guard (see Decisions), list + board views,
    CSV export without secrets and with formula-injection escaping. Prepare-application
    flow: duplicate warning → documents → open apply window.
16. **CV and cover letter.** AI returns a structured CV that references profile item ids;
    validator: employers, titles, dates and degrees must match the profile verbatim, skills
    match the profile including aliases, numbers in bullets must appear in the source
    bullet. HTML templates (ATS-readable), in-app editor, PDF via hidden window
    `printToPDF`, files stored per application.
17. **Autofill core and ATS adapters.** Apply window: its own session partition, sandboxed,
    no preload, permissions denied, downloads blocked except user-initiated. Filling through
    `webContents.debugger` (CDP): native value setters + input/change events for
    React-controlled inputs, iframes and open shadow roots, `DOM.setFileInputFiles` for
    uploads; hidden and honeypot fields skipped; never sends Enter in inputs and never
    triggers submit (tests cover clicks and keys). Deterministic adapters for Greenhouse,
    Lever, Ashby; highlight of unfilled fields; "I submitted it" → `applied`, closing
    without confirming → stays `ready`.
18. **Autofill AI fallback.** AI maps form fields to profile keys and stored answers only
    (output constrained to known keys; page text treated as untrusted), drafted answers for
    free-text questions visibly marked as AI-drafted, same never-submit guard.
19. **Scheduler, notifications, tray, updates.** Scheduler in the engine (interval 1–168 h,
    default 24 h, catch-up at start, wall-clock check on `powerMonitor` resume, injected
    clock for tests); one native notification per run with new jobs, click opens filtered
    results (also at cold start); Windows AppUserModelID; tray/menu-bar icon (Open, Search
    now, Quit); close prompt (keep running / quit, remember choice, changeable in settings);
    launch at login (macOS/Windows); update check against GitHub Releases with a
    "new version available" banner, toggle in settings.
20. **End-to-end and docs.** Electron E2E of the full journey against the fixture server and
    recorded AI (onboard → search → open job → prepare → autofill on a local fixture form →
    mark applied → duplicate guard); README (install, first launch, providers, Ollama setup,
    privacy incl. every outbound connection), documented live smoke test, optional scheduled
    CI canary against real ATS APIs, final `CLAUDE.md` pass.

## Tests

Per the spec Testing Plan, plus the review additions: single instance, engine crash/restart,
`closed_at` on partial scans, CSV injection, migration backup, safeStorage without keyring,
IPC validation, renderer CSP (no network), main-process i18n parity, Enter-key never-submit,
honeypot skipping, packaged smoke on three OSes, robots.txt on search providers,
clock-injected scheduler. Unit tests live in `packages/core`, integration in `apps/desktop`,
renderer tests in `apps/web` (jsdom, fakes), one Electron E2E journey. AI is always replayed
in automated tests; the live smoke test is documented, not automated.

## Risks

- **DuckDuckGo keyless HTML** may throttle, change markup or disallow automated access:
  checked at step 10, isolated behind the source interface, never stops a run.
- **Common Crawl** is large, slow and weeks old: scoped to ATS domains, cached, used to seed
  companies, not fresh postings.
- **`node:sqlite`** is still marked experimental upstream: Electron pinned, packaged smoke
  per OS in CI, all access behind one adapter.
- **Local models** truncate context and return malformed output: token warning, JSON-mode
  fallback, repair retry.
- **Autofill on unknown forms** is unreliable: highlighted fields and user review are the
  safety net; never-submit guard tested on clicks and keys.
- **Untrusted page content** (job HTML, forms) reaches AI prompts: outputs constrained to
  schemas and known keys; hardened windows.
- **Unsigned installers** show OS warnings; ad-hoc re-signing per version may re-prompt the
  keychain for `safeStorage` on macOS: documented.
- **Scope:** 20 steps; 10, 12, 16, 17 and 18 are the largest and most fragile.

## Architecture

### App shape

Electron 45 desktop app for macOS (arm64, x64), Windows (x64) and Linux (x64). No backend, no
server, no Docker. Three processes:

- **Main** (`apps/desktop/src/main`): windows, tray, database, secrets (`safeStorage`),
  native notifications, hidden page loader, PDF rendering, apply window and autofill (CDP via
  `webContents.debugger`), IPC handlers.
- **Engine** (`apps/desktop/src/engine`, Electron `utilityProcess`): discovery, ingestion,
  AI calls, ranking, scheduler. Talks to main through a typed message port; asks main for
  `renderPage` and DB writes. Keeps the UI responsive during long runs.
- **Renderer** (`apps/web`): React UI. Never goes online (CSP); reaches everything through
  `window.jobFinder` (preload) and repositories with in-memory fakes for tests.

Electron's bundled Chromium covers autofill, PDF and JS-rendered pages, so users download no
extra browser. Playwright is a dev dependency only (Electron E2E).

### Libraries (versions verified 2026-11-23, all MIT/Apache/BSD)

| Area | Choice |
|---|---|
| Shell & build | electron 45.4.1, electron-vite 6.0.0, electron-builder 26.18.0 |
| UI | react 19.3, vite 8.3, tailwindcss 4.3, Radix primitives, zustand 5.1, @tanstack/react-query 5.108, i18next 27 + react-i18next 18 |
| Data | `node:sqlite` (built into Electron's Node 24.22; no native module), drizzle-orm 0.45 via `sqlite-proxy`, drizzle-kit 0.31 |
| AI | ai 7.0, @ai-sdk/anthropic 4, @ai-sdk/openai 4, @ai-sdk/openai-compatible 3, zod 4.6 |
| Scraping | cheerio 1.2, robots-parser 3.1, p-queue 10, own DuckDuckGo and Common Crawl clients |
| Documents | unpdf 2.2 (PDF text), mammoth 1.13 (DOCX), Electron `printToPDF` |
| Quality | typescript 7 (typecheck) / 6 (tooling), eslint 10 + prettier 3, vitest 5.1, msw 3, @playwright/test 1.65 |

### Folder layout

```
apps/desktop/      Electron: src/main, src/preload, src/engine, drizzle/ (migrations),
                   e2e/, build/ (icons), electron-builder.yml
apps/web/          React renderer: src/app, src/features/<name>, src/components/ui,
                   src/lib (repositories, i18n en/it), src/testing
packages/core/     Pure TS: db/schema, ai/, net/, sources/, ats/, normalize/, ranking/,
                   filters/, applications/, documents/; no Electron imports
packages/bridge/   IPC contract types (channels, payloads, engine events)
docs/              specs/, plans/, release.md
.github/workflows/ ci.yml, desktop.yml
```

Tests sit next to the code (`*.test.ts`). Import boundaries enforced by ESLint: `core` and
`bridge` import nothing from apps; features never import other features.

### Alternatives considered

- **Local web app (Node server + browser UI)**: simpler, rejected by the user (wants a
  native desktop app, no terminal, no web app).
- **Tauri**: smaller installers, but Rust backend and the system webview (WebKit on
  macOS/Linux) make scraping, AI orchestration and third-party form automation much harder.
- **Python + FastAPI**: good scraping ecosystem, but two languages and painful packaging
  for end users.
- **better-sqlite3**: mature, but a native module rebuilt per OS/Electron version;
  `node:sqlite` avoids it.
- **Playwright at runtime for autofill/PDF**: would require downloading a separate
  Chromium; Electron's own Chromium + CDP does the same.
- **duck-duck-scrape**: unmaintained since 2025-01; a small own client is safer.
- **node-notifier**: unnecessary in Electron (native `Notification`).
- **Code signing + electron-updater**: about $99/year plus a Windows certificate; deferred,
  replaced by an in-app "new version available" check.

### Conventions

Mirrors electrical-plan-designer: pnpm 12, Node 26 for tooling, repo in English, UI strings
only via `t()` with every key in `en.json` and `it.json`, design tokens in `styles.css`,
Radix-based `components/ui`, draft GitHub Releases from tags.

### Engine data access

All engine reads and writes go through main over the message port, batched per page of
jobs. The engine gets its own WAL connection only if profiling shows the port is a
bottleneck (decision deferred, not planned).

## Progress

Phase: implementation
Branch: main
Base: 08b4fe9
Spec: docs/specs/job-finder.md
Architecture: agreed
Approved: yes (2026-11-23)

### Steps
- [x] 1. Workspace scaffold — `docs: add CLAUDE.md, README, license, contributing guide and repo conventions test`
- [x] 2. Engine walking skeleton and persistence foundation — `feat: start engine and migrations from main, reconcile runs on startup`
- [x] 3. CI and release pipeline — `ci: build, smoke-test and draft-release the desktop installers from v* tags`
- [x] 4. Bridge, settings and secrets — `feat: add settings screen over the typed bridge`
- [x] 5. AI layer — `feat: test the AI connection from the settings screen through the engine`
- [x] 6. Onboarding and profile — `feat: add onboarding and profile editor screens`
- [x] 7. Fetch infrastructure and page loader — `feat: render JavaScript pages in a hidden loader for the engine`
- [x] 8. Normalization and ATS adapters — `docs: add ATS adapter guide and record step 8 decisions`
- [x] 9. Ingestion pipeline vertical slice — `docs: record step 9 decisions and tick the step`
- [x] 10. Discovery A: web search and companies — `docs: record step 10 decisions and tick the step`
- [x] 11. Discovery B: Common Crawl and keyed providers — `docs: record step 11 decisions and tick the step`
- [x] 12. Generic careers page adapter — `docs: record step 12 decisions and tick the step`
- [x] 13. Matching and ranking — `docs: record step 13 decisions and tick the step`
- [x] 14. Search and filters UI — `feat: filter, sort and flag jobs, with saved searches`
- [x] 15. Application tracker — `feat: add the applications screen, bookmarks and the hide-applied filter`
- [x] 16. CV and cover letter — `feat: add the CV and cover letter panel to application details`
- [x] 17. Autofill core and ATS adapters — `feat: open and autofill the application form from its detail screen`
- [ ] 18. Autofill AI fallback
- [ ] 19. Scheduler, notifications, tray, updates
- [ ] 20. End-to-end and docs

### Verification
- qa: pending
- review: pending

### Decisions
- Single-user, local-only app; published as open source on GitHub, each user runs it on their own machine.
- No market/role restriction: sources and filters must be market-neutral.
- Discovery via automatic web search with free, keyless sources and no extra software (no Docker); paid search APIs optional.
- LinkedIn and Indeed fully excluded.
- AI: multi-provider (Anthropic, OpenAI, any OpenAI-compatible endpoint incl. Ollama/LM Studio).
- Applying: the app fills the form (ATS adapters + AI fallback), the user reviews, edits and submits; the app never submits.
- Search: manual search plus a scheduler for saved searches with desktop notifications.
- Affinity score 0-100 with explanation; results sorted by affinity by default; all useful filters implemented.
- Native desktop app for every OS (no terminal, no web app); stack and layout left to the assistant: Electron + TypeScript, pnpm workspace mirroring electrical-plan-designer.
- Release via GitHub Actions on `v*` tags building macOS, Windows and Linux installers into a draft release, like electrical-plan-designer.
- Unsigned installers (ad-hoc on macOS); in-app "new version available" check instead of auto-update.
- On window close the app asks whether to keep running in the background (tray, scheduler active) or quit, with "remember my choice"; changeable in settings.
- Autoplan (CEO, design, eng; DX skipped) corrections integrated: engine walking skeleton early, packaged E2E on 3 OSes, single instance, IPC validation, hardened loader/apply windows, per-step migrations, record/replay test seam, split discovery and autofill steps, bookmark as application status.

- Update check against GitHub Releases: on by default, toggle in settings, listed in the README privacy section; spec constraints updated.
- Duplicate guard: same job/fingerprint warns and needs two explicit confirmations to proceed; same company within 90 days warns with one confirmation; spec AC8 reworded.
- Linux without keyring (`basic_text`): warn; store API keys only after explicit opt-in, otherwise session-only.
- i18next pinned to 27.1.0 instead of 27.2.5 (published 2026-11-23) to respect pnpm's minimum release age; no release-age exclusions.
- esbuild install script denied via allowBuilds (esbuild: false); drizzle-kit works without it.
- Engine calls reject with EngineUnavailableError on crash and after the supervisor gives up (after 5 failed restarts, i.e. the 6th consecutive crash); surfacing the failed state in the UI is left to a later UI step.
- Installers: electron-builder 26.18.0 (exact, pinned with `electronVersion` 45.4.1). `electron: true` in `allowBuilds` because its install script downloads the runtime that packaging and the E2E need; `electron-winstaller` stays denied. No other install script was blocked.
- Fuses (`build/after-pack.mjs`, ESM hook): RunAsNode, NODE_OPTIONS and CLI inspect arguments off; cookie encryption and OnlyLoadAppFromAsar on; embedded ASAR integrity not configured (off). Playwright launches Electron with `--inspect=0`, so the packaged smoke test runs a copy of the app with only the inspect fuse turned on (ad-hoc re-signed on macOS). Installers keep it off.
- macOS: dmg for arm64 and x64, ad-hoc signed (`identity: "-"`), hardened runtime and Gatekeeper assessment off, no notarization. Windows: NSIS x64. Linux: AppImage and deb x64 (`executableName: job-finder`). Artifact names `job-finder-<version>-<arch>.<ext>`.
- App icon: `apps/desktop/build/icon.png` (1024 px placeholder); electron-builder derives the icns and ico from it.
- Packaged smoke runs against the unpacked app in each platform's output directory, not against the installers. It asserts the window, `engine ready`, an `applied N migration(s)` log line, `process.resourcesPath/drizzle` present, and a `node:sqlite` count of `__drizzle_migrations` from the main process.
- Linux CI passes `--no-sandbox` to the test launch only (`JOB_FINDER_E2E_NO_SANDBOX=1`), as a precaution against the Ubuntu runner's user-namespace restrictions. Not reproduced yet; revisit if the Linux job runs fine without it.
- Release: the desktop workflow creates a draft release only for `v*` tags; a manual run uploads artifacts to the run and stops there. Tag must equal `apps/desktop/package.json` version. Release notes come from `scripts/release-notes.mjs` (Conventional Commit subjects since the previous `v*` tag).
- Actions are pinned to major version tags (`@v4`/`@v5`), not commit SHAs: this step had no way to verify SHAs. Pin before the first public release.
- Workflow YAML validated with a parser (js-yaml); actionlint is not installed here.
- Root `tsconfig.json` gets `allowJs` so the `.mjs` release script can be imported by its `.ts` test; `scripts/` is a Vitest project.

- Step 4: no table or migration. Settings are one JSON row per section (`settings.<section>`) in the existing settings table; encrypted secrets are rows `secret.<name>` (base64 safeStorage ciphertext).
- Step 4: zod 4.6.7 in `packages/bridge` (Architecture version, released 2026-10-12). `@job-finder/bridge` moved to desktop devDependencies so electron-vite bundles it like `core`; `apps/web` depends on it.
- Step 4: `URL.origin` is `"null"` for `app://`, so the renderer origin and the navigation guard compare scheme and host (`security/origin.ts`). The guard in `window.ts` had the same flaw and is fixed here.
- Step 4: the sandboxed preload imports only `electron` and types, so it repeats the channel names typed as `IpcChannel`. The renderer sees only storage mode and set / not set per key; no secret value leaves main except through the engine path added in step 5.
- Step 4: Linux `basic_text` keys stay in memory until the Settings opt-in; the opt-in flushes them to disk. No UI revokes the opt-in.
- Step 4: close behaviour, scheduler interval, notifications, launch at login and update check are stored only; their effects land with step 19. UI language applies in the renderer; main-process dialogs keep following the system locale.
- Step 4: UI kit starts with native-control components (`Button`, `TextInput`, `SelectInput`, `CheckboxInput`); Radix is deferred until a dialog or menu needs it.
- Step 4: a plain browser (`pnpm dev`) uses an in-memory bridge, so the settings screen works without Electron. The `bridge` Vitest project was added.

- Step 5: AI SDK pinned to the newest 7.0 patch past the release-age gate: `ai` 7.0.179, `@ai-sdk/anthropic` 4.0.107, `@ai-sdk/openai` 4.0.122, `@ai-sdk/openai-compatible` 3.0.94, plus `zod` 4.6.7 in `packages/core` (all exact, no age exclusions). The `ai` package ships agent skills that pnpm lists as awaiting approval; they were not approved.
- Step 5: no build script was blocked; no `allowBuilds` change.
- Step 5: `ai` 7 deprecates `generateObject`, so structured output uses `generateText` with `Output.object`. OpenAI uses Chat Completions (`provider.chat`), the same wire format as OpenAI-compatible servers.
- Step 5: capability table `AI_CAPABILITIES`: anthropic and openai use native structured output; openai-compatible (Ollama, LM Studio) uses the JSON-mode fallback (text answer, code fence stripped, zod-validated). `generateStructured` retries once with the model's rejected output and the validation issue, then throws `AiError("invalid-output")`.
- Step 5: token check is a character heuristic (about four characters per token) plus a 1024-token output reserve. Exceeding the context size returns a `context-exceeded` warning; no screen shows it yet (step 6 and step 13 consume it).
- Step 5: record/replay is a fetch seam, not a model mock: `createReplayFetch` and `createRecordingFetch` in `packages/core/src/ai/replay.ts`, passed as the `fetch` option of `createAiModel`. Requests are keyed by method, path and body hash; the host is ignored so recordings replay against any base URL. Recordings strip the key from response bodies. Automated tests use hand-written scripted fetch doubles, labelled as such, because no live key was available here.
- Step 5: `pnpm fixtures:record` runs `packages/core/src/ai/record-fixtures.test.ts`, skipped unless `JOB_FINDER_RECORD_AI=1`, and writes `packages/core/src/ai/fixtures/ai-<provider>.json`. No recording is committed yet; the live run is manual (documented in CLAUDE.md). HTTP fixtures come with the fetch layer in step 7.
- Step 5: "test connection" runs in the engine. Main reads the saved AI settings and the key (`SecretStore.read`), sends them as an `ai-test` message, and receives only `{ ok, model }` or a failure code. The key never reaches the renderer; `ai:test-connection` takes no payload. The engine call has a 20 s timeout; a crashed or unavailable engine reports `engine-unavailable`.
- Step 5: the settings screen tests the saved settings, not the unsaved draft, and shows loading, connected (with the model) or "AI unavailable" with the reason. The in-memory bridge reports `engine-unavailable` by default.
- Step 5: the core AI module is imported through the subpath `@job-finder/core/ai`, so the provider SDKs stay out of the core barrel used by main's settings code.
- Step 5: the supervisor sends requests to a ready engine in the same tick, so a crash right after a call still finds the request pending.
- Step 5: not exercised: real provider calls and a real Ollama server (no keys or local model in this run), the AI test button in the packaged app, and quality of structured output on real models.

- Step 6: the profile schema is `packages/core/src/profile/schema.ts` (subpath `@job-finder/core/profile`, zod only), so the renderer loads it through bridge without Node code. CV readers and the AI import are `packages/core/src/cv` (subpath `@job-finder/core/cv`, Node-only, used by the engine and typed through bridge only).
- Step 6: tables `profile` (single row id 1: JSON `data`, `version`, `updated_at`) and `profile_versions` (version, scoring snapshot, `created_at`), each in its own drizzle-kit migration (`0001_profile`, `0002_profile_versions`), each with a migration test on a populated database. A save writes a new version only when a scoring field changes: headline, summary, experience, education, skills, languages, certifications. Contact, links, application defaults and standard answers do not start a version.
- Step 6: `unpdf` 2.2.1 and `mammoth` 1.13.0 (exact) in core, the Architecture versions; both pass the release-age gate (unpdf 2.2.1 published 2026-11-15, mammoth 1.13.0 2026-09-26). No `allowBuilds` change; `pnpm approve` was not run for the `ai` package's agent skills.
- Step 6: CV flow: the renderer reads the chosen file and sends the bytes (limit 10 MB, checked in the bridge schema and again in the renderer) through `profile:import-cv`. Main checks consent, reads the key, and hands bytes and key to the engine; the engine returns only the draft. The CV file and its text are not stored; nothing is saved until the user saves the reviewed profile.
- Step 6: cloud providers are Anthropic, OpenAI, and an OpenAI-compatible endpoint unless its host is `localhost`, `127.0.0.1`, `[::1]` or `*.localhost`. An empty or unparseable base URL counts as cloud. Consent is required for cloud providers and enforced in main.
- Step 6: the AI extraction uses `generateStructured` with the CV text as data under fixed instructions. The extraction schema defaults missing sections to empty, so a sparse answer is valid. An oversized prompt returns a `context-exceeded` warning, shown on the review step.
- Step 6: dates are free text (CVs write them many ways); skill and language levels are free text; salary period is an enum; links must be http or https and are never fetched (LinkedIn stays plain text). Blank list rows are dropped on save; partly filled link rows are refused.
- Step 6: application defaults and standard answers live in the profile row, not in their own table; no step needs to query them separately yet.
- Step 6: a stored profile row that no longer validates makes `profile:get` fail (the screen shows its error with retry) instead of being replaced silently; the next save stores a new version.
- Step 6: onboarding order is enforced in the UI: Continue unlocks only when the AI settings are saved, and the connection test runs against saved settings. The profile screen links to onboarding when no profile exists; there is no automatic redirect.
- Step 6: the AI key field and connection test moved from `SettingsScreen` into `features/settings/AiControls.tsx`, so onboarding reuses them. `TextArea` is added to the UI kit at its first use.
- Step 6: the engine entry starts its runtime only when it has a parent port, and loads the CV readers on the first import. Without the guard the E2E smoke test caught a startup failure: the bundler keeps shared helpers in the engine entry, so main required it and hit `parentPort` undefined.
- Step 6: `migrate.test.ts` counted the rollback's recorded migrations as a hard-coded 1; it now counts the repo's migrations, since the profile migrations add to them.
- Step 6: not exercised: real provider calls (no keys here); extraction quality on real models (scripted doubles only, no CV recording); the file picker and CV flow inside the packaged app; PDF and DOCX files from real users (three fixtures only: PDF and DOCX, plus TXT, in English and Italian).

- Step 7: `p-queue` 10.0.0 and `robots-parser` 3.1.1 (exact, in core; the Architecture versions, no release-age exclusion needed). No `allowBuilds` change.
- Step 7: the fixture override rewrites only the origin: `https://host/path?query` goes to `<JOB_FINDER_FIXTURE_BASE_URL>/path?query`, and robots.txt is read from the fixture origin too. The engine gets it only when the app is not packaged or `JOB_FINDER_E2E` is set, and only for loopback http(s) (`main/engine/fixture-env.ts`).
- Step 7: user agent `Mozilla/5.0 (compatible; job-finder)`; robots rules matched for the product token `job-finder`.
- Step 7: one request per second per host (p-queue, concurrency 1, interval cap 1). robots.txt fetches and retries count against that queue; the backoff wait happens outside it.
- Step 7: robots.txt: 2xx is parsed; 401 and 403 block the origin for an hour; 5xx, network errors, timeouts and oversize files block it for five minutes; other 4xx allow everything. The final URL of a redirect is checked too.
- Step 7: retries for 429, 5xx and network errors: up to three attempts, waits of 1 s then 2 s, or `Retry-After` capped at 60 s. Timeouts (20 s) and caller cancellations are not retried. Bodies over 5 MiB are refused.
- Step 7: the response cache is in memory only (2xx GET, 10 minutes, 200 entries). No table: the plan has no persistent HTTP cache.
- Step 7: the runtime exposes `renderPage(url)`: it resolves the URL, checks robots.txt, then asks main over the port (`page-render`). Main's supervisor forwards it to the page loader and answers with `page-render-result`.
- Step 7: the hidden loader opens one window per request with the in-memory partition `job-finder-page-loader`, sandboxed, no preload, JavaScript on, never shown. Every permission is denied, downloads are blocked, `window.open` is denied, subresources are limited to http, https, data and blob, and top-frame, redirect and subframe navigation off the requested origin is cancelled. Load timeout 30 s, one second of settle time after the load event, HTML limit 5 MiB. The window is destroyed and its partition storage cleared after each request.
- Step 7: the hardening is unit-tested against a fake window; the Electron window itself is only typechecked and started by the E2E run. The E2E smoke passed after the change (engine ready, packaged-style build).
- Step 7: no UI, no table, no user-facing strings. Job HTML is not shown anywhere yet; the sanitized-text rule applies when the first screen shows it (step 9 or 12).
- Step 7: not exercised: a real hidden window rendering a real JavaScript page (no automated test reaches Electron's window), real sites and their robots.txt, and the 1 s spacing under real timers in production (tests use 60 ms).

- Step 8: `cheerio` 1.2.0 (exact, the Architecture version, released 2026-01-23) in core, for HTML to text and the Personio and Teamtailor XML. No `allowBuilds` change.
- Step 8: the normalized model is `packages/core/src/normalize` (subpath `@job-finder/core/normalize`). Identity is `(source, sourceJobId)`, with `source` the ATS id. Cross-source duplicates are found by `fingerprint` (SHA-256 of company without legal suffixes, title without gender markers, and the sorted location set). `groupByFingerprint` only groups; choosing the ATS URL as `apply_url` is left to step 9.
- Step 8: work mode comes from a structured field first, then the title, then the location text. Never from the description, where "remote" appears in unrelated sentences. Remote scope is the text after "remote" in the location.
- Step 8: countries are matched by name in English, Italian and German (CLDR). Two-letter codes are never read from free text ("CA" is Canada and California). "Georgia" is never read as a country (US state in Lever data). Deprecated codes such as UK and FX are excluded. Structured fields carry their code.
- Step 8: seniority and visa come from stated text only (title, level label, the description for visa). Nothing is inferred; AI-based inference is for the scoring step.
- Step 8: salary needs a currency symbol or code and at least one amount; the period is optional. Language is a stop-word heuristic for en, it, de, fr, es and pl, and returns nothing for short text.
- Step 8: ATS adapters read public APIs: Greenhouse, Lever, Ashby, Workable (account widget, undocumented, shape checked on every read), SmartRecruiters (paged, 100 per page, capped at 20 pages), Personio (XML feed), Recruitee (offers API). Teamtailor's API needs a key, so the adapter reads the public career-site feed `https://<slug>.teamtailor.com/jobs.rss`.
- Step 8: a failed page returns a failure with no jobs, so a partial read can never close jobs. A slug must match the pattern `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, so it cannot change the URL.
- Step 8: fixtures were recorded from the public endpoints on 2026-11-23 and trimmed (first postings, descriptions cut to 900 characters, unused fields removed). They are not byte-identical to live responses. Lever's API has no company name and SmartRecruiters' list has no description, so those come from the board's company name and an empty description.
- Step 8: ATS detection checks the careers URL first, then the links and embed URLs in the page. Pages with an ATS script but no link (no board token) are reported as unknown.
- Step 8: `docs/adding-an-ats-adapter.md` is the guide; CLAUDE.md lists the new folders.
- Step 8: not exercised: no test reaches a live provider; the fixtures came from one manual check of each public endpoint, so a format change at a provider is found only by re-recording. Workable's widget shape is undocumented. Teamtailor custom domains and Personio's `.com` tenants are not tested. Greenhouse multi-city location strings keep their raw text as one location.

- Step 9: tables `companies`, `jobs`, `job_sources` and `run_events` in migrations 0003 to 0006, one per table, each with a migration test on a populated database of the previous schema. `companies.careers_url` is unique; `ats` and `slug` stay null when no supported board is detected, and such a company is not scanned.
- Step 9: identity is (source, source_job_id). A posting from a new source joins an existing job with the same fingerprint only when that job has no posting from the same source, so two openings of one source with the same title and place stay two jobs.
- Step 9: `jobs` keeps the apply URL of the first source that stored it. Every source in this step is an ATS, so the ATS preference of the spec waits for step 10's non-ATS sources.
- Step 9: closing. A complete, successful scan closes the source rows of its company that the run did not see; a job closes when none of its sources is open and reopens when one is seen again. An empty complete scan closes every posting of that company. A failed, cancelled or storage-broken scan closes nothing.
- Step 9: run outcome: `succeeded` when the run completes, even if some companies failed (their failures are in the log); `failed` only when the run itself breaks; `cancelled` after an abort; `interrupted` from startup reconcile, or from main when the engine dies during a run.
- Step 9: one run at a time. The engine answers a start with `accepted` or `already-running`, and sends the final `run-finished` event only after the run row is closed, so a new run can start as soon as the renderer sees the end of the last one.
- Step 9: engine writes per company: one lookup and one persist call per batch of 50 postings, then one close call; one `run-events.append` call per log entry. The run log stores codes and counts only, and the renderer words them through i18n.
- Step 9: manual company entry is a form on the jobs screen (`/jobs`). It takes a name and a careers URL, detects the board from the URL alone (no request), and refuses a board already stored (same ATS and board token). Step 10 moves it into the Companies screen.
- Step 9: `runs.kind` is `ingest`. Progress reaches the renderer on the `ingest:progress` channel through `ingest.onProgress`.
- Step 9: not exercised: a scan against a live Greenhouse board (the adapter tests read recorded fixtures, and no test runs a scan end to end through the fixture server); a scan inside the packaged app (the desktop E2E run covers the window and the engine start, and its packaged smoke test was skipped without `JOB_FINDER_PACKAGED_APP`); a real HTTP request cancelled in flight (the core test uses a scripted abort).

- Step 10: DuckDuckGo robots.txt (checked 2026-11-23): `html.duckduckgo.com/robots.txt` has `User-agent: *` with `Allow: /`, so the HTML endpoint is allowed. The main host's robots.txt disallows `/html` and `/lite`, but the app does not use that host. The terms page was searched for an automation clause and none was found; this is not a legal review.
- Step 10: the live HTML endpoint answered a scripted request (the app's user agent, a `site:` query) with a bot-challenge page (HTTP 200, an "anomaly" modal, no results). It is kept as `packages/core/src/discovery/fixtures/duckduckgo-challenge.html`. The client reports a challenge as `search-blocked`, stops the run at the first one, and never tries to get past it. So keyless discovery is best-effort, and a free-tier search key (step 11) is the default for reliable discovery.
- Step 10: `packages/core/src/discovery/fixtures/duckduckgo-results.html` is hand-written in the results layout, not a recording. Prettier skips the fixtures folder because the challenge page is not valid HTML for its parser.
- Step 10: queries are one per keyword, location and ATS domain group (`"keyword" "location" (site:a OR site:b)`), capped at 12 per run (`MAX_QUERIES`). The HTTP queue spaces them one second apart. Keywords and locations are trimmed, quotes and operators are removed, and at most five of each are kept.
- Step 10: a candidate is one board (ATS and token). Its careers URL is the canonical address for that ATS, kept only when detection reads it back as the same board. The name is the board token, which the user can change later; company names from the ATS APIs are not used.
- Step 10: discovery is a request, not a run: no table, no run log. The engine answers within a 120 s deadline with what it found. Found boards are returned to the Companies screen and stored only when the user adds them. Keyless, so no settings or secrets were added; keyed sources (step 11) will read them.
- Step 10: the Companies screen shows each company's last scan from the run log (the latest `company-scanned` or `company-failed` event per company). No new table or column. "No parseable jobs" means the last complete scan read zero postings.
- Step 10: "retry" starts a run limited to one company (`ingest:start` with `companyId`); the run and its closing rules are unchanged. Other companies are not touched.
- Step 10: manual company entry moved from the jobs screen to `/companies`. The jobs screen keeps the scan, its log and the results, and points to the Companies screen when no company is saved.
- Step 10: no migration: the existing `companies` and `run_events` tables cover the step.
- Step 10: not exercised: a real results page from DuckDuckGo (only the hand-written results fixture and the recorded challenge); a real search from the app (the challenge blocks scripted clients here); a scan of a live board from the app; discovery in the packaged app (the E2E run covers the window and the engine start only).

- Step 11: Common Crawl index pinned to `CC-MAIN-2026-43-index` (read from `collinfo.json` on 2026-11-23). It is queried per ATS domain with `matchType=domain`, status 200, URL only, at most 500 captures per domain. The sample is partial by design: the index is sorted by URL, so it seeds the company list rather than listing every board.
- Step 11: Common Crawl ignores the keywords and locations (the index holds no posting text). It runs once per discovery as a board source, not once per query, and its boards are added to the candidates. Its responses use the shared HTTP client's 10-minute cache. A domain that answers 404 has no captures and counts as empty; the run fails only when every domain fails.
- Step 11: discovery runs each enabled search source for every query. A source that answers with a challenge is not asked again, while the other sources keep running. The outcome is `ok` with `searchBlocked: true` when a source was blocked but others gave boards; `search-blocked` only when nothing succeeded and a source was blocked.
- Step 11: keyed providers run only with their Settings toggle on and a key saved. Each enabled provider runs every query, so one search can make up to twelve requests per provider: quotas are the user's to watch. Each query asks for 20 results.
- Step 11: keys reach the engine only in the `discover-companies` message, which main builds from SecretStore. Keys travel in headers (`X-Subscription-Token` for Brave, `Authorization: Bearer` for Tavily, `X-API-KEY` for Serper), never in a URL, a log line or the renderer. Parsing rejects a reply of the wrong shape as `invalid-response` without echoing the body.
- Step 11: the endpoints were checked against public documentation on 2026-11-23: Brave `api.search.brave.com/res/v1/web/search` (GET, `web.results[].url`) and Tavily `api.tavily.com/search` (POST, `results[].url`). For Serper only the response path (`organic[].link`) was confirmed; the endpoint `google.serper.dev/search` and the `X-API-KEY` header come from its public API and were not confirmed on the page read.
- Step 11: `createHttpClient` gains `post(url, { body, headers })` and per-request headers. The queue, robots.txt, retries and fixture override apply to both. Only GET requests without headers are cached, so keyed reads and POSTs are never served from the cache.
- Step 11: the Companies screen reads the key status and shows a hint with a link to Settings when no search key is saved, and again when keyless search is blocked. The Settings key hint now recommends a free-tier key. The README documents the free-tier key and the discovery sources.
- Step 11: no table or migration. Settings toggles and secret rows from step 4 cover the step.
- Step 11: not exercised: any live call to Common Crawl or a keyed provider (none made, per the rules); the CDX line format on a live response (the parser skips malformed lines); a discovery run from the packaged app (the E2E run covers the window and the engine start only); a real search with a saved key from the app.

- Step 12: no table or migration. A company without a supported board keeps its `companies` row with `ats` and `slug` null; its postings are `job_sources` rows with source `careers-page`.
- Step 12: add-company accepts any http or https careers link. A supported board is still detected and stored with its ATS and slug; other links are stored as generic careers pages. A link or board that is already stored is refused as a duplicate. The `unsupported-careers-url` code is removed.
- Step 12: `core/careers` (subpath `@job-finder/core/careers`) reads one generic page through the shared HTTP client. It renders the page through `renderPage` only when its HTML has under 300 characters of visible text. It reduces the page to visible text and at most 300 absolute http(s) links, then asks the model for the postings with `generateStructured`. The answer has a `listingComplete` flag, and each posting has a title, a location and a link.
- Step 12: the prompt is capped at 60,000 characters and must fit the configured context size. Anything larger fails as `too-large`; the page is never cut and read as complete. More than 200 postings also fail as `too-large`.
- Step 12: a posting's link is used only when it is one of the page's own links. Otherwise the posting's identity is a hash of its title and location, and it links to the careers page.
- Step 12: posting pages are read one hop from the careers page, on its host only, up to 25 per company. The description is the visible text of the posting page, cut to 4,000 characters, with no AI call. A posting page that fails keeps its job without a description, since the listing still shows the job.
- Step 12: a listing with zero postings fails as `no-parseable-jobs`, so it closes nothing. A company whose page really lists no openings keeps its old postings open until the job is removed or a posting shows again. The Companies screen shows its last scan as "No parseable jobs".
- Step 12: `listingComplete: false` (pagination, "load more", more roles than shown) fails as `incomplete-listing`. A page with a render failure fails as `render-failed`. Failures are added to `AdapterFailureCode`, and their reasons are worded in en and it.
- Step 12: main reads the AI settings and the saved key when a run starts, and sends them in `ingest-start`. The engine builds the model for that run only and keeps the key in memory. With no usable provider, generic pages fail as `ai-unavailable` with no request made. Companies with a supported board scan as before.
- Step 12: no consent prompt for the generic scan. It sends only public page text, not profile data, so the CV consent rule does not apply. Revisit if the user wants a gate for cloud providers here too.
- Step 12: the engine's `ingest-start` message and the `IngestApi` carry the AI settings and `renderPage`. Main's supervisor and ingestion service take the settings as an optional argument, so ATS-only runs are unchanged.
- Step 12: fixtures are hand-written (a static listing, an empty app shell, a rendered listing, one posting page), not recordings of real sites. The automated tests use a scripted HTTP fetch and a scripted provider behind `createAiModel`, and never reach the network.
- Step 12: Prettier was applied to the files this step touched. Several files already failed `pnpm format:check` at HEAD and were not touched: `core/discovery/discover.ts`, `core/discovery/keyed.ts`, `core/discovery/commoncrawl.test.ts`, `core/discovery/discover.test.ts`, `core/discovery/keyed.test.ts`, `core/net/http.test.ts`, `desktop/main/discovery/service.ts` and its test. Fixing them is left to a separate change.
- Step 12: not exercised: real career pages or real model answers (none were requested, per the rules); the hidden window rendering a JavaScript careers page (the E2E run covers the window and the engine start only); a generic company scanned from the packaged app; AI extraction quality on real pages and models; posting-page descriptions on real sites, which can include navigation text.
- Step 13: scoring starts from the jobs screen ("Score jobs"), not during ingestion. The renderer awaits `scores:start`; the engine runs the scoring and returns counts. No `runs` row and no run log for scoring, since the step did not ask for progress.
- Step 13: the hard filters belong to step 14's filter engine, which does not exist yet. Candidates are the open jobs, newest first, at most 500 per run. Step 14 passes the filtered and visible order into the same run.
- Step 13: `core/ranking` (subpath `@job-finder/core/ranking`) scores in chunks of 10 with at most 3 AI calls at once (`p-queue`, already a core dependency) and at most 50 AI calls per run. A stored score costs no call. Jobs past the budget count as skipped and a later run scores them.
- Step 13: table `job_scores` has the primary key (`job_id`, `profile_version`), one row per job and profile version. A stored score is reused only when its job hash, profile hash, model and prompt version (1) all match. A new profile version finds no row and is scored again; the list reads only the current version's rows.
- Step 13: the job hash covers the fields the prompt shows (company, title, description, locations, work mode, employment type, seniority, salary, visa sponsorship, language). The profile hash is the hash of the existing scoring snapshot, so contact-only edits keep the scores.
- Step 13: the answer is `{score: integer 0-100, explanation}` through `generateStructured`, with its one repair retry. An invalid answer after the retry counts as failed and stores nothing. Any other AI failure (unreachable, rejected key, rate limit, unknown model, no model configured) stops the run as `ai-unavailable`; scores stored before it are kept.
- Step 13: explanations are AI output in English, not i18n strings. Revisit if explanations should follow the app language.
- Step 13: for a cloud provider, the profile's ranking fields and the job text leave the machine, so scoring needs the same consent as the CV import (`consent` in `scores:start`). The plan does not say this; it is the conservative choice. Local providers need no consent.
- Step 13: the list is sorted by affinity, highest first, unscored jobs last and newest first within each group. The newest-first toggle is step 14's.
- Step 13: the engine gets the profile's ranking fields only (no contact details) and the key for the run only. It reaches the database through three batched calls (`scores.jobs`, `scores.lookup`, `scores.persist`) that main executes.
- Step 13: migration `0007_job_scores.sql` adds a CHECK on the score range and a foreign key to `jobs`; the populated-fixture test is `scoring-migrations.test.ts`.
- Step 13: without a provider or key the jobs screen shows "AI unavailable" with a link to Settings and keeps the jobs listed unscored. "No profile" and "consent required" have their own messages.
- Step 13: Prettier was applied to the files this step touched. `pnpm format:check` is clean on the whole repo at the end of the step.
- Step 13: not exercised: real model answers and provider behaviour (scripted doubles only); scores and the budget on a real job set; the 500-job cap with real data; a scoring run in the packaged app (the E2E covers the window and engine start only).

- Step 14 (fix, its own commit): explanations follow the UI language. Main resolves `ui.language` ("system" reads `app.getLocale()` through `resolveMainLanguage`) and sends it in `score-jobs`. The language is stored per score (`job_scores.explanation_language`, migration `0008_score_explanation_language`; step 13 rows read as `en`) and is part of the reuse key. Prompt version 2, so every step 13 score is recomputed once. The column has no SQLite CHECK: the drizzle enum types it, the database does not enforce it. Main follows the OS locale for "system", the renderer its browser language list; the two can differ.
- Step 14: migrations `0009_saved_searches` (JSON of the typed filter, name, timestamps) and `0010_job_flags` (one row per job: `dismissed_at`, `viewed_at`); each has a populated-fixture test in `filter-migrations.test.ts`.
- Step 14: `core/filters` holds the zod filter (`@job-finder/core/filters`, re-exported by bridge) and the SQL condition over `jobs` (`@job-finder/core/filters/sql`). Flags, scores and sources are read through subqueries, so any query on `jobs` can use the condition. The web reaches core only through bridge; `@job-finder/core/normalize/job` is a new subpath because the normalize index loads Node's crypto.
- Step 14: keywords match when any one is in the title or the description; excluded keywords remove a job when any is there. LIKE wildcards are escaped. SQLite `LIKE` is case-insensitive for ASCII only.
- Step 14: the minimum salary compares only with salaries in the same currency and period, using the posting's maximum (its minimum when no maximum is stated). Other salaries are kept, unless "hide without salary" is on, which keeps only the comparable jobs that meet the minimum. No exchange rates.
- Step 14: "posted within" and "newest first" both use the posting date, falling back to `first_seen_at`. For unscored jobs this replaces step 13's first-seen order with the same rule.
- Step 14: the source filter keeps jobs with an open posting from a chosen source (ATS id; generic careers pages are `careers-page`). Companies are filtered by id.
- Step 14: minimum affinity and new-only are view filters. The hard filters for scoring are all the others, including hide dismissed, so a dismissed job is not scored under the default filter.
- Step 14: a scoring run takes the filter and the listed job ids. Main builds the candidates from the hard filters, the listed ones first, then the newest, capped at 500. The listed ids only order candidates; they never add a job that fails the filter.
- Step 14: "new" means no viewed mark, so every existing job is new until opened (the spec's rule). Opening a job marks it viewed; the detail lists every source with its open or closed state, and the description is shown as text.
- Step 14: the results list shows open jobs only and at most 200 of them (the existing cap); a narrower filter reaches the rest. Closed jobs are not listed, so the screen never opens one; the detail query still reads them.
- Step 14: the form applies on submit ("Apply filters"); an invalid value (number out of range, bad code) is refused with a message and the list is not read. The sort toggle applies at once.
- Step 14: saved searches can be created from the applied filters, applied to the form, replaced by the applied filters, and deleted. The UI has no rename; the API accepts a name on replace. The scheduler (step 19) will read them.
- Step 14: the bookmark action and the "hide applied" filter need `applications`, so they move to step 15.
- Step 14: not exercised: real postings and real scores (the fixture set is hand-written, 7 jobs); the screen in a browser for layout and keyboard order (jsdom only); the packaged app; the desktop E2E covers the window and engine start only.

- Step 15: tables `applications` (migration `0011_applications`) and `application_events` (`0012_application_events`), one migration each, with populated-fixture tests in `application-migrations.test.ts`. A bookmark is an application with status `bookmarked`; a job may have several applications, so `applications` has no unique key on `job_id`.
- Step 15: status moves (`core/applications`): bookmarked to preparing; preparing to ready or withdrawn; ready to preparing, applied or withdrawn; applied to interviewing, rejected or withdrawn; interviewing to offer, rejected or withdrawn. Offer, rejected and withdrawn end the application. Moving back from ready to preparing is the one backward step, kept so a prepared application can be reopened; the plan did not name it.
- Step 15: removing a bookmark deletes that bookmarked application and its events (no other status is removed). Bookmarking a job that already has any application changes nothing.
- Step 15: "start preparing" moves the job's open bookmark to preparing, or returns its open preparing application, so a bookmark is never duplicated. Only a new application goes through the duplicate guard as a new row.
- Step 15: the duplicate guard counts applications past `preparing` (ready, applied, interviewing, offer, rejected, withdrawn), which is spec #5's wording. Spec AC8 says "applied"; the guard follows #5 so a ready application also warns. Same job or same fingerprint: any age, two confirmations. Same company: `status_changed_at` within 90 days, one confirmation. Bookmarks and preparing applications never warn.
- Step 15: the confirmations are counted by the caller. `applications:start` takes `confirmations` (0 to 2) and is refused with the warning until it reaches the required number. The job detail asks for one click on a same-company warning and two clicks, with a second prompt, on a same-job warning. The engine cannot tell whether two clicks were real; that is the renderer's job.
- Step 15: `status_changed_at` is the clock of the 90-day window. Notes do not change it. A status change and its note are one event.
- Step 15: "hide applied" (`hideApplied`, default on, as spec #4 says) hides jobs with an application in `applied`, `interviewing`, `offer`, `rejected` or `withdrawn`. It is a hard filter, so applied jobs are not scored under the default filter. A ready or preparing application does not hide its job.
- Step 15: the job list and detail show the status of the job's latest application (by `status_changed_at`), so a bookmark shows as "Bookmarked" and a second preparation shows the newer status.
- Step 15: the SQLite proxy maps each result row by column name, so two selected columns with one name (`companies.id` and `applications.id` are both `id`) silently shift the values. The company id is read from `jobs.company_id` instead. Any new join must avoid duplicate column names in its select.
- Step 15: CSV export: main shows the native save dialog and writes the file (UTF-8 with a byte order mark, so Excel reads accents). Fixed columns: company, job title, status, status changed, created, job URL, apply URL, notes. Notes are joined with " | ", each prefixed by its time. The core CSV writer prefixes apostrophes to cells that start with = + - @, a tab or a carriage return, and quotes cells with commas, quotes or line breaks. The export reads applications only, so no settings or keys can reach it.
- Step 15: the board shows one column per status (only the chosen status when a status filter is set). Both views read the whole list, which is fine for one user. Notes are plain text, up to 2000 characters.
- Step 15: the in-memory bridge (web dev page, no engine) keeps applications in the page only, and its job list does not reflect status changes. It is a development aid, not a second store.
- Step 15: preparing does not open documents or the apply window; those are steps 16 and 17. `applications:start` only records the state.
- Step 15: not exercised: the CSV file opened in Excel or Numbers; the screens in a real browser for layout, phone width and keyboard order (jsdom tests only); the board with real data; the packaged app (the desktop E2E covers the window and engine start only); the duplicate guard on real postings from two sources.

- Step 16: the plan says the CV "references profile item ids", but profile items have no ids. The model refers to an item by its index in the profile list (`source`). The validator checks the item at that index: company, title, location, dates, institution, degree and field must equal the profile verbatim, and one profile item may appear once per list.
- Step 16: validator scope: a bullet may not add a number its source bullet lacks; the summary and cover letter paragraphs may not add a number the profile lacks; a skill name must be the profile's name or one of its aliases. Free prose is not checked beyond numbers, so an employer named in a sentence is not caught. Not an acceptance criterion gap for the structured fields, but a known limit of the prose.
- Step 16 (fix, its own commit): the text follows the posting's normalized language when it is `en` or `it`, else the UI language (`documentLanguageFor`, `core/documents/language`). Spec #6 asks for the posting's language. The prompts and document labels support only en and it, so a German or French posting falls back to the UI language; the panel shows the default and a selector overrides it. The choice is stored per document (`application_documents.language`, migration `0014_application_document_language`; earlier rows read as null and render in the UI language). Affinity explanations stay in the UI language.
- Step 16 (fix): the validator reads numbers in one spelling per value, so `1.000` and `1,000` are the same number and `3,5` equals `3.5`; the separators are the only difference between en and it. Employers, titles, dates, institutions, degrees and fields are compared verbatim in both languages, so a translated title fails. Number words ("tre") are not read.
- Step 16: one AI call per attempt; an answer that breaks a validator rule is sent back once with the rule paths and codes. A second broken answer is `invalid-output`, never stored. Provider failures keep their AI codes.
- Step 16: a cloud provider needs the CV import's consent, enforced in main. Only the profile's content fields (no contact details, links, application defaults or standard answers) and the posting's title, company and description are sent.
- Step 16: storage: table `application_documents`, one row per application and kind, with the editable JSON content and `exported_at`. An edit after the last export shows that the PDF is out of date. The PDF is written to `<userData>/applications/<application id>/<kind>.pdf`; the id is checked before it becomes a path.
- Step 16: PDF: the stored HTML is printed by a hidden Electron window with `printToPDF`. The window has no preload and no JavaScript, an in-memory partition, denied permissions and downloads, and loads only its own `data:` document. The rendered HTML is plain single-column markup (real headings and lists, no tables) for ATS reading.
- Step 16: the AI-written cover letter has no greeting or sign-off in its text; the template adds the greeting from main's i18n. The HTML is escaped; every value passes through `escapeHtml`.
- Step 16: edits are limited to the summary, bullet text and paragraph text. Employers, titles, dates, education and skills are read-only in the editor. A save runs the same validator as generation, so an edit cannot add a fact either.
- Step 16: document actions do not change the application's status. Moving `preparing` to `ready` stays a user move (the status screen); no automatic move on export.
- Step 16: the in-memory bridge (web dev page) reports the engine as unavailable for generation and export; it stores no documents.
- Step 16: `/verify` could not run: `origin/main` is not resolvable and fetching it is a GitHub call, which the step forbids. The same checks were run by hand: full unit suite, typecheck, lint, `pnpm format:check` and `pnpm test:e2e:desktop`, all green.
- Step 16: not exercised: real provider output quality (scripted doubles only); the exported PDF's layout and print output in a real window (no test renders a PDF); the packaged app; the panel in a real browser for keyboard order, focus and phone width (jsdom tests only); a generated document on a real job with a real profile.

- Step 17: the form opens in a visible window with an in-memory partition of its own (`job-finder-apply-<uuid>`), sandboxed, no preload, all permissions denied, `window.open` denied, subresources limited to http, https, data and blob. One form window at a time: starting again closes the previous one, and its cookies and storage are cleared on close.
- Step 17: downloads are allowed only within 5 seconds after a key press or mouse button in that window, so the OS save dialog asks where the file goes; otherwise they are blocked. This is how "downloads blocked except user-initiated" is read.
- Step 17: navigation is limited to web addresses, not to the posting's origin: an ATS may redirect, or host the form on another domain, and the page loader's same-origin rule would break that.
- Step 17: the DevTools session (`cdp.ts`) sends only an allow list: `Runtime.enable`, `Runtime.evaluate`, `DOM.enable`, `DOM.describeNode`, `DOM.setFileInputFiles`. There is no `Input` domain, so no key or click can be sent. Tests assert that no `Input` command is sent and that no page script calls click, submit or a key event.
- Step 17: the page scripts (`page-script.ts`) are plain JavaScript strings run with `Runtime.evaluate` in each same-process frame, and they reach open shadow roots. Out-of-process (cross-origin) iframes and closed shadow roots are not reached and not reported: a known limit.
- Step 17: file inputs are always reported, even when visually hidden, because ATS upload buttons hide them; other controls hidden by CSS are skipped. Honeypots (names like `honeypot` or `gotcha`, a "leave blank" label, a control pushed off-screen, or one inside a transparent ancestor) are skipped and never highlighted. Known limit: a real field inside a transparent fade-in container counts as a honeypot until it is visible.
- Step 17: a control that already holds a value is never overwritten, whether the user typed it or the URL prefilled it. A select whose first option holds a real value counts as chosen.
- Step 17: the ATS is decided from the window's final URL (after redirects) with `detectAts`; the page HTML is not read. An ATS embedded in a company page is treated as generic.
- Step 17: matching order: the ATS field name (Greenhouse `job_application[...]`, Lever `name`, `email`, `urls[...]`, Ashby `_systemfield_*`), then the autocomplete token, then a stored answer whose question equals the label after normalizing, then whole-label keywords in English and Italian. A label that only contains a keyword ("Company name") does not match.
- Step 17: deliberately not mapped: the current company (the profile has no "current job"), work authorization (needs per-country wording), checkboxes and radio groups (never ticked), and free-text questions without a stored answer. They are highlighted for the user; the AI fallback is step 18.
- Step 17: autofill works while an application is `preparing` or `ready` and never changes its status. "I submitted it" is the only move to `applied`; the panel enables it only when `ready`, because the status machine has no `preparing` to `applied` move. Closing the form window leaves the status as it was.
- Step 17: the CV and the cover letter are uploaded only when their PDF exists in `<userData>/applications/<id>/`. Otherwise the field is reported as not exported and highlighted; autofill does not export.
- Step 17: no new table and no new dependency. The bridge gains `autofill:start` only; the confirmation uses the existing `applications:update`.
- Step 17: the form panel shows the reason for each field left over (no profile field, no value, no matching choice, PDF not exported, control not supported, value refused).
- Step 17 tests: the page scripts run in jsdom on the fixture pages (`apps/desktop/src/main/autofill/fixtures/`, hand-written and modeled on the public markup of Greenhouse, Lever and Ashby, not recorded from live forms; nothing is fetched). The service test runs the real scripts and planner over a scripted window. The Electron E2E serves the same fixtures on loopback, seeds a ready application and a CV PDF, and checks in the real window the values, the uploaded file, the session (not persistent), that DevTools is attached, that the fixture received no submission, and that closing the window leaves the application ready. On the loopback host the ATS is generic, so the E2E does not cover the ATS rules.
- Step 17: not exercised: real Greenhouse, Lever and Ashby forms and their current markup; cross-origin iframes and closed shadow roots; the save dialog; how the highlight looks and keyboard order inside the form window; the E2E on Windows and Linux (run here on macOS only).

### Open questions

### Next
Step 18: Autofill AI fallback (AI maps form fields to profile keys and stored answers only, output constrained to known keys, page text treated as untrusted; drafted answers for free-text questions visibly marked as AI-drafted; the same never-submit guard as step 17).
