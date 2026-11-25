import { z } from "zod";
import { canonicalBoardUrl } from "./boards";
import { normalizeCompanyName, sameCompany } from "./company-name";
import type { SearchOptions } from "./source";
import type { DiscoveryCandidate } from "./types";
import { slugVariants } from "./workable-directory";

/** A company named by a job feed, with what helps to find its board. */
export interface CompanyEntry {
  name: string;
  website?: string | null;
  /** A job title the company is known to have: it identifies a board that carries no company name. */
  title?: string | null;
}

/** Largest board document read while checking a guess. */
const PROBE_MAX_BYTES = 4 * 1024 * 1024;

type Probe = (slug: string, entry: CompanyEntry, options: SearchOptions) => Promise<boolean>;

async function json(url: string, options: SearchOptions): Promise<unknown> {
  const answer = await options.http.get(url, {
    signal: options.signal,
    maxBodyBytes: PROBE_MAX_BYTES,
  });
  if (!answer.ok) return undefined;
  try {
    return JSON.parse(answer.body);
  } catch {
    return undefined;
  }
}

async function text(url: string, options: SearchOptions): Promise<string | undefined> {
  const answer = await options.http.get(url, {
    signal: options.signal,
    maxBodyBytes: PROBE_MAX_BYTES,
  });
  return answer.ok ? answer.body : undefined;
}

const Named = z.object({ name: z.string().nullish() });

/** True when one of `titles` is the entry's title (same letters and digits). */
function hasTitle(titles: readonly unknown[], entry: CompanyEntry): boolean {
  const wanted = (entry.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (wanted.length < 6) return false;
  return titles.some(
    (title) =>
      typeof title === "string" && title.toLowerCase().replace(/[^a-z0-9]+/g, "") === wanted,
  );
}

/**
 * How each provider's board is checked to be the company's. Where the board names its company the
 * names must be the same; where it does not (Lever, Ashby, Personio), it must carry a job with the
 * title the feed gave, which a stranger's board almost never does.
 */
const PROBES: Record<string, Probe> = {
  async greenhouse(slug, entry, options) {
    const parsed = Named.safeParse(
      await json(`https://boards-api.greenhouse.io/v1/boards/${slug}`, options),
    );
    return parsed.success && !!parsed.data.name && sameCompany(parsed.data.name, entry.name);
  },
  async workable(slug, entry, options) {
    const parsed = Named.safeParse(
      await json(`https://apply.workable.com/api/v1/widget/accounts/${slug}`, options),
    );
    return parsed.success && !!parsed.data.name && sameCompany(parsed.data.name, entry.name);
  },
  async smartrecruiters(slug, entry, options) {
    const parsed = z
      .object({
        content: z.array(z.object({ company: z.object({ name: z.string().nullish() }).nullish() })),
      })
      .safeParse(
        await json(
          `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`,
          options,
        ),
      );
    const name = parsed.success ? parsed.data.content[0]?.company?.name : undefined;
    return !!name && sameCompany(name, entry.name);
  },
  async recruitee(slug, entry, options) {
    const parsed = z
      .object({ offers: z.array(z.object({ company_name: z.string().nullish() })) })
      .safeParse(await json(`https://${slug}.recruitee.com/api/offers/`, options));
    const name = parsed.success ? parsed.data.offers[0]?.company_name : undefined;
    return !!name && sameCompany(name, entry.name);
  },
  async teamtailor(slug, entry, options) {
    const body = await text(`https://${slug}.teamtailor.com/jobs.rss`, options);
    const channel = body ? /<channel>\s*<title>([^<]+)<\/title>/.exec(body)?.[1] : undefined;
    return !!channel && sameCompany(channel, entry.name);
  },
  async lever(slug, entry, options) {
    if (!entry.title) return false;
    const parsed = z
      .array(z.object({ text: z.string() }))
      .safeParse(await json(`https://api.lever.co/v0/postings/${slug}?mode=json`, options));
    return (
      parsed.success &&
      hasTitle(
        parsed.data.map((posting) => posting.text),
        entry,
      )
    );
  },
  async ashby(slug, entry, options) {
    if (!entry.title) return false;
    const parsed = z
      .object({ jobs: z.array(z.object({ title: z.string() })) })
      .safeParse(await json(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, options));
    return (
      parsed.success &&
      hasTitle(
        parsed.data.jobs.map((job) => job.title),
        entry,
      )
    );
  },
  async personio(slug, entry, options) {
    if (!entry.title) return false;
    const body = await text(`https://${slug}.jobs.personio.de/xml`, options);
    if (!body || !body.includes("workzag-jobs")) return false;
    const titles = [...body.matchAll(/<name>\s*(?:<!\[CDATA\[)?([^<\]]+)/g)].map((m) => m[1]);
    return hasTitle(titles, entry);
  },
};

/** Resolved companies in this session: a name is looked up once, found or not. */
const resolved = new Map<string, DiscoveryCandidate | null>();

/**
 * Finds the public job board of a company named by a feed, as a board the scan can read: the name
 * is turned into likely board names, each is tried on every provider at once (they are different
 * hosts), and a board counts only when it proves to be that company's (see `PROBES`). Returns null
 * when no board is found. Guessing is bounded: two names, eight providers.
 */
export async function resolveBoard(
  entry: CompanyEntry,
  options: SearchOptions,
): Promise<DiscoveryCandidate | null> {
  const key = normalizeCompanyName(entry.name);
  if (key === "") return null;
  const cached = resolved.get(key);
  if (cached !== undefined) return cached;

  const variants = slugVariants(entry.name, entry.website ?? null).slice(0, 2);
  for (const slug of variants) {
    if (options.signal?.aborted) return null;
    const providers = Object.keys(PROBES);
    const verdicts = await Promise.all(
      providers.map((ats) => (PROBES[ats] as Probe)(slug, entry, options).catch(() => false)),
    );
    const index = verdicts.findIndex(Boolean);
    if (index === -1) continue;
    const ats = providers[index] as DiscoveryCandidate["ats"];
    const careersUrl = canonicalBoardUrl(ats as never, slug);
    if (careersUrl === undefined) continue;
    const candidate: DiscoveryCandidate = { ats, slug, careersUrl, name: entry.name };
    resolved.set(key, candidate);
    return candidate;
  }
  resolved.set(key, null);
  return null;
}
