import { createHash } from "node:crypto";
import type { LanguageModel } from "ai";
import { AiError, checkContextFit, generateStructured, type AiCapabilities } from "../ai";
import type { AdapterFailure, AdapterFailureCode, AdapterResult } from "../ats/types";
import { buildJob, locationsFromText } from "../ats/build";
import type { HttpClient, PageRenderErrorCode, PageRenderResult } from "../net";
import { htmlToText, type NormalizedJob } from "../normalize";
import { listingPrompt, ListingSchema, type Listing } from "./listing";
import { reduceCareersPage, type ReducedCareersPage } from "./reduce";

/** Source id of postings read from a generic careers page. */
export const CAREERS_SOURCE = "careers-page";

/** Text plus links handed to the model, in characters. A larger page fails rather than being cut. */
const MAX_PROMPT_CHARS = 60_000;
/** Below this much visible text the HTML is treated as a shell and the page is rendered. */
const MIN_STATIC_TEXT_CHARS = 300;
/** Posting pages read per company, one hop from the careers page. */
const MAX_DETAIL_PAGES = 25;
const MAX_DESCRIPTION_CHARS = 4_000;
/** More postings than this in one listing fails the scan: the rest would be read as closed. */
const MAX_POSTINGS = 200;

export interface CareersCompany {
  name: string;
  careersUrl: string;
}

/** The AI model for a scan. Built by the caller from the configured provider. */
export interface CareersAi {
  model: LanguageModel;
  capabilities: AiCapabilities;
  /** Configured context size of the model, in tokens. */
  contextSize: number;
}

export interface CareersScanOptions {
  http: HttpClient;
  /** Undefined when no AI provider is set up: the scan then fails with `ai-unavailable`, and no request is made. */
  ai?: CareersAi;
  /** Renders a page whose HTML has no readable text. Omitted: the static HTML is the only source. */
  renderPage?: (url: string) => Promise<PageRenderResult>;
  signal?: AbortSignal;
}

interface ListedPosting {
  title: string;
  location?: string;
  url: string;
  sourceJobId: string;
  /** A posting page on the careers page's own host, read for its description. */
  followable: boolean;
}

/**
 * Reads one generic careers page into normalized jobs. The careers page is read once (rendered
 * only when its HTML has no text), the model lists its postings, and each posting page on the same
 * host is read for its description. Any failure returns no jobs, so a partial read can never close
 * the company's postings. The result is complete only when the model reports a complete listing.
 */
export async function scanCareersPage(
  company: CareersCompany,
  options: CareersScanOptions,
): Promise<AdapterResult> {
  const { http, ai, signal } = options;
  const careersUrl = company.careersUrl;
  const fail = (code: AdapterFailureCode, url = careersUrl, status?: number): AdapterFailure =>
    status === undefined ? { ok: false, code, url } : { ok: false, code, url, status };

  if (!ai) return fail("ai-unavailable");

  const page = await http.get(careersUrl, { signal });
  if (!page.ok) return fail(page.code, page.url, page.status);

  let reduced: ReducedCareersPage = reduceCareersPage(page.body, careersUrl);
  if (reduced.text.length < MIN_STATIC_TEXT_CHARS && options.renderPage) {
    const rendered = await options.renderPage(careersUrl);
    if (!rendered.ok) return fail(renderFailure(rendered.code));
    reduced = reduceCareersPage(rendered.html, careersUrl);
  }

  const { system, user } = listingPrompt(reduced);
  if (system.length + user.length > MAX_PROMPT_CHARS) return fail("too-large");
  if (checkContextFit(`${system}\n${user}`, ai.contextSize).exceeds) return fail("too-large");

  let listing: Listing;
  try {
    const result = await generateStructured({
      model: ai.model,
      capabilities: ai.capabilities,
      schema: ListingSchema,
      system,
      prompt: user,
      contextSize: ai.contextSize,
      abortSignal: signal,
    });
    listing = result.value;
  } catch (error) {
    if (signal?.aborted) return fail("aborted");
    if (error instanceof AiError && error.code === "invalid-output")
      return fail("invalid-response");
    return fail("ai-unavailable");
  }

  if (!listing.listingComplete) return fail("incomplete-listing");
  if (listing.postings.length === 0) return fail("no-parseable-jobs");
  if (listing.postings.length > MAX_POSTINGS) return fail("too-large");

  const postings = listPostings(listing, reduced, company);
  const jobs: NormalizedJob[] = [];
  let detailPages = 0;
  for (const posting of postings) {
    let description = "";
    if (posting.followable && detailPages < MAX_DETAIL_PAGES) {
      detailPages += 1;
      const detail = await http.get(posting.url, { signal });
      if (signal?.aborted) return fail("aborted", posting.url);
      // A posting page that fails keeps its job, which the listing still shows, but without a description.
      if (detail.ok) description = htmlToText(detail.body).slice(0, MAX_DESCRIPTION_CHARS);
    }
    jobs.push(
      buildJob({
        source: CAREERS_SOURCE,
        sourceJobId: posting.sourceJobId,
        url: posting.url,
        companyName: company.name,
        title: posting.title,
        description,
        locations: locationsFromText([posting.location]),
      }),
    );
  }
  return { ok: true, jobs };
}

/**
 * Identity and link of each listed posting. A posting's link is used only when it is one of the
 * page's own links; otherwise its identity comes from the title and location, and it links to the
 * careers page.
 */
function listPostings(
  listing: Listing,
  page: ReducedCareersPage,
  company: CareersCompany,
): ListedPosting[] {
  const linkUrls = new Set(page.links.map((link) => link.url));
  const careersHost = new URL(company.careersUrl).hostname;
  return listing.postings.map((posting) => {
    const location = posting.location?.trim() || undefined;
    const listed = resolveListed(posting.url, company.careersUrl);
    if (listed !== undefined && linkUrls.has(listed)) {
      return {
        title: posting.title,
        location,
        url: listed,
        sourceJobId: listed,
        followable: listed !== company.careersUrl && new URL(listed).hostname === careersHost,
      };
    }
    const digest = createHash("sha256")
      .update(`${posting.title}\n${location ?? ""}`)
      .digest("hex")
      .slice(0, 32);
    return {
      title: posting.title,
      location,
      url: company.careersUrl,
      sourceJobId: `listing:${digest}`,
      followable: false,
    };
  });
}

/** The absolute http(s) address of a listed link, without its fragment; undefined for anything else. */
function resolveListed(value: string | null | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function renderFailure(code: PageRenderErrorCode): AdapterFailureCode {
  switch (code) {
    case "blocked-by-robots":
    case "timeout":
    case "too-large":
      return code;
    default:
      return "render-failed";
  }
}
