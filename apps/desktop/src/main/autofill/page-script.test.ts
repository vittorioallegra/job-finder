// @vitest-environment jsdom
// protects=the page scripts find the visible controls of each fixture form (honeypots and hidden text fields skipped, file controls kept), fill only the planned controls with native setters and input and change events, keep a value the user already typed, outline what is left and mark what the AI drafted apart from it, and never click, press a key or submit the form;
// fails_when=a honeypot or a value already typed is filled, a control the plan leaves for the user is filled, a hidden upload control is dropped, a fill throws or misses a planned control, the form is submitted or a button clicked, or a script contains a click, a key press or a submit call;
// no_claim=the fixtures are hand-written pages modeled on the public markup of Greenhouse, Lever and Ashby, not recorded from those services; jsdom has no layout, so geometry checks are covered by the Electron end-to-end test, not here;
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planAutofill, type AutofillSources, type FormField } from "@job-finder/core/ats/autofill";
import { emptyProfile, type Profile } from "@job-finder/core/profile";
import { discoverExpression, fillExpression, highlightExpression } from "./page-script";

const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): void {
  const parsed = new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, name), "utf8"),
    "text/html",
  );
  document.body.innerHTML = parsed.body.innerHTML;
}

function profile(): Profile {
  return {
    ...emptyProfile(),
    contact: {
      fullName: "Maria Rossi",
      email: "maria@example.com",
      phone: "+39 333 1234567",
      location: "Milano",
    },
    links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/maria" }],
    applicationDefaults: {
      workAuthorization: [],
      noticePeriod: "30 days",
      salary: { amount: 60000, currency: "EUR", period: "year" },
      willingToRelocate: true,
      pronouns: "she/her",
    },
    standardAnswers: [{ question: "Why do you want to work here?", answer: "I like the product." }],
  };
}

const SOURCES: AutofillSources = {
  profile: profile(),
  documents: { cv: true, "cover-letter": true },
};

/** Runs the page side of autofill the way the apply window does, and returns what it saw. */
function runPage(provider: Parameters<typeof planAutofill>[2], sources = SOURCES) {
  const fields = (0, eval)(discoverExpression("f0")) as FormField[];
  const plan = planAutofill(fields, sources, provider);
  const results = (0, eval)(
    fillExpression(plan.actions.filter((action) => action.kind !== "file")),
  ) as Array<{ id: string; ok: boolean }>;
  const highlighted = (0, eval)(
    highlightExpression(plan.unfilled.map((item) => item.id)),
  ) as number;
  return { fields, plan, results, highlighted };
}

