// protects=the update check reads the latest published GitHub release through the HTTP client (so the fixture override applies), reports only a newer version with its release page, treats a repository without releases as up to date, and never reports a malformed answer as an update;
// fails_when=a request leaves the fixture origin or skips the override, an older or equal release is reported, a draft-looking tag such as a pre-release is reported, a 404 counts as a failure, or a body that is not a release is reported as an update;
// no_claim=GitHub's own rate limits and response shape beyond tag_name are not checked here, and the production repository constant is still null so no real request is made yet.
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net/http";
import { checkLatestRelease } from "./release";

const FIXTURE = "http://127.0.0.1:4010";
const REPO = "acme/job-finder";

interface Seen {
  url: string;
  accept: string | null;
}

/** A fetch that answers the release endpoint with `reply` and robots.txt with a 404 (no rules). */
function releaseFetch(reply: () => Response): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (new URL(url).pathname === "/robots.txt") {
      return new Response("", { status: 404 });
    }
    seen.push({ url, accept: new Headers(init?.headers).get("accept") });
    return reply();
  };
  return { fetch: fetchFake as typeof fetch, seen };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientFor(transport: typeof fetch) {
  return createHttpClient({
    fetch: transport,
    fixtureBaseUrl: FIXTURE,
    intervalMs: 0,
    sleep: async () => {},
  });
}

describe("update check", () => {
  it("asks the fixture origin for the latest release and reports a newer one", async () => {
    const { fetch, seen } = releaseFetch(() => json({ tag_name: "v0.3.0", draft: false }));
    const outcome = await checkLatestRelease({
      http: clientFor(fetch),
      repository: REPO,
      currentVersion: "0.2.0",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${FIXTURE}/repos/acme/job-finder/releases/latest`);
    expect(seen[0]?.accept).toBe("application/vnd.github+json");
    expect(outcome).toEqual({
      ok: true,
      release: { version: "0.3.0", url: "https://github.com/acme/job-finder/releases/tag/v0.3.0" },
    });
  });

  it("reports nothing when the release is the running version or older", async () => {
    for (const tag of ["v0.2.0", "v0.1.9"]) {
      const { fetch } = releaseFetch(() => json({ tag_name: tag }));
      const outcome = await checkLatestRelease({
        http: clientFor(fetch),
        repository: REPO,
        currentVersion: "0.2.0",
      });
      expect(outcome).toEqual({ ok: true, release: null });
    }
  });

  it("treats a repository without releases as up to date", async () => {
    const { fetch } = releaseFetch(() => json({ message: "Not Found" }, 404));
    const outcome = await checkLatestRelease({
      http: clientFor(fetch),
      repository: REPO,
      currentVersion: "0.2.0",
    });
    expect(outcome).toEqual({ ok: true, release: null });
  });

  it("reports a failed request or a tag that is not a release as an error, not an update", async () => {
    const failing = releaseFetch(() => json({}, 500));
    expect(
      await checkLatestRelease({
        http: clientFor(failing.fetch),
        repository: REPO,
        currentVersion: "0.2.0",
      }),
    ).toEqual({ ok: false, code: "unavailable" });

    const notJson = releaseFetch(() => new Response("<html>", { status: 200 }));
    expect(
      await checkLatestRelease({
        http: clientFor(notJson.fetch),
        repository: REPO,
        currentVersion: "0.2.0",
      }),
    ).toEqual({ ok: false, code: "invalid-response" });

    const prerelease = releaseFetch(() => json({ tag_name: "v9.0.0-beta.1" }));
    expect(
      await checkLatestRelease({
        http: clientFor(prerelease.fetch),
        repository: REPO,
        currentVersion: "0.2.0",
      }),
    ).toEqual({ ok: false, code: "invalid-response" });
  });

  it("refuses a repository name that is not owner/name before any request", async () => {
    const { fetch, seen } = releaseFetch(() => json({ tag_name: "v9.0.0" }));
    const outcome = await checkLatestRelease({
      http: clientFor(fetch),
      repository: "acme/../evil",
      currentVersion: "0.2.0",
    });
    expect(outcome).toEqual({ ok: false, code: "unavailable" });
    expect(seen).toHaveLength(0);
  });
});
