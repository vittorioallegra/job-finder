# job-finder: working notes for Claude

Native desktop app (Electron 45 + React 19), pnpm workspace. Full plan: `docs/plans/job-finder.md`; spec: `docs/specs/job-finder.md`.

## Commands

- Install: `pnpm setup` (runs `pnpm install`)
- Dev web renderer only: `pnpm dev` (Vite on http://localhost:5173)
- Dev desktop app: `pnpm desktop:dev`
- Build desktop: `pnpm desktop:build` (output in `apps/desktop/out`)
- Typecheck: `pnpm typecheck` (uses TypeScript 7 via `node node_modules/typescript7/bin/tsc`; tooling uses TypeScript 6)
- Lint: `pnpm lint` (ESLint 10 flat config, `eslint.config.mjs`)
- Format: `pnpm format` / check only: `pnpm format:check`
- Unit tests: `pnpm test` (Vitest projects: core, web, desktop, repo)
- One test file, failures only: `pnpm exec vitest run --reporter=dot apps/web/src/lib/i18n/i18n.test.ts`
- One test project: `pnpm exec vitest run --project desktop --reporter=dot`
- Electron E2E: `pnpm test:e2e:desktop` (builds first, then runs Playwright against `apps/desktop/out`)
- Everything: `pnpm verify`

## Folder map

- `apps/desktop/` Electron shell: `src/main` (window, protocol, logging, security, i18n), `src/preload`, `e2e/` (Playwright), `electron.vite.config.ts`
- `apps/web/` React renderer: `src/app` (router, shell), `src/features/<name>` (screens), `src/lib/i18n` (en.json, it.json), `src/styles.css` (tokens)
- `packages/core/` pure TypeScript domain logic, no Electron or React imports
- `packages/bridge/` typed contract between preload and renderer
- `tests/repo/` repository-level conventions tests
- `docs/` specs, plans; `scripts/` repo tooling

## Conventions

- Everything in the repo is English: code, comments, tests, commits, docs. Only user-facing strings are translated, through i18n keys present in both `en.json` and `it.json` (desktop main: `apps/desktop/src/main/i18n`; renderer: `apps/web/src/lib/i18n`). Key-parity tests enforce this.
- Every test file starts with the card: `// protects=...; fails_when=...; no_claim=...`. The repo test enforces it.
- Renderer never goes online: CSP is set in the main process (`src/main/security/csp.ts`). Renderer reaches the OS only through `window.jobFinder` (preload).
- Protocol: the renderer loads from `app://renderer/`, served only through `resolveAppRequest` (path-traversal guard).
- Electron main/preload build as CommonJS (no `"type": "module"` in `apps/desktop`); the preload runs in the sandbox, so it may import only `electron` and types.
- Import boundaries are enforced by ESLint: `core` and `bridge` never import apps or Electron; only `apps/desktop` imports Electron; `apps/web` never imports desktop.
- Tooling-only dependencies stay at the root; app dependencies live in the app's own `package.json`.
- Commit messages use Conventional Commits (`chore:`, `docs:`, `feat:`), no attribution lines.
