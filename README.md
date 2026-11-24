# Job Finder

An open-source, local desktop app for macOS, Windows and Linux. It finds job openings on
company careers pages and ATS job boards, ranks them against your profile, tracks your
applications with a duplicate guard, and prepares each application (a tailored CV, a cover
letter and a filled-in form) for you to review. It never submits an application for you.

## Install

Installers are attached to the project's GitHub Releases page. Download the one for your
system:

- macOS: `job-finder-<version>-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel)
- Windows: `job-finder-<version>-x64.exe`
- Linux: `job-finder-<version>-x64.AppImage` or `-x64.deb`

The installers are not signed or notarized, so the system warns the first time you open
them. `docs/release.md` explains how to open them on each system. Check the release notes
before you install.

To run from source instead you need Node.js 26 and pnpm 12 (see `packageManager` in
`package.json`):

```sh
pnpm setup          # install dependencies
pnpm desktop:dev    # run the desktop app in development
pnpm desktop:dist   # package an installer for this system (apps/desktop/dist)
```

## First launch

1. The app opens onboarding. Enter your profile (contact details, experience, education,
   skills and languages), or import a CV: the text is read on your machine and one AI call
   extracts a draft. Nothing is saved until you press save.
2. Open Settings and choose an AI provider (see below). Test the connection there.
3. On the Companies screen, search for job boards, or add a company by its careers URL.
   The app scans each company's board and keeps its postings.
4. On the Jobs screen, open a posting. Bookmark it or prepare it: the app creates an
   application and you can generate a tailored CV and cover letter.
5. Open the form from the application. The app fills what your profile covers in a separate
   window and highlights the rest. You review it and press submit yourself. The app never
   presses submit. Then mark the application as applied.

Your data (the database, the documents and the logs) stays in the app's user data folder.

## AI providers

The app uses an AI model for four things: scoring jobs against your profile, importing a CV,
writing tailored documents, and (only when you turn it on for a form) mapping form fields the
rules could not map. Choose one provider in Settings:

- **Anthropic** (`anthropic`): needs an API key from your Anthropic account and a model name.
  This is a cloud service and you pay for its use.
- **OpenAI** (`openai`): needs an API key from your OpenAI account and a model name. Also a cloud
  service that you pay for.
- **Google Gemini**: create a key in Google AI Studio (`https://aistudio.google.com`) and set the
  model name it shows (it starts with `gemini-`). The app fills in Gemini's address; it is saved
  as the OpenAI-compatible provider. On the free tier Google may use what you send to improve
  its models.
- **OpenAI-compatible** (`openai-compatible`): any server with the OpenAI chat API. Set its base
  URL, for example a local Ollama server (below). A key is optional.

A provider on your own machine (`localhost`, `127.0.0.1`, `::1` or `*.localhost`) needs no
consent. Any other address is treated as a cloud provider: the app then asks for your consent
before it sends your CV, your profile or a job to it, and it does not send them until you say
yes. The AI is never called from the interface itself; it runs in a separate process of the app.

For every provider the **Model** menu lists the provider's own models: for Anthropic, OpenAI
and Gemini save the key first, then pick the model. When a list cannot be read, the model name
can be typed instead.

Each provider keeps its own key, so you can switch between them without typing a key again, and
a key saved for one provider is never sent to another. Ollama needs no key. The OpenAI-compatible
key goes only to the server saved in Settings. **Test connection** saves your changes first,
then tries the provider; a failure names the provider's HTTP status and error code.

### Ollama (free, local)

1. Install Ollama from `https://ollama.com` and open it.
2. Download a model in the terminal, for example `ollama pull qwen3:8b`. Use a model that
   follows instructions and handles JSON well; larger models give better results.
3. In Settings (or the first setup step) choose **Ollama (on this computer)**. The address is
   filled in, the model menu lists the models you have installed, and no key is asked for.
   If Ollama is not running, or has no models yet, the screen says what to do.
4. Save, then test the connection. Ollama runs on your machine, so no data leaves it.

The app talks to Ollama through Ollama's own API and sends the context size with every request,
so Ollama's own context setting does not limit it. Pick it with the **Longest text per request**
slider in Settings: 32k (the default) fits every request the app sends, including long careers
pages; more only takes more memory, and the slider ends at the chosen model's limit.

## Search keys (free tier)

Job discovery works without any key: DuckDuckGo's HTML search and Common Crawl's URL index
are used. DuckDuckGo can refuse automated requests; the app then reports that the search was
blocked and never tries to get around it. For more reliable results, add a key for one of the
keyed search providers:

- Brave Search, Tavily or Serper. Each offers a free tier with a key. Check the provider's
  current limits before you rely on them.

