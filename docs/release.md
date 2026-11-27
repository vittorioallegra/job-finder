# Release

Installers are built by `.github/workflows/desktop.yml` and attached to a **draft** GitHub
Release. Nothing is published automatically: a person reviews the draft and publishes it.

## What gets built

| Platform | Installers                                                                       | Built on         |
| -------- | -------------------------------------------------------------------------------- | ---------------- |
| macOS    | `job-finder-<version>-arm64.dmg`, `job-finder-<version>-x64.dmg` (ad-hoc signed) | `macos-latest`   |
| Windows  | `job-finder-<version>-x64.exe` (NSIS installer)                                  | `windows-latest` |
| Linux    | `job-finder-<version>-x64.AppImage`, `job-finder-<version>-x64.deb`              | `ubuntu-latest`  |

Every build runs the packaged-app smoke test before its installers are collected: the window
opens, the engine reports `engine ready`, migrations are applied from `resources/drizzle`, and the
main process reads the migrations table with `node:sqlite`.

## Build locally

```sh
pnpm install --frozen-lockfile
pnpm desktop:dist                       # builds the targets for the current OS only
JOB_FINDER_PACKAGED_APP="<path to packaged executable>" \
  pnpm --filter @job-finder/desktop test:e2e:packaged
```

Output goes to `apps/desktop/dist/` (ignored by git). The unpacked app is in
`apps/desktop/dist/<platform>-unpacked/`, for example
`apps/desktop/dist/mac-arm64/Job Finder.app/Contents/MacOS/Job Finder`.

The smoke test runs a copy of the packaged app with the Node inspector fuse turned on, because
Playwright attaches through the inspector. The shipped installers keep that fuse off.

The Linux `.deb` needs a project homepage and a maintainer, which electron-builder reads from
`homepage` and `author` in `apps/desktop/package.json` (the author uses the GitHub noreply address,
not a personal one). Without them the Linux build job fails.

## Cut a release

0. The update check reads releases from `RELEASES_REPOSITORY` in
   `packages/core/src/updates/release.ts` (`vittorioallegra/job-finder`). Change it if the
   repository moves; `null` turns the check off.
1. Set `version` in `apps/desktop/package.json` (for example `0.2.0`) and merge it to `main`.
2. Tag the commit `v<version>` and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow stops early if the tag does not equal the `package.json` version.
4. When the three build jobs pass, the `release` job creates a draft release titled
   `Job Finder <version>` with the installers and notes from `scripts/release-notes.mjs`
   (Conventional Commit subjects since the previous `v*` tag).
5. Review the draft, edit the notes if needed, and publish it.

To test the pipeline without a release, run the workflow manually (Actions, Desktop release,
Run workflow). It builds, smoke-tests and uploads the installers as run artifacts only.

## Opening unsigned apps

The installers are not signed with a Developer ID certificate and are not notarized. The operating
system warns the first time you open them.

**macOS.** The app is ad-hoc signed. Open the DMG, drag Job Finder to Applications, then:

- Control-click (right-click) Job Finder and choose Open, then Open again; or
- open System Settings, Privacy & Security, and choose Open Anyway next to the Job Finder message; or
- run `xattr -dr com.apple.quarantine "/Applications/Job Finder.app"` in Terminal.

The app does not use the keychain for API keys, so a new release never asks for keychain access.

**Windows.** SmartScreen shows "Windows protected your PC". Choose More info, then Run anyway.

**Linux.** Make the AppImage executable (`chmod +x job-finder-<version>-x64.AppImage`) and run it,
or install the package with `sudo apt install ./job-finder-<version>-x64.deb`.

Only download installers from the project's GitHub Releases page, and check the release notes.

## Not covered yet

- Code signing, notarization and an auto-updater. The app shows a "new version available" notice
  from the release check and opens the release page; it never downloads or installs an update.
- The packaged smoke test does not exercise the installers themselves, only the unpacked app they
  contain.
