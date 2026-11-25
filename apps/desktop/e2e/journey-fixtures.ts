import { createReplayFetch, type FixtureEntry } from "@job-finder/core/ai";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The local fixture server the journey points every outbound host at (JOB_FINDER_FIXTURE_BASE_URL). */
export interface JourneyFixtures {
  url: string;
  /** Form submissions the fixture form received. The journey must leave this at zero. */
  submissions: () => number;
  /** Requests no route answers: an unexpected host path, or an AI request with no replay. */
  unexpected: () => string[];
  close: () => Promise<void>;
}

const repoRoot = resolve(__dirname, "../../..");
const autofillFixtures = resolve(__dirname, "../src/main/autofill/fixtures");
const searchPage = join(repoRoot, "packages/core/src/discovery/fixtures/duckduckgo-results.html");
const aiFixturePath = join(repoRoot, "packages/core/src/ai/fixtures/ai-openai-compatible.json");

/** A Greenhouse board with one posting. Its apply link points back at the fixture server's form page. */
function boardJson(origin: string): string {
  return JSON.stringify({
    jobs: [
      {
        id: 4001,
        title: "Software Engineer",
        absolute_url: `${origin}/greenhouse.html`,
        company_name: "Acme",
        location: { name: "Milano" },
        content:
          "&lt;p&gt;Build the payments platform with a small team in Milano.&lt;/p&gt;&lt;p&gt;TypeScript and PostgreSQL.&lt;/p&gt;",
        first_published: "2026-11-01T09:00:00Z",
        updated_at: "2026-11-01T09:00:00Z",
      },
    ],
  });
}

function readAiEntries(): FixtureEntry[] {
  const parsed = JSON.parse(readFileSync(aiFixturePath, "utf8")) as { entries: FixtureEntry[] };
  return parsed.entries;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": contentType }).end(body);
}

/**
 * Answers the journey's requests on loopback: the search page, the Greenhouse board API, the
 * form page, and the AI endpoint through the record/replay fetch. Anything else is a 404 and is
 * listed in `unexpected`, so a request the journey did not plan for fails the test.
 */
export async function serveJourneyFixtures(): Promise<JourneyFixtures> {
  let submissions = 0;
  const unexpected: string[] = [];
  const replay = createReplayFetch(readAiEntries());
  let url = "";

  const server: Server = createServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      const { pathname } = new URL(request.url ?? "/", "http://fixture.invalid");
      const label = `${method} ${pathname}`;

      if (method === "GET" && pathname === "/html/") {
        send(response, 200, "text/html; charset=utf-8", readFileSync(searchPage, "utf8"));
        return;
      }
      // robots.txt is not published by the fixture: an absent file allows every path.
      if (method === "GET" && pathname === "/robots.txt") {
        send(response, 404, "text/plain", "not found");
        return;
      }
      // Common Crawl's URL index has no captures for the ATS domains in this fixture: a 404 is an empty result.
      if (method === "GET" && pathname === "/CC-MAIN-2026-43-index") {
        send(response, 404, "text/plain", "not found");
        return;
      }
      // The job directories and feeds the company search also reads: the fixture has none, which
      // each answers as an empty result (404), so no company comes from them.
      if (
        method === "GET" &&
        (pathname === "/api/v1/jobs" ||
          pathname === "/jobs/api/search" ||
          pathname === "/api/remote-jobs" ||
          pathname === "/api/job-board-api" ||
          pathname === "/sparql")
      ) {
        send(response, 404, "text/plain", "not found");
        return;
      }
      // The daily update check: the repository has no published release yet, which GitHub answers with 404.
      if (method === "GET" && /^\/repos\/[^/]+\/[^/]+\/releases\/latest$/.test(pathname)) {
        send(response, 404, "application/json", JSON.stringify({ message: "Not Found" }));
        return;
      }
      if (method === "GET" && pathname === "/v1/boards/acme/jobs") {
        send(response, 200, "application/json", boardJson(url));
        return;
      }
      if (method === "POST" && pathname === "/greenhouse.html") {
        submissions += 1;
        send(response, 200, "text/plain", "received");
        return;
      }
      if (method === "GET" && /^\/[a-z]+\.html$/.test(pathname)) {
        const file = join(autofillFixtures, pathname.slice(1));
        if (existsSync(file)) {
          send(response, 200, "text/html; charset=utf-8", readFileSync(file, "utf8"));
          return;
        }
      }
      if (method === "POST" && pathname === "/v1/chat/completions") {
        const body = await readBody(request);
        try {
          const replayed = await replay(`${url}${pathname}`, {
            method,
            headers: { "content-type": "application/json" },
            body,
          });
          send(response, replayed.status, "application/json", await replayed.text());
        } catch (error) {
          unexpected.push(`${label} ${(error as Error).message}\n${body}`);
          send(response, 500, "text/plain", "no recorded response");
        }
        return;
      }

      unexpected.push(label);
      send(response, 404, "text/plain", "not found");
    })();
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  url = `http://127.0.0.1:${port}`;
  return {
    url,
    submissions: () => submissions,
    unexpected: () => [...unexpected],
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
