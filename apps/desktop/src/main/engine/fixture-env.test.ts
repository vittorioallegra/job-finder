// protects=the fixture base-URL override reaches the engine only when the app is not packaged, and only when it points at loopback;
// fails_when=a packaged app keeps the override (with or without the E2E variable), a remote host is passed to the engine, or the rest of the environment is dropped;
// no_claim=the utility process receiving this environment is covered by the desktop E2E smoke, not here.
import { describe, expect, it } from "vitest";
import { engineEnvironment, FIXTURE_BASE_URL_ENV, isLoopbackHttpUrl } from "./fixture-env";

const base = { PATH: "/usr/bin", [FIXTURE_BASE_URL_ENV]: "http://127.0.0.1:4010" };

describe("engine environment", () => {
  it("keeps a loopback override in an unpackaged app", () => {
    expect(engineEnvironment(base, false)[FIXTURE_BASE_URL_ENV]).toBe("http://127.0.0.1:4010");
  });

  it("drops the override in a packaged app, even under the E2E harness", () => {
    expect(engineEnvironment(base, true)).not.toHaveProperty(FIXTURE_BASE_URL_ENV);
    const underE2e = { ...base, JOB_FINDER_E2E: "1" };
    expect(engineEnvironment(underE2e, true)).not.toHaveProperty(FIXTURE_BASE_URL_ENV);
  });

  it("drops an override that points anywhere but loopback", () => {
    const remote = { ...base, [FIXTURE_BASE_URL_ENV]: "https://jobs.example.test" };
    expect(engineEnvironment(remote, false)).not.toHaveProperty(FIXTURE_BASE_URL_ENV);
  });

  it("keeps the rest of the environment", () => {
    expect(engineEnvironment(base, true).PATH).toBe("/usr/bin");
  });

  it("accepts only http and https loopback hosts", () => {
    expect(isLoopbackHttpUrl("http://localhost:4010")).toBe(true);
    expect(isLoopbackHttpUrl("http://[::1]:4010")).toBe(true);
    expect(isLoopbackHttpUrl("ftp://127.0.0.1")).toBe(false);
    expect(isLoopbackHttpUrl("not a url")).toBe(false);
  });
});
