// protects=the renderer CSP forbids remote origins in production, so the UI can never go online;
// fails_when=a production directive allows a remote host, a wildcard, or drops default-src 'none';
// no_claim=CSP delivery through the session header is checked by the E2E smoke test, not here.
import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./csp";

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(" ");
      return [name ?? "", values.join(" ")];
    }),
  );
}

describe("renderer content security policy", () => {
  it("denies everything by default and allows only the app origin in production", () => {
    const policy = directives(buildContentSecurityPolicy({ development: false }));
    expect(policy.get("default-src")).toBe("'none'");
    expect(policy.get("connect-src")).toBe("'self'");
    expect(policy.get("script-src")).toBe("'self'");
    expect(buildContentSecurityPolicy({ development: false })).not.toMatch(/https?:|\*/);
  });

  it("allows only localhost websockets and http in development", () => {
    const policy = buildContentSecurityPolicy({ development: true });
    expect(policy).toContain("ws://localhost:*");
    expect(policy).not.toMatch(/https:/);
  });
});
