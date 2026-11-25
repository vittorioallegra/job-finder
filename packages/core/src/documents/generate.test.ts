// protects=generateDocument returns a document only after it passes the profile checks, adds back a job or a degree the model left out, sets small drifts right from the profile instead of rejecting the answer, retries once with the rules broken when nothing usable is left, reports an answer still unusable as invalid-output, maps provider failures to their codes, and asks for the text in the language it is given;
// fails_when=a CV without the latest job or the degree, an invented employer, date, skill or number reaches the result, a drifted answer is rejected instead of corrected, the retry omits the broken rules, a second unusable answer is accepted, a provider rejection is reported as invalid-output, more than two answers are requested, or the prompt names another language than the one given;
// no_claim=every provider answer is a scripted double, not a live model; the quality of real output is not shown;
import { describe, expect, it } from "vitest";
import type { AiProviderConfig } from "../ai/provider";
import { emptyProfile, type Profile } from "../profile/schema";
import { generateDocument, type GenerateDocumentInput } from "./generate";

const config: AiProviderConfig = {
  provider: "openai-compatible",
  model: "local-test",
  baseUrl: "http://localhost:1234/v1",
  apiKey: null,
};

function profile(): Profile {
  return {
    ...emptyProfile(),
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
  };
}

function input(overrides: Partial<GenerateDocumentInput> = {}): GenerateDocumentInput {
  return {
    kind: "cv",
    profile: profile(),
    job: { title: "Backend Engineer", companyName: "Globex", description: "APIs." },
    language: "en",
    config,
    contextSize: 8192,
    ...overrides,
  };
}

const VALID_CV = {
  summary: "Engineer who cut latency.",
  experience: [
    {
      source: 0,
      company: "Acme",
      title: "Engineer",
      location: "Milano",
      startDate: "2019",
      endDate: "2024",
      bullets: [{ source: 0, text: "Cut latency by 40%" }],
    },
  ],
  education: [],
  skills: [],
};

function chatCompletion(content: string, status = 200): Response {
  const body =
    status === 200
      ? {
          id: "chatcmpl-test",
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

/** Records each request body and answers with the scripted responses in order. */
function scriptedFetch(answers: Array<() => Response>) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const next = answers[bodies.length - 1];
    if (!next) {
      throw new Error("unexpected extra request");
    }
    return next();
  };
  return { fetchImpl, bodies };
}

