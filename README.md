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

## Privacy

The app runs locally. In this scaffold stage the renderer makes no network connections; outbound
connections (job sources, AI providers, update checks) will be listed here as they are added.

## Documentation

- Specification: `docs/specs/job-finder.md`
- Implementation plan: `docs/plans/job-finder.md`

## License

MIT. See `LICENSE`.
