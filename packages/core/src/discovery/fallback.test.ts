// protects=the configured search sources work as one in order (the free one first, the keyed ones only for what it cannot answer), a refused source rests and is not asked again, an answer after a refusal is marked degraded, and a failure says blocked when any source was blocked;
// fails_when=a run spends more keyed requests than its budget, a keyed source is asked while DuckDuckGo answers, a blocked source is asked again at once, a later source is not tried after a refusal, or the failure hides that a source was blocked;
// no_claim=how long the real services stay blocked or when plans reset, and live answers;
import { beforeEach, describe, expect, it } from "vitest";
import { createFallbackSource, QUOTA_REST_MS, resetFallbackState } from "./fallback";
import type { SearchResult, SearchSource } from "./source";

function scripted(id: string, answer: () => SearchResult) {
  const asked: string[] = [];
  const source: SearchSource = {
    id,
    async search(query) {
      asked.push(query);
      return answer();
    },
  };
  return { source, asked };
}
const http = {} as Parameters<SearchSource["search"]>[1]["http"];
const ok = (url: string): SearchResult => ({ ok: true, urls: [url] });

describe("fallback search source", () => {
  beforeEach(() => resetFallbackState());

  it("asks the keyed source only when the free one cannot answer", async () => {
    const free = scripted("free", () => ok("https://a.example"));
    const keyed = scripted("keyed", () => ok("https://b.example"));
    const source = createFallbackSource([free.source, keyed.source]);

    expect(await source.search("q1", { http })).toEqual(ok("https://a.example"));
    expect(keyed.asked).toEqual([]);
  });

  it("moves to the keyed source when the free one is blocked, marks the answer degraded and does not ask the blocked one again", async () => {
    let clock = 0;
    const free = scripted("free", () => ({ ok: false, code: "blocked" }));
    const keyed = scripted("keyed", () => ok("https://b.example"));
    const source = createFallbackSource([free.source, keyed.source], { now: () => clock });

    expect(await source.search("q1", { http })).toEqual({
      ok: true,
      urls: ["https://b.example"],
      degraded: true,
    });
    await source.search("q2", { http });
    expect(free.asked).toEqual(["q1"]);
    expect(keyed.asked).toEqual(["q1", "q2"]);

    clock += 21 * 60 * 1000;
    await source.search("q3", { http });
    expect(free.asked).toEqual(["q1", "q3"]);
  });

  it("goes on to the next keyed source when one has no quota left, for the hour", async () => {
    let clock = 0;
    const first = scripted("tavily", () => ({ ok: false, code: "quota-exhausted" }));
    const second = scripted("serper", () => ok("https://c.example"));
    const source = createFallbackSource([first.source, second.source], { now: () => clock });

    await source.search("q1", { http });
    await source.search("q2", { http });
    expect(first.asked).toEqual(["q1"]);
    expect(second.asked).toEqual(["q1", "q2"]);

    clock += QUOTA_REST_MS + 1;
    await source.search("q3", { http });
    expect(first.asked).toEqual(["q1", "q3"]);
  });

  it("fails as blocked when a source was blocked and none answered, and as the last failure otherwise", async () => {
    const free = scripted("free", () => ({ ok: false, code: "blocked" }));
    const keyed = scripted("keyed", () => ({ ok: false, code: "network" }));
    expect(await createFallbackSource([free.source, keyed.source]).search("q", { http })).toEqual({
      ok: false,
      code: "blocked",
    });

    resetFallbackState();
    const only = scripted("only", () => ({ ok: false, code: "network" }));
    expect(await createFallbackSource([only.source]).search("q", { http })).toEqual({
      ok: false,
      code: "network",
    });
  });

  it("stops sending queries to the keyed sources after the budget of a run, and keeps using the free one", async () => {
    const free = scripted("free", () => ({ ok: false, code: "network" }));
    const keyed = scripted("keyed", () => ok("https://b.example"));
    const source = createFallbackSource([free.source, keyed.source], { keyedBudget: 2 });

    for (const query of ["q1", "q2", "q3"]) await source.search(query, { http });

    expect(keyed.asked).toEqual(["q1", "q2"]);
    expect(free.asked).toEqual(["q1", "q2", "q3"]);
  });
});