Turn the provider's toggle on in Settings and save its key. Keys are kept in the operating
system's keychain (on Linux without a keyring, only after you opt in in Settings). A key is
sent only to the provider it belongs to. It is never shown in the interface or written to logs.

## Privacy

The app has no account, no telemetry and no server of its own. Your profile, applications,
documents and logs are stored on your computer. This is the complete list of outbound
connections the app makes. Each one is started by a feature you use, except the update check,
which you can turn off in Settings.

Every request to a job source, search provider or update endpoint first reads that host's
`robots.txt`. All of these requests use the user agent `Mozilla/5.0 (compatible; job-finder)`
and nothing that identifies you.

**Job discovery (keyless, on by default)**

- `html.duckduckgo.com`: web search for ATS boards. Sends the keywords and locations you search
  for. Only when the DuckDuckGo toggle is on (it is on by default).
- `index.commoncrawl.org`: Common Crawl's URL index, read for each ATS domain. Sends the domain
  names only, not your keywords. Always used by discovery.

**Keyed search providers (only when their toggle is on and a key is saved)**

- `api.search.brave.com`, `api.tavily.com` and `google.serper.dev`: the search query, with your
  key, to that provider only.

**Job sources (for the companies you add)**

- ATS public job-board APIs: `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com`,
  `apply.workable.com`, `api.smartrecruiters.com`, `jobs.smartrecruiters.com`,
  `<company>.jobs.personio.de`, `<company>.recruitee.com`, `<company>.teamtailor.com`. The
  company's board token (taken from its careers URL) is in the request path.
- Careers pages you add, on any host. When a page is empty in its HTML, it is rendered in a
  hidden window (below). A generic careers page may link to posting pages one hop away, on the
  same careers host only.

**JavaScript pages (hidden loader)**

- A careers or posting page that needs JavaScript is rendered in a hidden, sandboxed window.
  That page can load its own scripts, styles, images and fonts from any `http` or `https` host,
  as the page asks. Its navigation is limited to the page's own origin, and it has no
  permissions and no downloads.

**Application forms (apply window)**

- The job's apply link opens in its own window, in a memory-only session with no permissions.
  The form page and the resources it loads (scripts, styles, images, fonts, and any third-party
  services the form uses) are fetched from their hosts as the page asks. The app fills the fields
  and never submits the form. Submitting is always your own action in that window.

**AI providers (only the one you configure)**

- The provider you choose in Settings: `api.anthropic.com` or `api.openai.com` by default, or the
  base URL you set for an OpenAI-compatible server. A local server (Ollama) stays on your
  machine. A cloud provider receives only what a feature sends: the CV text you import, your
  profile, the postings being scored or drafted, the form fields for the AI autofill fallback,
  and the text of public careers pages that the AI reads. Consent is required for the CV
  import, scoring, documents and the form AI fallback when the provider is in the cloud.
  Careers-page text is sent without a separate consent prompt.
- The connection test sends one fixed short request.

**Update check (on by default, off in Settings)**

- `api.github.com`: the latest release of the project's repository, asked once at start and then
  once a day. It sends no data about you. Until the repository is set in the code, no request
  is made at all.
- `github.com`: opened in your browser only when you choose the update notice.

**Opened in your browser (only on your click)**

- A job or company link you open from the app, and the release page. The app opens them with
  your system's browser.

**Not network traffic**

- The interface cannot reach the network itself: its content security policy allows connections
  to the app only.
- The database, your keys (in the keychain), the logs, the generated PDFs and the desktop
  notifications, tray and launch-at-login setting stay on your computer.

**Local network**

- The app refuses to fetch `localhost`, loopback, link-local and private-network addresses, also
  when a page redirects there. Known limit: a public name that resolves to a private address
  (DNS rebinding) is not caught, because the app does not resolve names itself.

**What the app does not control**

- The Chromium engine inside Electron may make its own background connections that the app does
  not expose. The app does not turn them off, and this list does not cover them.

## Documentation

- Specification: `docs/specs/job-finder.md`
- Implementation plan: `docs/plans/job-finder.md`
- Live smoke test (manual, with real services): `docs/live-smoke-test.md`
- Adding an ATS adapter: `docs/adding-an-ats-adapter.md`
- Releases and installers: `docs/release.md`

## Development

For day-to-day commands and the code map, see `CLAUDE.md`. `pnpm verify` runs the typecheck,
lint, format check, unit tests and the Electron end-to-end journey. The end-to-end journey never
reaches the network: it uses a local fixture server and replayed AI answers.

## License

MIT. See `LICENSE`.
