// protects=page renders are refused for invalid URLs and URLs robots.txt disallows before anything reaches main, and an allowed URL is sent in its fixture-resolved form;
// fails_when=the transport is called for a URL that is invalid or disallowed, or an allowed URL is sent without the fixture override;
// no_claim=the hidden loader in main and the real robots.txt of any site are not exercised here.
import { describe, expect, it } from "vitest";
import { guardPageRender } from "./page";

describe("guarded page render", () => {
  it("refuses an invalid URL without calling the transport", async () => {
    const sent: string[] = [];
    const render = guardPageRender(
      { resolve: () => undefined, isAllowed: async () => true },
      async (url) => {
        sent.push(url);
        return { ok: true, url, html: "" };
      },
    );

    expect(await render("javascript:alert(1)")).toEqual({ ok: false, code: "invalid-url" });
    expect(sent).toEqual([]);
  });

  it("refuses a URL robots.txt disallows without calling the transport", async () => {
    const sent: string[] = [];
    const render = guardPageRender(
      { resolve: (url) => url, isAllowed: async () => false },
      async (url) => {
        sent.push(url);
        return { ok: true, url, html: "" };
      },
    );

    expect(await render("https://jobs.example.test/private")).toEqual({
      ok: false,
      code: "blocked-by-robots",
    });
    expect(sent).toEqual([]);
  });

  it("sends the resolved URL for an allowed page and returns the transport's result", async () => {
    const render = guardPageRender(
      {
        resolve: (url) => url.replace("https://jobs.example.test", "http://127.0.0.1:4010"),
        isAllowed: async () => true,
      },
      async (url) => ({ ok: true, url, html: "<main>jobs</main>" }),
    );

    expect(await render("https://jobs.example.test/careers")).toEqual({
      ok: true,
      url: "http://127.0.0.1:4010/careers",
      html: "<main>jobs</main>",
    });
  });
});
