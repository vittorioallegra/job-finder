---
title: job-finder — local job search, application tracking and assisted applying
status: confirmed
date: 2026-11-23
---

# job-finder — local job search, application tracking and assisted applying

## Context

Job seekers waste hours across dozens of portals. Many openings never reach the big
aggregators: companies often publish only on their own careers page or ATS (applicant
tracking system: Greenhouse, Lever, Ashby, Workable, Personio, ...), because paid
postings on LinkedIn-style boards cost money. Postings are also inconsistent (unclear
work mode, missing salary, vague location), and people lose track of where they
already applied.

job-finder is an **open-source app that each person runs locally on their own
computer**. It discovers openings across the web (with a focus on company careers
pages and ATS boards), normalizes them, filters and ranks them against the user's
profile, tracks applications so nobody applies twice, and prepares each application
(tailored CV, cover letter, auto-filled form) for the user to review and submit.

Who is affected: any individual job seeker, in any country and any field. There is no
hosted service, no account, and no shared backend: every install is single-user.

## Current State

Greenfield. The repository contains only an empty initial commit (`08b4fe9`,
verified 2026-11-23). No code, no dependencies.

## Goals

1. Find openings that are **not** on the big aggregators, from company careers pages
   and ATS boards, for any role in any country.
2. One place to search, filter, rank and track, instead of N portals.
3. Never apply twice to the same opening by accident.
4. Cut the time per application to a review: tailored CV + cover letter + pre-filled
   form, submitted by the user.

## Non-negotiable constraints

- **Local only.** All user data (profile, CVs, jobs, applications) lives on the user's
  machine. The only outbound traffic is: job sources, web search, the configured AI
  provider, the browser session the user drives, and the update check against GitHub
  Releases (on by default, can be turned off in settings).
- **No extra software to install** beyond the app itself and its runtime. No Docker,
  no separate database server. A local browser engine downloaded by the app's own
  install step is acceptable.
- **Free by default.** The app must be fully usable with zero paid keys: keyless
  search sources plus a local AI model. Paid providers are optional.
- **The app never submits an application.** It fills, the user reviews, edits and
  clicks submit.
- **No LinkedIn, no Indeed.** No scraping, no import. They are out of scope entirely.
- **Market-neutral.** No hardcoded country, language, field or seniority.
- **Repository in English.** User-facing UI strings go through an i18n mechanism with
  English as the base language; Italian is the first translation.

## Proposed Change

### Feature map (epic)

```
#1 Profile & settings ──┬─> #3 Matching & ranking ──┐
                        │                            ├─> #6 Application prep & autofill
#2 Discovery & ingestion ┴─> #4 Jobs list ────┤
                                                     └─> #5 Application tracker
#7 Scheduler & notifications (needs #2, #4)
```

