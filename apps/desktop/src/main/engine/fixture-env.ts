/** Env-guarded override that points engine HTTP at a local fixture server. */
export const FIXTURE_BASE_URL_ENV = "JOB_FINDER_FIXTURE_BASE_URL";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * The environment the engine process gets. The fixture override is kept only in an unpackaged app
 * and only when it points at loopback; otherwise it is removed. A packaged app never honours it,
 * not even under the E2E harness: the packaged smoke test does not use fixtures.
 */
export function engineEnvironment(env: NodeJS.ProcessEnv, isPackaged: boolean): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  delete result[FIXTURE_BASE_URL_ENV];
  const value = env[FIXTURE_BASE_URL_ENV];
  if (!isPackaged && value && isLoopbackHttpUrl(value)) {
    result[FIXTURE_BASE_URL_ENV] = value;
  }
  return result;
}
