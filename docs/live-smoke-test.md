# Live smoke test

A manual pass through the app with real services, to check what the automated journey cannot:
real AI answers, real job boards, a real application form and the operating system's own
windows. It is not run in CI and it makes live calls, so it is run by a person before a release.

The automated journey (`apps/desktop/e2e/journey.spec.ts`) covers the same steps against a local
fixture server and hand-made AI answers. Use this document for the parts it cannot see.

## What you need

- The app built from the commit to test: `pnpm desktop:dev`, or an installer from the draft
  release.
- An AI provider: a local Ollama with a model pulled, or an API key for Anthropic or OpenAI. Use
  a key with a spend limit. Never paste a key into this document, an issue or a commit.
- Optionally, a free-tier key for Brave Search, Tavily or Serper.
- A scratch profile. Use a CV that is not your real one if you are testing on a shared machine.

## Steps

Record the result of each step: pass, or the exact message and screenshot.

1. **Install and first launch.** Open the app. The onboarding screen appears. Start a fresh
   user data folder if the app was used before.
2. **Profile.** Enter a profile, or import a CV. The draft appears for review and nothing is
   saved until you press save. Restart the app and check the profile is still there.
3. **AI provider.** In Settings, set the provider and model. Press Test. Expect a success message.
   Then turn the connection off (wrong base URL) and check the screen shows "AI unavailable" with
   the reason, not a stack trace.
4. **Search.** On Companies, search for a role. Expect boards from DuckDuckGo and Common Crawl. If
   DuckDuckGo refuses, expect a "search blocked" notice and no retry loop.
5. **Keyed search (optional).** Turn one keyed provider on, save its key, search again. Check that
   its results are added and that the key does not appear anywhere in the interface.
6. **Scan.** Add a company with a real careers URL (a Greenhouse, Lever or Ashby board). Start a
   scan. Expect postings, a log with the company's result, and no failed company in the log.
7. **Open a job.** Open a posting from the Jobs screen. Check the description, the source links and
   the apply link.
8. **Prepare.** Prepare the job. Generate a tailored CV and a cover letter. Read both: every
   employer, title, date and degree must match your profile. Export both as PDF and open each one.
9. **Autofill.** Open the form from the application. Check the fields are filled, the unfilled ones
   are highlighted, and the window starts no download unless you click one. Do not press submit.
10. **Mark applied.** Mark the application as applied. Close the form window and check the status
    stays applied.
11. **Duplicate guard.** Prepare the same job again. Expect the duplicate warning, and that it
    needs two confirmations.
12. **Notifications and tray (macOS, Windows, Linux).** Turn on a saved search with a short
    interval, run it, and check a desktop notification appears for new matches. Click it and check
    the results open with the filter. Check the tray menu has Open, Search now and Quit.
13. **Close prompt.** Close the window with the close behaviour set to ask. Check the prompt offers
    keep running, quit and cancel, and that "remember" changes the setting.
14. **Update check.** Only once the repository is set (see `docs/release.md`). Check the banner
    appears for a newer published release and that it opens the release page in your browser.
    Without a set repository, no request is made; check the network log shows none.
15. **Privacy spot check.** While steps 4 to 6 run, watch the network (for example, a proxy or
    Little Snitch). The hosts should be the ones listed in the README's privacy section, and
    nothing else from the app itself.

## Recording

Write the result in the release notes or in a note on the release issue: the commit, the platform,
the AI provider and model, the steps that failed, and the time taken. Do not include keys, CV text
or profile details.