Sequencing rationale: the profile (#1) and a normalized job store (#2) are inputs to
everything else. Ranking (#3) needs both. Tracking (#5) must exist before prep (#6),
because prep writes the application record and the duplicate guard reads it. The
scheduler (#7) only re-runs the profile's search, so it comes last.

### #1 Profile & settings

- **Onboarding from a CV.** The user uploads a CV (PDF, DOCX, or plain text). The AI
  extracts a structured profile: contact details, headline, summary, work experience
  (company, title, dates, location, bullet points), education, skills (with level when
  stated), languages (with level), certifications, links (GitHub, portfolio,
  LinkedIn URL as plain text only).
- The user reviews and edits every extracted field before saving. The profile is the
  single source of truth for CV generation and form filling; nothing is invented
  beyond it.
- **Application defaults** stored with the profile, used for form filling: work
  authorization per country, notice period, salary expectation (amount, currency,
  period), willingness to relocate, preferred pronouns (optional), and standard
  answers the user writes once (e.g. "Why do you want to work here?" template).
- **Settings:** AI provider (Anthropic, OpenAI, or any OpenAI-compatible endpoint such
  as Ollama or LM Studio) with model name and key or base URL; search providers
  enabled and their keys (optional); UI language; notification on/off; scheduler
  interval.
- Secrets (API keys) are stored locally and never written to logs or exports.

### #2 Discovery & ingestion

Discovery finds **companies and postings**; ingestion reads postings into a single
normalized format.

**Discovery sources (all pluggable behind one source interface):**

| Source | Key needed | What it yields |
|---|---|---|
| Web search via DuckDuckGo (keyless) | No | Postings and careers pages matching a query, incl. queries restricted to ATS domains |
| Common Crawl URL index (keyless) | No | Company slugs on ATS domains (e.g. every `jobs.lever.co/<company>`), seeding the company list |
| Brave Search API / Tavily / Serper | Optional | Same as web search, more stable; used only if the user adds a key |
| Manual company entry | No | The user adds a company name or careers URL |

- Every discovered company is stored with its careers URL and detected ATS, so later
  scans read it directly without searching again. The company list grows over time.
- Search queries are built from the profile's preferences (role keywords, location,
  work mode) and combined with ATS domains, e.g.
  `"backend engineer" Milan site:jobs.lever.co`.

**Ingestion adapters:**

- **ATS adapters** read public, unauthenticated job APIs: Greenhouse, Lever, Ashby,
  Workable, SmartRecruiters, Personio, Recruitee, Teamtailor. Structured data, no AI.
- **Generic careers page adapter** for anything else: fetches the page and uses the AI
  to extract postings into the normalized format. Falls back to a headless browser only
  when the page needs JavaScript to render.
- **ATS detection:** given a careers URL, detect which ATS powers it (URL patterns and
  page markers) and route to the right adapter.
- **Politeness:** honor `robots.txt`, at most 1 request/second per host, identify with a
  generic user agent, cache responses, back off on HTTP 429/5xx.

**Normalized job (conceptual model):**

| Field | Notes |
|---|---|
| id | stable internal id |
| source, source_job_id, url, apply_url | provenance |
| company (id, name, website, careers_url, ats) | linked company record |
| title, description (text), language | |
| locations[] (city, region, country) | free text normalized to country code where possible |
| work_mode | remote / hybrid / onsite / unknown |
| remote_scope | e.g. "EU only", "worldwide", "US time zones" when stated |
| employment_type | full_time / part_time / contract / freelance / internship / temporary / unknown |
| seniority | intern / junior / mid / senior / lead / unknown (stated or inferred) |
| salary (min, max, currency, period) | only when stated |
| visa_sponsorship | yes / no / unknown |
| posted_at, first_seen_at, last_seen_at, closed_at | `closed_at` set when it disappears from its source |
| fingerprint | hash of normalized company + title + location, for cross-source dedupe |

- **Cross-source dedupe:** the same opening seen on two sources (e.g. a job board and
  the company's ATS) is stored once, keeping all source URLs and preferring the ATS one
  as `apply_url`.
- Postings that disappear from their source are marked closed, not deleted.

### #3 Matching & ranking

- Each job that passes the hard filters gets an **affinity score 0–100** and a 1–2
  sentence explanation (e.g. "Strong Go/Kubernetes match; asks for 5+ years, you have
  3"), computed by the AI from the profile and the job.
- Scores are cached per (job, profile version) and recomputed only when either
  changes.
- Results are **sorted by affinity by default**; the user can switch to newest first.

### #4 Jobs list

The list shows the jobs that match the profile's preferences, with no filter form:

- roles: the title names one of them
- places: countries, areas (EU, Europe) and cities; remote jobs must be open to where the
  person lives; a country or area also needs the company to be based there ("Italy" means
  Italian companies, a company's country being where most of its open jobs are)
- work mode: remote / hybrid / onsite
- employment type: employee / freelance / internship
- application status: applied jobs and dismissed jobs are hidden

Each job can be opened (full description, all source links), **dismissed** (hidden from
future results), or **bookmarked**.

### #5 Application tracker

- An application record links a job to a status:
  `bookmarked → preparing → ready → applied → accepted | rejected`,
  with timestamps, notes, and the exact CV and cover letter files used.
- **Duplicate guard:** before preparing an application, the app warns when
  (a) the same job (same id or same fingerprint) already has an application past
  `preparing`, or (b) the same company has an application in the last 90 days, showing
  the earlier one. The user can override (b) but not (a) without confirming twice.
- The tracker is one list filterable by status and company; the statuses before submitting show as one "to send" group.
- Export of applications to CSV.

### #6 Application prep & autofill

1. **Tailored CV.** From the profile and the job, the AI selects and rewrites the most
   relevant experience and skills (reordering, rephrasing, emphasizing), in the
   posting's language. It never invents employers, titles, dates, degrees or skills.
   Output: a PDF from a clean, ATS-readable template, plus the editable source so the
   user can tweak it before export.
2. **Cover letter**, same rules, editable, exportable to PDF.
3. **Autofill.** The app opens the job's application form in a **visible browser
   window** and fills it:
   - **ATS form adapters** for Greenhouse, Lever and Ashby: deterministic field mapping
     from profile and defaults, CV and cover letter uploaded.
   - **AI fallback** for any other form: the AI reads the form fields and maps them to
     profile data and stored answers; free-text questions get a drafted answer.
   - Fields the app could not fill confidently are highlighted for the user.
   - The app **never clicks submit**. The user reviews, edits, submits.
4. After the user confirms "I submitted it", the application moves to `applied`. If the
   user closes the window without confirming, it stays `ready`.
5. CAPTCHAs, logins and account creation on employer sites are always left to the user.

### #7 Scheduler & notifications

- The profile's search runs on a schedule (default every 24 h, configurable 1–168 h) while the
  app is running. Missed runs (app was closed) run once at the next start.
- A run that finds jobs not seen before sends **one desktop notification** per run
  summarizing new matches ("7 new jobs for 'Backend Milan', top match 88"). Clicking it
  opens the results filtered to the new jobs.
- New jobs are marked "new" until viewed.

## Acceptance Criteria

1. Uploading a sample CV produces a profile where every work experience, education
   entry and skill present in the CV appears in the editable form (verified against 3
   fixture CVs: PDF, DOCX, TXT, in 2 languages).
2. With no paid keys and a local OpenAI-compatible model configured, the profile's search
   completes end-to-end: discovery, ingestion, filtering and ranking return at least
   one job (live smoke test, documented in README).
3. Each of the 8 ATS adapters parses a recorded fixture response into normalized jobs
   with title, company, location, work mode and apply URL populated.
4. ATS detection identifies the ATS for 16 fixture careers URLs (2 per ATS) with 100%
   accuracy, and returns "unknown" for 3 non-ATS URLs.
5. The same posting ingested from two sources is stored once (fingerprint dedupe test).
6. Each condition in #4 includes and excludes the expected jobs on a fixed fixture set.
7. Results are sorted by affinity descending by default; every ranked job shows a score
   and explanation.
8. Preparing an application for a job already `applied` shows a warning with the earlier
   application and proceeds only after two explicit confirmations; same company within
   90 days shows a warning that can be overridden with one confirmation.
9. The tailored CV contains no employer, title, date, degree or skill absent from the
   profile (automated check on 5 fixture job/profile pairs).
10. On recorded Greenhouse, Lever and Ashby form fixtures, autofill fills name, email,
    phone, CV upload and all required fields that map to profile data; the submit
    button is never clicked (asserted in test).
11. On a generic fixture form, AI fallback fills mapped fields and highlights the rest.
12. A scheduled run with new jobs sends exactly one desktop notification; a run with no
    new jobs sends none.
13. Postings missing from their source on a later scan get `closed_at` set and stop
    appearing in default results.
14. No request exceeds 1 req/s per host; `robots.txt` disallow rules are honored
    (unit test on the rate limiter and robots checker).
15. All UI strings come from i18n resource files; English and Italian are complete.
16. API keys never appear in logs or in the CSV export (test greps both).
17. Each test in the Testing Plan states its card:
    `protects=<observable it protects>; fails_when=<wrong result it rejects>; no_claim=<what green does not prove>`.

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | ATS adapters on recorded fixtures (8 ATS) | +16 |
| Unit | ATS detection, fingerprint dedupe, normalization (locations, work mode, employment type, salary) | +20 |
| Unit | List conditions (one per condition + combinations) | +16 |
| Unit | Duplicate guard rules, application status transitions | +8 |
| Unit | Rate limiter, robots.txt, secret redaction | +6 |
| Integration | CV upload → profile extraction (AI mocked with recorded responses) | +3 |
| Integration | Profile search → discovery → ingestion → ranking (sources mocked) | +2 |
| Integration | Tailored CV generation + "no invented facts" check | +5 |
| Integration | Autofill on Greenhouse/Lever/Ashby/generic form fixtures in a real headless browser | +4 |
| Integration | Scheduler run → notification (notifier mocked) | +2 |
| E2E | Onboard → search → open job → prepare → autofill → mark applied → duplicate blocked | +1 |
| Smoke (manual, documented) | Live run against real sources with a local model | 1 |

AI calls in automated tests use recorded responses; live AI quality is covered only by
the documented smoke test.

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test:
   the observable it protects, the wrong result it rejects, and what green does not
   prove. Never "make the tests pass".
2. Real code and real tests land in the same change; a placeholder, a stub assertion or
   a test deferred to a follow-up is not done.
3. Any change to a test, validator, CI step, timeout, tolerance, threshold, snapshot or
   suppression pragma is reported on its own line in your summary with its
   justification, before any other result.
4. A reported command names the command and its observed result (exit status, counts,
   the failing line); a command you did not run is not reported, and stderr is never
   silenced in a command you cite.
5. Your report is a claim until the parent re-executes it: say what you verified, what
   you reused, and what you could not check.

## Failure modes

| Failure | Behavior |
|---|---|
| Source down / 429 / layout changed | Source marked failing for this run, others continue; error shown in a run log |
| DuckDuckGo blocks keyless queries | Run continues with other sources; UI suggests adding a free-tier key |
| AI provider unreachable or invalid key | Search still works with filters only (no score); prep is disabled with a clear message |
| Local model returns malformed JSON | Retry once with a repair prompt, then skip that item and log it |
| AI extraction from careers page finds nothing | Company kept, marked "no parseable jobs"; retried next run |
| Form layout differs from ATS adapter | Fall back to AI form filling; unfilled fields highlighted |
| Duplicate posting with different titles | Not merged (fingerprint differs); both shown; acceptable |

## Rollback Plan

Local single-user app: a bad release is rolled back by reinstalling the previous
version. The local database must carry a schema version and migrations run forward
only, with an automatic backup copy of the database file before each migration.

## Effort Estimate

| Component | Human | CC |
|---|---|---|
| #1 Profile & settings (CV parse, profile editor, AI provider layer) | 4 d | 2 h |
| #2 Discovery & ingestion (2 keyless sources, 3 keyed, 8 ATS, generic, dedupe) | 8 d | 5 h |
| #3 Matching & ranking | 1.5 d | 1 h |
| #4 Jobs list | 3 d | 2 h |
| #5 Tracker | 2 d | 1 h |
| #6 CV/letter generation, PDF, autofill (3 adapters + AI fallback) | 7 d | 5 h |
| #7 Scheduler & notifications | 1.5 d | 1 h |
| i18n, packaging, README | 2 d | 1 h |
| **Total** | **~29 d** | **~18 h** |

## Out of Scope

- LinkedIn and Indeed (no scraping, no import).
- Automatic submission of applications; solving CAPTCHAs; logging in or creating
  accounts on employer sites.
- Hosted / multi-user version, accounts, sync between devices, mobile app.
- Email integration (reading replies, interview invites) and calendar.
- Running the scheduler when the app is closed (OS-level background services).
- Salary benchmarking, company reviews, networking/referral features.
- Paid job board APIs.

## Open questions for the architecture phase

- App shape (local web app in the browser vs desktop app vs CLI + UI) and stack.
- Exact keyless search library and Common Crawl index usage limits (verify before
  committing).
- PDF rendering approach for CVs.
