// protects=only absolute http and https URLs are accepted as pages, same-origin means same scheme and host, and subresources may load only over web and data schemes;
// fails_when=a file, app or javascript URL is accepted as a page, a different host counts as the same origin, or a file: subresource is allowed;
// no_claim=how Chromium resolves redirects and frames is not exercised here; the hardened window test covers the wiring.
import { describe, expect, it } from "vitest";
import { isAllowedSubresource, isSameOrigin, parsePageUrl } from "./policy";

describe("page loader policy", () => {
  it("accepts absolute http and https URLs as pages and nothing else", () => {
    expect(parsePageUrl("https://jobs.example.test/careers")?.href).toBe(
      "https://jobs.example.test/careers",
    );
    expect(parsePageUrl("http://127.0.0.1:4010/x")?.port).toBe("4010");
    expect(parsePageUrl("file:///etc/hosts")).toBeUndefined();
    expect(parsePageUrl("app://renderer/index.html")).toBeUndefined();
    expect(parsePageUrl("javascript:alert(1)")).toBeUndefined();
    expect(parsePageUrl("not a url")).toBeUndefined();
    expect(parsePageUrl(42)).toBeUndefined();
  });

  it("compares scheme and host, and the port", () => {
    expect(isSameOrigin("https://jobs.example.test/a", "https://jobs.example.test")).toBe(true);
    expect(isSameOrigin("https://other.example.test/a", "https://jobs.example.test")).toBe(false);
    expect(isSameOrigin("http://jobs.example.test/a", "https://jobs.example.test")).toBe(false);
    expect(isSameOrigin("http://127.0.0.1:4011/a", "http://127.0.0.1:4010")).toBe(false);
  });

  it("allows web and data subresources and refuses local file and custom schemes", () => {
    expect(isAllowedSubresource("https://cdn.example.test/app.js")).toBe(true);
    expect(isAllowedSubresource("data:image/png;base64,AAAA")).toBe(true);
    expect(isAllowedSubresource("file:///Users/someone/secret.txt")).toBe(false);
    expect(isAllowedSubresource("app://renderer/index.html")).toBe(false);
    expect(isAllowedSubresource("not a url")).toBe(false);
  });
});
