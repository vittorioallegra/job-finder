// protects=the written review is asked for with the profile as data and without contact details, in the language given, parsed into a summary and suggestions, an example that brings a number the profile lacks is dropped, and provider failures map to their codes;
// fails_when=contact details reach the provider, the language named in the prompt differs from the one given, an invented number survives in an example, an invalid reply is accepted, or a rejection is reported as a review;
// no_claim=every provider reply is a scripted double, not a live model; the quality of the advice is not shown;
import { describe, expect, it } from "vitest";
import type { AiProviderConfig } from "../ai/provider";
import { guardReview, reviewProfileWithAi } from "./review-ai";
import { emptyProfile, type Profile } from "./schema";

const config: AiProviderConfig = {
  provider: "openai-compatible",
  model: "local-test",
  baseUrl: "http://localhost:1234/v1",
  apiKey: null,
};

function profile(): Profile {
  return {
    ...emptyProfile(),
    headline: "Backend engineer",
    contact: {
      fullName: "Maria Rossi",
      email: "maria.secret@example.com",
      phone: "+39 333 1234567",
      location: "Milano",
    },
    experience: [
      {
        company: "Acme",
        title: "Engineer",
        location: "Milano",
        startDate: "2019",
        endDate: "2024",
        bullets: ["Cut latency by 40%"],
      },
    ],
    preferences: { ...emptyProfile().preferences, roles: ["Backend Engineer"] },
  } as Profile;
}

function completion(content: string, status = 200): Response {
  const body =
    status === 200
      ? {
          id: "c",
          object: "chat.completion",
          created: 0,
          model: "local-test",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
      : { error: { message: "provider secret detail" } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function scripted(answers: Array<() => Response>) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const next = answers[bodies.length - 1];
    if (!next) throw new Error("unexpected extra request");
    return next();
  };
  return { fetchImpl, bodies };
}

const REVIEW = {
  summary: "A focused backend profile with one measured result.",
  suggestions: [
    {
      section: "experience",
      title: "Add scale to the Acme role",
      advice: "The only bullet gives a latency figure; say what the service handled.",
      example: "Cut latency by 40% on the services I owned.",
    },
    {
      section: "summary",
      title: "Write a summary",
      advice: "There is none: two sentences naming your stack and your target roles.",
      example: "Served 5000 users with it.",
    },
  ],
};

describe("profile review with the AI", () => {
  it("sends the profile as data without contact details, in the language given, and returns the review with invented numbers dropped from examples", async () => {
    const { fetchImpl, bodies } = scripted([() => completion(JSON.stringify(REVIEW))]);

    const outcome = await reviewProfileWithAi(
      { profile: profile(), language: "it", config, contextSize: 8192 },
      { fetch: fetchImpl },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.review.suggestions[0]?.example).toBe(
      "Cut latency by 40% on the services I owned.",
    );
    expect(outcome.review.suggestions[1]?.example).toBe("");
    expect(bodies).toHaveLength(1);
    const sent = bodies[0] ?? "";
    expect(sent).not.toContain("maria.secret@example.com");
    expect(sent).not.toContain("+39 333");
    expect(sent).toContain("Cut latency by 40%");
    expect(sent).toContain("Backend Engineer");
    expect(sent).toContain("Write in Italian");
  });

  it("reports a reply that breaks the schema as invalid-output and a rejected key without echoing the provider", async () => {
    const broken = scripted([
      () => completion(JSON.stringify({ summary: "x", suggestions: [{ section: "nonsense" }] })),
      () => completion(JSON.stringify({ summary: "x", suggestions: [{ section: "nonsense" }] })),
    ]);
    expect(
      await reviewProfileWithAi(
        { profile: profile(), language: "en", config, contextSize: 8192 },
        { fetch: broken.fetchImpl },
      ),
    ).toEqual({ ok: false, code: "invalid-output" });

    const rejected = scripted([() => completion("", 401)]);
    const outcome = await reviewProfileWithAi(
      { profile: profile(), language: "en", config, contextSize: 8192 },
      { fetch: rejected.fetchImpl },
    );
    expect(outcome).toEqual({ ok: false, code: "invalid-key" });
    expect(JSON.stringify(outcome)).not.toContain("secret");
  });

  it("keeps an example whose numbers are all the profile's own", () => {
    const kept = guardReview(
      {
        summary: "s",
        suggestions: [
          { section: "experience", title: "t", advice: "a", example: "Cut latency by 40%." },
        ],
      },
      profile(),
    );
    expect(kept.suggestions[0]?.example).toBe("Cut latency by 40%.");
  });
});
