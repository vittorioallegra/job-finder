// protects=a generic careers page yields jobs only from a complete, successful read: it makes no request without an AI provider, renders only a page with no readable text, follows posting links one hop on the careers host, keeps a job whose posting page fails, and fails with no jobs whenever the listing is incomplete, empty, invalid or too large;
// fails_when=a scan returns jobs after a failed page or an incomplete listing, a request is made without an AI provider, a posting link off the careers host is fetched, a page with no postings counts as a complete empty scan, an invalid answer is returned unchecked, or an oversized page is cut and read as complete;
// no_claim=real career pages and real model answers: the pages are hand-written fixtures and the model answers are scripted test doubles, so layouts and model quality beyond them are not shown;
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAiModel } from "../ai";
import { createHttpClient, type PageRenderResult } from "../net";
import { scanCareersPage, type CareersAi } from "./scan";

const CAREERS = "https://careers.acme.example.test/careers";
const company = { name: "Acme Robotics", careersUrl: CAREERS };
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

interface Reply {
  status?: number;
  body: string;
}

/** A scripted web: answers by full URL, records each request, and refuses anything unscripted. */
function scriptedWeb(routes: Record<string, Reply>) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    const reply = routes[url];
    if (!reply) return new Response("unscripted", { status: 500 });
    return new Response(reply.body, {
      status: reply.status ?? 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  const http = createHttpClient({
    fetch: fetchFake,
    intervalMs: 0,
    sleep: async () => {},
    maxAttempts: 1,
  });
  return { http, requests };
}

function chatCompletion(content: string) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "local-test",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** A scripted model: each answer is a reply text, or an HTTP status the provider returns. Bodies are recorded. */
function scriptedAi(answers: Array<string | number>, contextSize = 8192) {
  const bodies: string[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const answer = answers[bodies.length - 1];
    if (answer === undefined) throw new Error("unexpected extra AI request");
    if (typeof answer === "number") return new Response("{}", { status: answer });
    return chatCompletion(answer);
  }) as typeof fetch;
  const handle = createAiModel(
    {
      provider: "openai-compatible",
      model: "local-test",
      baseUrl: "http://localhost:11434/v1",
      apiKey: null,
    },
    { fetch: fetchImpl },
  );
  const ai: CareersAi = { model: handle.model, capabilities: handle.capabilities, contextSize };
  return { ai, bodies };
}

function listing(
  listingComplete: boolean,
  postings: Array<{ title: string; location?: string; url?: string }>,
): string {
  return JSON.stringify({ listingComplete, postings });
}

const BACKEND = "https://careers.acme.example.test/careers/jobs/101-backend-engineer";
const ANALYST = "https://careers.acme.example.test/careers/jobs/102-data-analyst";
const SRE = "https://careers.acme.example.test/careers/jobs/103-site-reliability";

