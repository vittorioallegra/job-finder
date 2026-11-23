# Contributing

Thanks for your interest in job-finder.

## Ground rules

- Everything in the repository is in English: code, identifiers, comments, tests, commit
  messages, documentation. User-facing text goes through i18n keys present in both `en.json`
  and `it.json`.
- Every test file starts with the card comment `// protects=...; fails_when=...; no_claim=...`.
- Keep commits atomic and use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Before opening a pull request run `pnpm verify`.

## Workflow

1. Read `CLAUDE.md` for commands and folder conventions.
2. Read the spec and plan in `docs/` before changing behavior.
3. Update `CLAUDE.md` in the same change when commands, folders or conventions change.

## Reporting issues

Open a GitHub issue with the app version, operating system, steps to reproduce, and the relevant
lines of the log file (`userData/logs/main.log`). Remove API keys and personal data before sharing.