function valueOf(selector: string): string {
  const control = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  return control.value;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("page scripts on the Greenhouse fixture", () => {
  it("fills the planned controls and leaves the honeypot, the question and the checkbox alone", () => {
    loadFixture("greenhouse.html");

    const { fields, plan, highlighted } = runPage("greenhouse");

    expect(fields.find((field) => field.honeypot)?.name).toBe("job_application[website]");
    expect(valueOf("#first_name")).toBe("Maria");
    expect(valueOf("#last_name")).toBe("Rossi");
    expect(valueOf("#email")).toBe("maria@example.com");
    expect(valueOf("#location")).toBe("Milano");
    expect(valueOf("#q_relocate")).toBe("Yes");
    expect(valueOf("#q_why")).toBe("I like the product.");
    expect(valueOf("#hp_site")).toBe("");
    expect(plan.unfilled.map((item) => item.label)).toEqual([
      "Describe a project you led end to end",
      "I agree to the privacy policy",
    ]);
    expect(highlighted).toBe(2);
    expect(document.querySelector("#q_project")?.hasAttribute("data-jf-unfilled")).toBe(true);
    expect(document.querySelector("#hp_site")?.hasAttribute("data-jf-unfilled")).toBe(false);
  });

  it("keeps a value the user already typed", () => {
    loadFixture("greenhouse.html");
    (document.querySelector("#first_name") as HTMLInputElement).value = "Typed";

    const { fields, plan } = runPage("greenhouse");

    const firstName = fields.find((field) => field.name === "job_application[first_name]");
    expect(valueOf("#first_name")).toBe("Typed");
    expect(plan.actions.map((action) => action.id)).not.toContain(firstName?.id);
  });

  it("reports a hidden file control to the plan, so the upload can reach it", () => {
    loadFixture("greenhouse.html");

    const { fields, plan } = runPage("greenhouse");

    const resume = fields.find((field) => field.name === "job_application[resume]");
    expect(resume).toMatchObject({ kind: "file", hasValue: false });
    expect(plan.actions).toContainEqual(expect.objectContaining({ kind: "file", document: "cv" }));
  });
});

describe("page scripts on the Lever fixture", () => {
  it("fills the mapped links and the name, and skips the hidden trap field", () => {
    loadFixture("lever.html");

    const { fields, plan } = runPage("lever");

    expect(valueOf("#name")).toBe("Maria Rossi");
    expect(valueOf("#linkedin")).toBe("https://www.linkedin.com/in/maria");
    expect(fields.find((field) => field.name === "website")?.honeypot).toBe(true);
    expect(valueOf("input[name='website']")).toBe("");
    expect(plan.unfilled.map((item) => item.label)).toEqual([
      "Current company",
      "GitHub URL",
      "Portfolio",
      "Additional information",
    ]);
  });
});

describe("page scripts on the Ashby fixture", () => {
  it("fills the system fields and the stored answer, and finds the hidden resume control", () => {
    loadFixture("ashby.html");

    const { fields, plan } = runPage("ashby");

    expect(valueOf("#ash-name")).toBe("Maria Rossi");
    expect(valueOf("#ash-email")).toBe("maria@example.com");
    expect(valueOf("#ash-why")).toBe("I like the product.");
    expect(valueOf("#ash-notice")).toBe("30 days");
    expect(fields.find((field) => field.name === "_systemfield_resume")?.kind).toBe("file");
    expect(plan.actions).toContainEqual(expect.objectContaining({ kind: "file", document: "cv" }));
  });
});

describe("page scripts on a generic fixture", () => {
  it("maps other labels to the profile and leaves the rest for the user", () => {
    loadFixture("generic.html");

    const { plan } = runPage("generic");

    expect(valueOf("#g-name")).toBe("Maria Rossi");
    expect(valueOf("#g-mail")).toBe("maria@example.com");
    expect(valueOf("#g-tel")).toBe("+39 333 1234567");
    expect(valueOf("#g-loc")).toBe("Milano");
    expect(valueOf("#g-salary")).toBe("60000");
    expect(valueOf("#g-notice")).toBe("30 days");
    expect(valueOf("#g-other")).toBe("");
    expect(plan.unfilled.map((item) => item.reason)).toEqual(
      expect.arrayContaining(["unmapped", "unsupported"]),
    );
  });
});

describe("page scripts never submit", () => {
  it.each(["greenhouse.html", "lever.html", "ashby.html", "generic.html"])(
    "leaves %s unsubmitted and its buttons unclicked",
    (name) => {
      loadFixture(name);
      const form = document.querySelector("form") as HTMLFormElement;
      const onSubmit = vi.fn((event: Event) => event.preventDefault());
      form.addEventListener("submit", onSubmit);
      const submit = vi.spyOn(HTMLFormElement.prototype, "submit");
      const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit");
      const onClick = vi.fn();
      document.querySelectorAll("button, input[type='submit']").forEach((button) => {
        button.addEventListener("click", onClick);
      });
      const onKey = vi.fn();
      document.addEventListener("keydown", onKey);

      runPage(name.replace(".html", "") as Parameters<typeof planAutofill>[2]);

      expect(onSubmit).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(requestSubmit).not.toHaveBeenCalled();
      expect(onClick).not.toHaveBeenCalled();
      expect(onKey).not.toHaveBeenCalled();
    },
  );

  it("contains no click, key press or submit call in any script", () => {
    const sources = [discoverExpression("f"), fillExpression([]), highlightExpression([])].join(
      "\n",
    );
    expect(sources).not.toMatch(
      /\.click\s*\(|\.submit\s*\(|requestSubmit|keydown|keypress|keyup|KeyboardEvent|MouseEvent|"Enter"/i,
    );
  });
});

describe("page highlight of AI drafts", () => {
  it("marks a drafted control apart from the controls left for the user", () => {
    loadFixture("generic.html");
    const fields = (0, eval)(discoverExpression("f0")) as FormField[];
    const draft = fields.find((field) => field.name === "applicant_other");
    const left = fields.find((field) => field.name === "applicant_auth");

    const count = (0, eval)(
      highlightExpression(left ? [left.id] : [], draft ? [draft.id] : []),
    ) as number;

    expect(count).toBe(1);
    expect(document.querySelector("#g-other")?.hasAttribute("data-jf-drafted")).toBe(true);
    expect(document.querySelector("#g-other")?.hasAttribute("data-jf-unfilled")).toBe(false);
    expect(document.querySelector("#g-auth")?.hasAttribute("data-jf-unfilled")).toBe(true);
    expect(document.querySelector("#g-auth")?.hasAttribute("data-jf-drafted")).toBe(false);
  });
});

describe("page scripts on a collapsed, clipped wrapper", () => {
  it("treats a text field inside a zero-height clipped block as a honeypot and fills only the visible one", () => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email</label><input id="email" name="email" type="email" />
        <div style="height: 0; overflow: hidden">
          <label for="work_email">Work email</label><input id="work_email" name="work_email" type="email" />
        </div>
      </form>`;

    const { fields } = runPage("generic");

    expect(fields.find((field) => field.name === "work_email")?.honeypot).toBe(true);
    expect(valueOf("#work_email")).toBe("");
    expect(valueOf("#email")).toBe("maria@example.com");
  });
});
