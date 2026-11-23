// protects=the renderer origin is compared as scheme and host, so app://renderer and the dev server origin match themselves and nothing else;
// fails_when=app:// URLs collapse to the "null" origin, a path or query changes the result, or an unparseable URL yields an origin;
// no_claim=the navigation guard and the IPC sender check that use it are tested in their own files.
import { describe, expect, it } from "vitest";
import { originOf } from "./origin";

describe("originOf", () => {
  it("keeps the custom app scheme and host, ignoring the path", () => {
    expect(originOf("app://renderer/")).toBe("app://renderer");
    expect(originOf("app://renderer/settings?x=1")).toBe("app://renderer");
  });

  it("includes the port for the development server", () => {
    expect(originOf("http://localhost:5173/")).toBe("http://localhost:5173");
  });

  it("returns null for URLs without a host or that do not parse", () => {
    expect(originOf("data:text/html,hi")).toBeNull();
    expect(originOf("not a url")).toBeNull();
  });
});
