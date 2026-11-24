// protects=a CV extraction keeps the CV when one value is off: links without a scheme gain https://, over-long values are cut, an invalid email or a nameless skill is dropped, and the schema sent to the model still requires every key;
// fails_when=a link like linkedin.com/in/x, a long bullet or a bad email makes the whole import fail, a non-address is kept as a link, a section left out by a plain JSON model fails, or the model is free to omit the name and email;
// no_claim=the model's own reading of a CV is not checked here; a live run against Ollama covered it once.
import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import {
  CvExtractionDraftSchema,
  PROFILE_LIMITS,
  normalizeCvExtraction,
  normalizeCvLink,
} from "./schema";

describe("CV extraction", () => {
  it("adds https:// to a link written without it, and drops what is no web address", () => {
    expect(normalizeCvLink("linkedin.com/in/giulia")).toBe("https://linkedin.com/in/giulia");
    expect(normalizeCvLink(" www.site.dev ")).toBe("https://www.site.dev");
    expect(normalizeCvLink("http://site.dev/a")).toBe("http://site.dev/a");
    expect(normalizeCvLink("GitHub")).toBeNull();
    expect(normalizeCvLink("mailto:me@site.dev")).toBeNull();
    expect(normalizeCvLink("")).toBeNull();
  });

  it("repairs a draft into a valid extraction instead of refusing it", () => {
    const draft = CvExtractionDraftSchema.parse({
      contact: { fullName: " Giulia ", email: "not-an-email" },
      experience: [{ company: "Acme", bullets: ["x".repeat(900), "  "] }],
      skills: [{ name: "TypeScript" }, { name: "  " }],
      links: [
        { label: "LinkedIn", url: "linkedin.com/in/giulia" },
        { label: "Handle", url: "@giulia" },
      ],
    });
    const extraction = normalizeCvExtraction(draft);
    expect(extraction.contact).toEqual({ fullName: "Giulia", email: "", phone: "", location: "" });
    expect(extraction.experience[0]?.bullets).toHaveLength(1);
    expect(extraction.experience[0]?.bullets[0]).toHaveLength(PROFILE_LIMITS.bulletText);
    expect(extraction.skills.map((skill) => skill.name)).toEqual(["TypeScript"]);
    expect(extraction.links).toEqual([
      { label: "LinkedIn", url: "https://linkedin.com/in/giulia" },
    ]);
    expect(extraction.education).toEqual([]);
  });

  it("asks the model for every key, while a section left out still parses", () => {
    const schema = zodSchema(CvExtractionDraftSchema).jsonSchema as {
      required?: string[];
      properties: Record<string, { required?: string[] }>;
    };
    expect(schema.required).toEqual(
      expect.arrayContaining(["contact", "headline", "experience", "skills", "links"]),
    );
    expect(schema.properties.contact?.required).toEqual(
      expect.arrayContaining(["fullName", "email"]),
    );
    expect(CvExtractionDraftSchema.parse({ headline: "Dev" }).experience).toEqual([]);
  });
});
