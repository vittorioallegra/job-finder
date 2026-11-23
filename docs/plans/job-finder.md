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
- [ ] 8. Normalization and ATS adapters
- [ ] 9. Ingestion pipeline vertical slice
- [ ] 10. Discovery A: web search and companies
- [ ] 11. Discovery B: Common Crawl and keyed providers
- [ ] 12. Generic careers page adapter
- [ ] 13. Matching and ranking
- [ ] 14. Search and filters UI
- [ ] 15. Application tracker
- [ ] 16. CV and cover letter
- [ ] 17. Autofill core and ATS adapters
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

### Open questions

### Next
Step 8: Normalization and ATS adapters (normalized job model and helpers: country codes, work mode, remote scope, employment type, seniority, salary, language, visa; identity keyed by (source, source_job_id) with a fingerprint for cross-source dedupe; adapters for Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Personio, Recruitee and Teamtailor against sanitized recorded fixtures; ATS detection from URL and page markers; `docs/adding-an-ats-adapter.md`).