describe("scanCareersPage", () => {
  it("lists the postings and reads same-host posting pages, keeping a job whose posting page fails", async () => {
    const { http, requests } = scriptedWeb({
      [CAREERS]: { body: fixture("static-listing.html") },
      [BACKEND]: { body: fixture("posting-backend-engineer.html") },
    });
    const { ai, bodies } = scriptedAi([
      listing(true, [
        { title: "Backend Engineer", location: "Milan, Italy", url: BACKEND },
        { title: "Data Analyst", location: "Remote, Europe", url: ANALYST },
        { title: "Site Reliability Engineer", location: "Berlin, Germany", url: SRE },
      ]),
    ]);

    const result = await scanCareersPage(company, { http, ai });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Backend Engineer",
      "Data Analyst",
      "Site Reliability Engineer",
    ]);
    const [backend, analyst] = result.jobs;
    expect(backend).toMatchObject({
      source: "careers-page",
      sourceJobId: BACKEND,
      url: BACKEND,
      applyUrl: BACKEND,
      companyName: "Acme Robotics",
    });
    expect(backend?.description).toContain("design APIs in TypeScript");
    expect(analyst?.description).toBe("");
    expect(requests).toContain(BACKEND);
    expect(requests.some((url) => url.includes("partners.example.net"))).toBe(false);
    expect(bodies[0]).toContain("https://partners.example.net/acme-apply");
  });

  it("renders a page whose HTML has no readable text, and reads the rendered listing", async () => {
    const rendered: PageRenderResult = {
      ok: true,
      url: CAREERS,
      html: fixture("rendered-listing.html"),
    };
    const renderPage = async () => rendered;
    const { http } = scriptedWeb({ [CAREERS]: { body: fixture("spa-shell.html") } });
    const { ai } = scriptedAi([
      listing(true, [
        {
          title: "Firmware Engineer",
          location: "Milan, Italy",
          url: "https://careers.acme.example.test/jobs/rendered-7",
        },
        {
          title: "Operations Lead",
          location: "Hybrid, Milan",
          url: "https://careers.acme.example.test/jobs/rendered-8",
        },
      ]),
    ]);

    const result = await scanCareersPage(company, {
      http,
      ai,
      renderPage: async (url) => {
        expect(url).toBe(CAREERS);
        return renderPage();
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.jobs.map((job) => job.title)).toEqual(["Firmware Engineer", "Operations Lead"]);
  });

  it("does not render a page that already has enough text", async () => {
    const { http } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });
    const { ai } = scriptedAi([listing(true, [{ title: "Data Analyst", url: ANALYST }])]);
    let renders = 0;

    const result = await scanCareersPage(company, {
      http,
      ai,
      renderPage: async () => {
        renders += 1;
        return { ok: false, code: "unknown" };
      },
    });

    expect(result.ok).toBe(true);
    expect(renders).toBe(0);
  });

  it("makes no request at all when no AI provider is configured", async () => {
    const { http, requests } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });

    const result = await scanCareersPage(company, { http });

    expect(result).toMatchObject({ ok: false, code: "ai-unavailable" });
    expect(requests).toEqual([]);
  });

  it("fails with no jobs when the model reports that the listing continues", async () => {
    const { http } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });
    const { ai } = scriptedAi([listing(false, [{ title: "Data Analyst", url: ANALYST }])]);

    const result = await scanCareersPage(company, { http, ai });

    expect(result).toMatchObject({ ok: false, code: "incomplete-listing" });
    expect(result).not.toHaveProperty("jobs");
  });

  it("fails with no-parseable-jobs when the model finds no postings, and never reads that as an empty complete scan", async () => {
    const { http } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });
    const { ai } = scriptedAi([listing(true, [])]);

    const result = await scanCareersPage(company, { http, ai });

    expect(result).toMatchObject({ ok: false, code: "no-parseable-jobs" });
  });

  it("fails with invalid-response when the repair retry is also invalid", async () => {
    const { http } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });
    const { ai, bodies } = scriptedAi(["not json at all", "still not json"]);

    const result = await scanCareersPage(company, { http, ai });

    expect(result).toMatchObject({ ok: false, code: "invalid-response" });
    expect(bodies).toHaveLength(2);
  });

  it("returns the careers page's HTTP failure and makes no AI request", async () => {
    const { http } = scriptedWeb({ [CAREERS]: { status: 503, body: "" } });
    const { ai, bodies } = scriptedAi([]);

    const result = await scanCareersPage(company, { http, ai });

    expect(result).toMatchObject({ ok: false, code: "http-status", status: 503 });
    expect(bodies).toEqual([]);
  });

  it("fails with ai-unavailable when the provider rejects the key", async () => {
    const { http } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });
    const { ai } = scriptedAi([401]);

    const result = await scanCareersPage(company, { http, ai });

    expect(result).toMatchObject({ ok: false, code: "ai-unavailable" });
  });

  it("fails with too-large when the page does not fit the model's context, instead of cutting it", async () => {
    const { http, requests } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });
    const { ai, bodies } = scriptedAi([], 512);

    const result = await scanCareersPage(company, { http, ai });

    expect(result).toMatchObject({ ok: false, code: "too-large" });
    expect(bodies).toEqual([]);
    expect(requests).toContain(CAREERS);
  });

  it("fails with too-large when the model lists more postings than the scan reads", async () => {
    const { http } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });
    const postings = Array.from({ length: 201 }, (_, index) => ({ title: `Role ${index}` }));
    const { ai } = scriptedAi([listing(true, postings)]);

    const result = await scanCareersPage(company, { http, ai });

    expect(result).toMatchObject({ ok: false, code: "too-large" });
  });

  it("identifies a posting by its title and location when its link is not on the page, and never fetches that link", async () => {
    const { http, requests } = scriptedWeb({ [CAREERS]: { body: fixture("static-listing.html") } });
    const { ai } = scriptedAi([
      listing(true, [
        { title: "Platform Engineer", location: "Milan", url: "https://evil.example.net/x" },
      ]),
    ]);

    const result = await scanCareersPage(company, { http, ai });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs[0]).toMatchObject({ url: CAREERS, description: "" });
    expect(result.jobs[0]?.sourceJobId).toMatch(/^listing:[0-9a-f]{32}$/);
    expect(requests.some((url) => url.includes("evil.example.net"))).toBe(false);
  });

  it("gives postings that share one link, or sit on anchors of the careers page, separate identities scoped to the company", async () => {
    // protects=each listed posting keeps its own identity even when the postings share a link, and identities differ between companies; fails_when=two postings collapse into one identity (the other gets closed) or two companies produce the same identity for the same title and location; no_claim=the model's reading of the page;
    const answer = listing(true, [
      { title: "Backend Engineer", location: "Berlin", url: "#backend" },
      { title: "Designer", location: "Berlin", url: "#designer" },
      { title: "Analyst", location: "Berlin", url: "/careers/apply" },
      { title: "Writer", location: "Berlin", url: "/careers/apply" },
    ]);
    const page = `<html><body><p>${"Open roles at Acme. ".repeat(20)}</p><a href="/careers/apply">Apply</a></body></html>`;
    const idsFor = async (careersUrl: string) => {
      const { http } = scriptedWeb({ [careersUrl]: { body: page } });
      const { ai } = scriptedAi([answer]);
      const result = await scanCareersPage({ name: "Acme", careersUrl }, { http, ai });
      expect(result.ok).toBe(true);
      return result.ok ? result.jobs.map((job) => job.sourceJobId) : [];
    };

    const first = await idsFor(CAREERS);
    const other = await idsFor("https://careers.other.example.test/jobs");

    expect(new Set(first).size).toBe(4);
    expect(first.some((id) => other.includes(id))).toBe(false);
  });

  it("fails with render-failed when the renderer cannot load a page that has no readable text", async () => {
    const { http } = scriptedWeb({ [CAREERS]: { body: fixture("spa-shell.html") } });
    const { ai } = scriptedAi([]);

    const result = await scanCareersPage(company, {
      http,
      ai,
      renderPage: async () => ({ ok: false, code: "load-failed" }),
    });

    expect(result).toMatchObject({ ok: false, code: "render-failed" });
  });
});
