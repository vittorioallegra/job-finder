// protects=the app:// protocol serves only files inside the renderer build directory;
// fails_when=a relative, absolute, backslash or percent-encoded traversal path resolves outside rootDir;
// no_claim=MIME types, caching and the Electron protocol registration are not covered here.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppRequest } from "./app-protocol";

const root = resolve("/opt/job-finder/renderer");

describe("app:// request resolution", () => {
  it("serves the index page for the root path", () => {
    expect(resolveAppRequest(root, "app://renderer/")).toBe(resolve(root, "index.html"));
  });

  it("serves nested assets inside the root", () => {
    expect(resolveAppRequest(root, "app://renderer/assets/main.js")).toBe(
      resolve(root, "assets/main.js"),
    );
  });

  it.each([
    "app://renderer/..%2f..%2fsecret.txt",
    "app://renderer/..%5csecret.txt",
    "app://renderer/%2e%2e%5csecret.txt",
    "app://renderer/%00index.html",
  ])("rejects traversal attempt %s", (url) => {
    expect(resolveAppRequest(root, url)).toBeNull();
  });

  it("normalizes dot segments in the URL so they cannot leave the root", () => {
    const resolved = resolveAppRequest(root, "app://renderer/../secret.txt");
    expect(resolved).toBe(resolve(root, "secret.txt"));
  });

  it.each(["https://renderer/index.html", "app://evil/index.html", "not a url"])(
    "rejects foreign origin or malformed URL %s",
    (url) => {
      expect(resolveAppRequest(root, url)).toBeNull();
    },
  );
});
