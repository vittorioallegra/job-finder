# Adding an ATS adapter

An ATS adapter reads one provider's public job board into `NormalizedJob` values
(`packages/core/src/normalize/job.ts`). Adapters live in `packages/core/src/ats/`, one file per
provider, and never call `fetch` directly: all HTTP goes through the client from
`@job-finder/core/net`, which applies the per-host queue, robots.txt, caching and backoff.

## Steps

1. **Find the public endpoint.** It must be unauthenticated and documented or stable. Note its
   rate limits and any pagination. If the provider only offers a keyed API, it does not qualify.
2. **Record a response.** Fetch a real board with `curl` into the scratchpad, not into the repo.
   Keep only a few postings (the first two or three), cut long descriptions, and remove fields
   the adapter does not read. Name the fixture after the provider, e.g.
   `packages/core/src/ats/fixtures/<provider>.json`. Note the recording date in the plan's
   Decisions, since fixtures are trimmed and not byte-identical to the live response.
3. **Add the id.** Append the provider to `ATS_IDS` in `ats/types.ts`.
4. **Add detection rules.** In `ats/detect.ts`, add a `URL_RULES` entry whose first capture group
   is the board token. Add the provider's URLs to `detect.test.ts` (two per provider).
5. **Write the adapter.** Use `createAdapter` from `ats/adapter.ts` with:
   - `endpoint(slug, offset?)`: the public URL for one board. The slug is already validated.
   - `parse(body, board)`: validate the body with a zod schema (`parseJson` from `ats/build.ts`),
     return `undefined` when it does not match, and map each posting with `buildJob`.
     Read structured fields (workplace type, employment type, level, country code) and pass them as
     hints; `buildJob` falls back to the title and location text. Never pass a whole description
     as a work-mode hint.
6. **Register it.** Add the adapter to `ATS_ADAPTERS` in `ats/index.ts`.
7. **Test it.** In `ats/adapters.test.ts`, add the fixture to `FIXTURE_FILES` and a case that checks
   title, company, location, work mode, apply URL and identity. Confirm the wrong-shape case
   still fails for the new provider.
8. **Check the rules.** No `fetch` import; no URL built from unvalidated input; no partial results
   (a failing page returns a failure, never the jobs read so far).

## Conventions

- `source` is the provider id and `sourceJobId` its own id. Identity is `identityKey`; cross-source
  duplicates are found by `fingerprint`, never by URL.
- Dates are ISO 8601 (`toIso`). Unknown values stay `undefined`; the model never guesses a salary,
  visa status or seniority from the description.
- Descriptions are plain text. Convert HTML with `htmlToText` (or `escapedHtmlToText` when the
  API escapes its HTML a second time).
- Company names come from the response when it sends one, otherwise from `BoardRef.companyName`,
  otherwise from the slug.
- Locations: use structured parts with `locationFromParts`, and free text with `normalizeLocation`.
  Two-letter codes are never read from free text.