describe("generateDocument", () => {
  it("returns a CV whose facts pass the profile check, after one call", async () => {
    const { fetchImpl, bodies } = scriptedFetch([() => chatCompletion(JSON.stringify(VALID_CV))]);

    const outcome = await generateDocument(input(), { fetch: fetchImpl });

    expect(outcome).toEqual({
      ok: true,
      content: { kind: "cv", cv: VALID_CV },
      warnings: [],
    });
    expect(bodies).toHaveLength(1);
  });

  it("sets a drifted CV right from the profile instead of rejecting it, after one call", async () => {
    const drifted = {
      ...VALID_CV,
      summary: "Engineer for 25 years. Cut latency.",
      experience: [
        {
          ...VALID_CV.experience[0]!,
          company: "Initech",
          endDate: "2024-12",
          bullets: [{ source: 0, text: "Cut latency by 90%" }],
        },
      ],
      skills: [{ source: 5, name: "Invented" }],
    };
    const { fetchImpl, bodies } = scriptedFetch([() => chatCompletion(JSON.stringify(drifted))]);

    const outcome = await generateDocument(input(), { fetch: fetchImpl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.content.kind !== "cv") return;
    const entry = outcome.content.cv.experience[0];
    expect(entry).toMatchObject({ company: "Acme", endDate: "2024" });
    expect(entry?.bullets).toEqual([{ source: 0, text: "Cut latency by 40%" }]);
    expect(outcome.content.cv.summary).toBe("Cut latency.");
    expect(outcome.content.cv.skills).toEqual([]);
    expect(bodies).toHaveLength(1);
  });

  it("adds back a job and a degree the model left out, even when its answer is otherwise valid", async () => {
    const twoJobs: Profile = {
      ...profile(),
      experience: [
        {
          company: "Globex",
          title: "Lead",
          location: "Roma",
          startDate: "2024",
          endDate: "present",
          bullets: ["Led the platform team"],
        },
        ...profile().experience,
      ],
      education: [
        {
          institution: "Politecnico",
          degree: "MSc Computer Science",
          grade: "",
          startDate: "2014",
          endDate: "2019",
        },
      ],
    };
    // The model keeps only the older job (source 1) and no degree.
    const answer = {
      ...VALID_CV,
      experience: [{ ...VALID_CV.experience[0]!, source: 1 }],
    };
    const { fetchImpl, bodies } = scriptedFetch([() => chatCompletion(JSON.stringify(answer))]);

    const outcome = await generateDocument(input({ profile: twoJobs }), { fetch: fetchImpl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.content.kind !== "cv") return;
    expect(outcome.content.cv.experience.map((entry) => entry.company)).toEqual(["Globex", "Acme"]);
    expect(outcome.content.cv.experience[0]?.endDate).toBe("present");
    expect(outcome.content.cv.education.map((entry) => entry.degree)).toEqual([
      "MSc Computer Science",
    ]);
    expect(bodies).toHaveLength(1);
  });

  it("sends the rules back once when a letter has nothing left after the repair, and accepts a corrected answer", async () => {
    const { fetchImpl, bodies } = scriptedFetch([
      () => chatCompletion(JSON.stringify({ paragraphs: ["I have 25 years of experience."] })),
      () => chatCompletion(JSON.stringify({ paragraphs: ["I cut latency by 40% at Acme."] })),
    ]);

    const outcome = await generateDocument(input({ kind: "cover-letter" }), { fetch: fetchImpl });

    expect(outcome.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain("paragraphs.0: numbers-not-in-profile");
  });

  it("reports invalid-output when the retry leaves nothing either, and makes no third call", async () => {
    const invented = { paragraphs: ["I have 25 years of experience."] };
    const { fetchImpl, bodies } = scriptedFetch([
      () => chatCompletion(JSON.stringify(invented)),
      () => chatCompletion(JSON.stringify(invented)),
    ]);

    const outcome = await generateDocument(input({ kind: "cover-letter" }), { fetch: fetchImpl });

    expect(outcome).toEqual({ ok: false, code: "invalid-output" });
    expect(bodies).toHaveLength(2);
  });

  it("checks a cover letter against the profile's numbers", async () => {
    const letter = { paragraphs: ["I have 25 years of experience."] };
    const fixed = { paragraphs: ["I cut latency by 40% at Acme."] };
    const { fetchImpl } = scriptedFetch([
      () => chatCompletion(JSON.stringify(letter)),
      () => chatCompletion(JSON.stringify(fixed)),
    ]);

    const outcome = await generateDocument(input({ kind: "cover-letter" }), { fetch: fetchImpl });

    expect(outcome).toEqual({
      ok: true,
      content: { kind: "cover-letter", letter: fixed },
      warnings: [],
    });
  });

  it("asks for the text in the language given, and reads Italian numbers against the profile", async () => {
    const profileWithNumbers: Profile = {
      ...profile(),
      summary: "Led a team of 1,000 users.",
    };
    const letter = { paragraphs: ["Ho guidato un team per 1.000 utenti."] };
    const { fetchImpl, bodies } = scriptedFetch([() => chatCompletion(JSON.stringify(letter))]);

    const outcome = await generateDocument(
      input({ kind: "cover-letter", language: "it", profile: profileWithNumbers }),
      { fetch: fetchImpl },
    );

    expect(outcome).toEqual({ ok: true, content: { kind: "cover-letter", letter }, warnings: [] });
    expect(bodies[0]).toContain("Write all free text in Italian");
  });

  it("maps a rejected key to invalid-key without a retry", async () => {
    const { fetchImpl, bodies } = scriptedFetch([() => chatCompletion("", 401)]);

    const outcome = await generateDocument(input(), { fetch: fetchImpl });

    expect(outcome).toEqual({ ok: false, code: "invalid-key" });
    expect(bodies).toHaveLength(1);
  });

  it("maps a missing base URL to not-configured before any request", async () => {
    const { fetchImpl, bodies } = scriptedFetch([]);

    const outcome = await generateDocument(input({ config: { ...config, baseUrl: "" } }), {
      fetch: fetchImpl,
    });

    expect(outcome).toEqual({ ok: false, code: "not-configured" });
    expect(bodies).toHaveLength(0);
  });
});
