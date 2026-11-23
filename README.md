# Job Finder

An open-source, local desktop app for macOS, Windows and Linux that finds job openings on
company careers pages and ATS boards, ranks them against your profile, tracks applications,
and prepares each application for you to review. It never submits an application for you.

Status: early development. The workspace scaffold is in place; features arrive in later steps
of `docs/plans/job-finder.md`.

## Requirements

- Node.js 26 and pnpm 12 (see `packageManager` in `package.json`)

## Getting started

```sh
pnpm setup          # install dependencies
pnpm desktop:dev    # run the desktop app in development
pnpm verify         # typecheck, lint, format check, unit tests and Electron E2E
```

For day-to-day commands, see `CLAUDE.md`.

## Finding companies

The Companies screen searches for job boards. Three sources feed it:

- Common Crawl's URL index (keyless) lists boards on the ATS domains. It is not filtered by your keywords.
- DuckDuckGo's HTML search (keyless) is best-effort: it can refuse automated requests, and the app
  never tries to get past such a refusal.
- Brave Search, Tavily and Serper are keyed. They are used only when their toggle is on in Settings
  and a key is saved there.

For reliable results, add a free-tier key for one of the keyed providers in Settings. Keys are kept
in the operating system's keychain (or, on Linux without a keyring, only after you opt in in
Settings), are sent only to the provider they belong to, and are never shown in the interface or
written to logs.

## Privacy

The app runs locally. Outbound connections are made only for the features you use: job sources
(ATS APIs and careers pages), AI providers you configure, the discovery sources above (Common
Crawl, DuckDuckGo, and a keyed provider only when you saved its key) and the update check, which
you can turn off in Settings.

## Documentation

- Specification: `docs/specs/job-finder.md`
- Implementation plan: `docs/plans/job-finder.md`

## License

MIT. See `LICENSE`.
