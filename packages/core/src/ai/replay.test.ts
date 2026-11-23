// protects=record/replay fetch returns the recorded body for a matching request, redacts secrets before recording, and fails loudly on an unrecorded request;
// fails_when=a request with a different body replays the wrong answer, a secret survives into a recording, or an unknown request returns an empty success;
// no_claim=the fixtures match only the method, path and body, so header changes and streaming responses are not covered.
import { describe, expect, it } from "vitest";
import { createRecordingFetch, createReplayFetch, fixtureKey, type FixtureEntry } from "./replay";

const url = "https://api.example.test/v1/chat/completions";

describe("fixture keys", () => {
  it("ignores the host but not the body", () => {
    const body = '{"model":"m"}';
    expect(fixtureKey("POST", url, body)).toBe(
      fixtureKey("POST", "http://localhost:9/v1/chat/completions", body),
    );
    expect(fixtureKey("POST", url, body)).not.toBe(fixtureKey("POST", url, '{"model":"n"}'));
  });
});

describe("replay fetch", () => {
  it("returns the recorded status and body for a matching request", async () => {
    const body = '{"prompt":"hi"}';
    const entries: FixtureEntry[] = [
      {
        key: fixtureKey("POST", url, body),
        method: "POST",
        path: "/v1/chat/completions",
        status: 200,
        body: '{"ok":true}',
      },
    ];
    const replay = createReplayFetch(entries);
    const response = await replay(url, { method: "POST", body });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
  });

  it("throws naming the path when no recording matches", async () => {
    const replay = createReplayFetch([]);
    await expect(replay(url, { method: "POST", body: "{}" })).rejects.toThrow(
      "No recorded response for POST /v1/chat/completions",
    );
  });
});

describe("recording fetch", () => {
  it("records each exchange with the secret removed from the body", async () => {
    const recorded: FixtureEntry[] = [];
    const secret = "sk-test-secret-value";
    const upstream: typeof fetch = async () =>
      new Response(`{"error":"bad key ${secret}"}`, { status: 401 });
    const recording = createRecordingFetch({
      upstream,
      redact: [secret],
      onRecord: (entry) => recorded.push(entry),
    });

    const response = await recording(url, { method: "POST", body: '{"prompt":"hi"}' });

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("[redacted]");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.body).not.toContain(secret);
    expect(recorded[0]?.key).toBe(fixtureKey("POST", url, '{"prompt":"hi"}'));
  });
});
