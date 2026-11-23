import { z } from "zod";
import type { HttpResult } from "../net";
import { resultTarget } from "./duckduckgo";
import type { SearchResult, SearchSource } from "./source";
import type { KeyedSearchConfig } from "./types";

/** Results asked for per query. Each provider accepts at least this many on its free tier. */
const RESULTS_PER_QUERY = 20;

const BraveResponse = z.object({
  web: z.object({ results: z.array(z.object({ url: z.string() })) }).optional(),
});
const TavilyResponse = z.object({
  results: z.array(z.object({ url: z.string() })),
});
const SerperResponse = z.object({
  organic: z.array(z.object({ link: z.string() })).optional(),
});

/** Result URLs that are http or https; anything else is dropped. */
function targets(urls: string[]): string[] {
  return urls.flatMap((url) => {
    const target = resultTarget(url);
    return target === undefined ? [] : [target];
  });
}

/**
 * Runs one query against a keyed provider through the shared HTTP client. The key travels in a
 * header only, never in the URL, so it cannot reach a log or a cache key. A reply that does not
 * match the expected shape is `invalid-response`; the body is never reported.
 */
async function runKeyed(
  request: () => Promise<HttpResult>,
  read: (body: unknown) => string[] | undefined,
): Promise<SearchResult> {
  const result = await request();
  if (!result.ok) {
    return { ok: false, code: result.code };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    return { ok: false, code: "invalid-response" };
  }
  const urls = read(parsed);
  return urls === undefined ? { ok: false, code: "invalid-response" } : { ok: true, urls: targets(urls) };
}

/** A keyed web search source. The factory takes the key once; the source never returns it. */
export function createKeyedSource(config: KeyedSearchConfig): SearchSource {
  const { provider, apiKey } = config;
  return {
    id: `keyed-${provider}`,
    async search(query, { http, signal }) {
      if (provider === "brave") {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${RESULTS_PER_QUERY}`;
        return runKeyed(
          () =>
            http.get(url, {
              signal,
              headers: { "x-subscription-token": apiKey, accept: "application/json" },
            }),
          (body) => {
            const parsed = BraveResponse.safeParse(body);
            return parsed.success ? (parsed.data.web?.results ?? []).map((item) => item.url) : undefined;
          },
        );
      }
      if (provider === "tavily") {
        return runKeyed(
          () =>
            http.post("https://api.tavily.com/search", {
              signal,
              body: JSON.stringify({ query, max_results: RESULTS_PER_QUERY }),
              headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            }),
          (body) => {
            const parsed = TavilyResponse.safeParse(body);
            return parsed.success ? parsed.data.results.map((item) => item.url) : undefined;
          },
        );
      }
      return runKeyed(
        () =>
          http.post("https://google.serper.dev/search", {
            signal,
            body: JSON.stringify({ q: query, num: RESULTS_PER_QUERY }),
            headers: { "x-api-key": apiKey, "content-type": "application/json" },
          }),
        (body) => {
          const parsed = SerperResponse.safeParse(body);
          return parsed.success ? (parsed.data.organic ?? []).map((item) => item.link) : undefined;
        },
      );
    },
  };
}
