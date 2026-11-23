// protects=release versions compare by major, minor and patch, with an optional leading v, and pre-release or malformed tags never count as newer;
// fails_when=1.10.0 is ranked below 1.9.0, a tag with a suffix such as 1.2.3-beta is accepted as a release, or an equal version reports an update;
// no_claim=the semantic-versioning rules for pre-release precedence are not implemented: pre-releases are rejected, not ordered.
import { describe, expect, it } from "vitest";
import { isNewerVersion, parseVersion } from "./version";

describe("release version", () => {
  it("parses plain and v-prefixed versions", () => {
    expect(parseVersion("0.2.0")).toEqual([0, 2, 0]);
    expect(parseVersion("v1.10.3")).toEqual([1, 10, 3]);
  });

  it("rejects pre-releases, partial versions and leading zeros", () => {
    expect(parseVersion("1.2.3-beta.1")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("01.2.3")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
  });

  it("compares numerically, not as text", () => {
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("v0.3.0", "0.2.9")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.1.9", "0.2.0")).toBe(false);
  });

  it("never reports an update from an unparseable version", () => {
    expect(isNewerVersion("1.2.3-beta", "1.0.0")).toBe(false);
    expect(isNewerVersion("2.0.0", "not-a-version")).toBe(false);
  });
});
