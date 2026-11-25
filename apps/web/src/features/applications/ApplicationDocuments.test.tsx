// protects=the documents panel shows loading, error and AI-unavailable states, sends a generate call without any consent step also for a cloud provider, shows a generated document as editable text, reports a save that breaks the profile by its issues, exports a PDF and offers to reveal it, names every AI failure under its own message, starts from the posting's language with the user's pick sent to generation, generates both documents with one button, keeps writing after the panel is closed and shows the run and its result when it is reopened, and shows the language the stored documents were written in;
// fails_when=a generate call needs a consent the user cannot give here, an AI failure is shown without the settings link, a refused save is reported as saved, an export without a file is reported as exported, the panel shows a blank page on a failed read, a run stops when the panel closes, a reopened panel shows the default instead of the language of the stored documents, or the posting's language is ignored or the user's choice is not sent;
// no_claim=the layout, the real bridge and the PDF itself are not checked here; the desktop service and PDF tests cover the rules and the file;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  type ApplicationDocuments as ApplicationDocumentsRecord,
  type AppSettings,
  type DocumentRecord,
  type JobFinderBridge,
} from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { ApplicationDocuments } from "./ApplicationDocuments";

const cloudSettings = {
  ...DEFAULT_APP_SETTINGS,
  ai: { provider: "anthropic" as const, model: "claude-test", baseUrl: "", contextSize: 8192 },
};

const localSettings = {
  ...DEFAULT_APP_SETTINGS,
  ai: {
    provider: "openai-compatible" as const,
    model: "local-model",
    baseUrl: "http://localhost:11434/v1",
    contextSize: 8192,
  },
};

function coverLetter(text: string, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    kind: "cover-letter",
    content: { kind: "cover-letter", letter: { paragraphs: [text] } },
    language: "en",
    updatedAt: 10,
    exportedAt: null,
    ...overrides,
  };
}

function cvRecord(): DocumentRecord {
  return {
    kind: "cv",
    content: {
      kind: "cv",
      cv: {
        summary: "Backend engineer.",
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
        skills: [{ source: 0, name: "TypeScript" }],
      },
    },
    language: "en",
    updatedAt: 10,
    exportedAt: null,
  };
}

function documentsOf(
  overrides: Partial<ApplicationDocumentsRecord> = {},
): ApplicationDocumentsRecord {
  return {
    applicationId: "a1",
    cv: null,
    coverLetter: null,
    defaultLanguage: { language: "en", source: "ui" },
    ...overrides,
  };
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

function languageSelect(container: HTMLElement): HTMLSelectElement {
  const label = [...container.querySelectorAll("label")].find(
    (node) => node.textContent === "Document language",
  );
  const control = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!(control instanceof HTMLSelectElement)) throw new Error("no language select");
  return control;
}

function textareaLabelled(container: HTMLElement, text: string): HTMLTextAreaElement {
  const label = [...container.querySelectorAll("label")].find((node) => node.textContent === text);
  const control = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!(control instanceof HTMLTextAreaElement)) throw new Error(`no textarea ${text}`);
  return control;
}

/** Sets a controlled field's value the way typing does, so React sees the change. */
function type(field: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function bridgeWith(
  documents: Partial<JobFinderBridge["documents"]>,
  settings: AppSettings = localSettings,
): JobFinderBridge {
  const base = createMemoryBridge({ settings });
  return {
    ...base,
    documents: {
      get: vi.fn(async () => documentsOf()),
      generate: vi.fn(async () => ({ ok: false as const, code: "unknown" as const })),
      save: vi.fn(async () => ({ ok: false as const, code: "not-found" as const })),
      exportPdf: vi.fn(async () => ({ ok: false as const, code: "export-failed" as const })),
      reveal: vi.fn(async () => true),
      ...documents,
    },
  };
}

describe("application documents panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(bridge: JobFinderBridge) {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <ApplicationDocuments applicationId="a1" />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
  }

  it("shows the loading state, then a not-generated state for each document", async () => {
    let resolveGet: (value: ApplicationDocumentsRecord) => void = () => {};
    const bridge = bridgeWith({
      get: vi.fn(
        () => new Promise<ApplicationDocumentsRecord>((resolve) => (resolveGet = resolve)),
      ),
    });
    await render(bridge);
    expect(container.textContent).toContain("Loading documents");

    await act(async () => resolveGet(documentsOf()));

    expect(button(container, "Generate CV and cover letter")).toBeTruthy();
    expect(container.textContent).not.toContain("Not generated yet.");
  });

  it("shows an error with a retry when the documents cannot be read", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(documentsOf());
    await render(bridgeWith({ get }));

    expect(container.textContent).toContain("The documents could not be read.");
    await act(async () => button(container, "Try again").click());
    await act(async () => {});
    expect(button(container, "Generate CV and cover letter")).toBeTruthy();
  });

  it("shows AI unavailable and disables generation when no model is set up", async () => {
    await render(bridgeWith({}, { ...localSettings, ai: { ...localSettings.ai, model: "" } }));

    expect(container.textContent).toContain("AI unavailable");
    expect(button(container, "Generate CV and cover letter").disabled).toBe(true);
  });

  it("generates the CV and then the letter with one button, for a cloud provider too, without a consent step", async () => {
    const kinds: string[] = [];
    const generate = vi.fn(async (request: { kind: string }) => {
      kinds.push(request.kind);
      return { ok: true as const, document: coverLetter("Hi.") };
    });
    await render(bridgeWith({ generate }, cloudSettings));
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();

    await act(async () => button(container, "Generate CV and cover letter").click());
    await act(async () => {});

    expect(kinds).toEqual(["cv", "cover-letter"]);
    expect(generate).toHaveBeenCalledWith({ applicationId: "a1", kind: "cv", language: "en" });
  });

  it("shows the language a stored document was written in, not the default, when the panel is reopened", async () => {
    await render(
      bridgeWith({
        get: vi.fn(async () =>
          documentsOf({
            coverLetter: coverLetter("Ciao.", { language: "it" }),
            defaultLanguage: { language: "en", source: "ui" },
          }),
        ),
      }),
    );
    expect(languageSelect(container).value).toBe("it");
  });

  it("keeps writing after the panel is closed, shows the run when it is reopened, and then its result", async () => {
    const pending: Array<() => void> = [];
    const generate = vi.fn(
      ({ kind }: { kind: string }) =>
        new Promise((resolve) => {
          pending.push(() =>
            resolve({
              ok: true as const,
              document: kind === "cv" ? { ...cvRecord() } : coverLetter("Dear team, hello there."),
            }),
          );
        }),
    );
    const bridge = bridgeWith({ generate: generate as never });

    await render(bridge);
    await act(async () => button(container, "Generate CV and cover letter").click());
    expect(generate).toHaveBeenCalledTimes(1);

    // The user leaves: the panel goes away, but the run is not tied to it.
    await act(async () => root.render(<div />));
    await act(async () => pending.shift()?.());
    await act(async () => {});
    expect(generate).toHaveBeenCalledTimes(2);

    // Back on the application while the letter is still being written.
    await render(bridge);
    expect(button(container, "Generating…").disabled).toBe(true);

    await act(async () => pending.shift()?.());
    await act(async () => {});
    expect(container.textContent).toContain("Dear team, hello there.");
  });

  it("shows the posting's language as the default, and sends the language the user picks", async () => {
    const generate = vi.fn(async () => ({ ok: true as const, document: coverLetter("Ciao.") }));
    await render(
      bridgeWith({
        get: vi.fn(async () =>
          documentsOf({ defaultLanguage: { language: "it", source: "posting" } }),
        ),
        generate,
      }),
    );

    const select = languageSelect(container);
    expect(select.value).toBe("it");
    expect(container.textContent).toContain("Default: Italiano, the language of the posting.");

    await act(async () => {
      select.value = "en";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(container, "Generate CV and cover letter").click());

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ kind: "cv", language: "en" }));
  });

  it("says which language a stored document is written in", async () => {
    await render(
      bridgeWith({
        get: vi.fn(async () =>
          documentsOf({ coverLetter: coverLetter("Ciao.", { language: "it" }) }),
        ),
      }),
    );

    expect(container.textContent).toContain("Written in Italiano.");
  });

  it("shows a generated letter as editable text and reports the saved change", async () => {
    const save = vi.fn(async () => ({
      ok: true as const,
      document: coverLetter("Edited.", { updatedAt: 20 }),
    }));
    await render(
      bridgeWith({
        get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Hi there.") })),
        save,
      }),
    );

    const paragraph = textareaLabelled(container, "Paragraph 1");
    expect(paragraph.value).toBe("Hi there.");
    await act(async () => type(paragraph, "Edited."));
    await act(async () => button(container, "Save changes").click());

    expect(save).toHaveBeenCalledWith({
      applicationId: "a1",
      content: { kind: "cover-letter", letter: { paragraphs: ["Edited."] } },
    });
    expect(container.textContent).toContain("Changes saved.");
  });

  it("names the facts a refused save breaks, and does not report it as saved", async () => {
    await render(
      bridgeWith({
        get: vi.fn(async () => documentsOf({ cv: cvRecord() })),
        save: vi.fn(async () => ({
          ok: false as const,
          code: "validation-failed" as const,
          issues: [{ code: "skill-name" as const, path: "skills.0" }],
        })),
      }),
    );

    await act(async () => button(container, "Save changes").click());

    expect(container.textContent).toContain("Some text does not match your profile");
    expect(container.textContent).toContain("a skill is not in your profile");
    expect(container.textContent).not.toContain("Changes saved.");
  });

  it("links an AI failure to the settings, and shows a retryable failure without the link", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "invalid-key" })
      .mockResolvedValueOnce({ ok: false, code: "invalid-output" });
    await render(bridgeWith({ generate }));

    await act(async () => button(container, "Generate CV and cover letter").click());
    expect(container.textContent).toContain("the provider rejected the API key");
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);

    await act(async () => button(container, "Generate CV and cover letter").click());
    expect(container.textContent).toContain("did not return a document that matches your profile");
    expect(container.querySelectorAll('a[href="/settings"]').length).toBe(0);
  });

  it("exports the PDF, then offers to show it, which opens the file", async () => {
    const exportPdf = vi.fn(async () => ({
      ok: true as const,
      document: coverLetter("Hi.", { exportedAt: 30 }),
    }));
    const reveal = vi.fn(async () => true);
    await render(
      bridgeWith({
        get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Hi.") })),
        exportPdf,
        reveal,
      }),
    );

    await act(async () => button(container, "Export PDF").click());
    expect(exportPdf).toHaveBeenCalledWith({ applicationId: "a1", kind: "cover-letter" });
    expect(container.textContent).toContain("PDF exported.");

    await act(async () => button(container, "Show PDF in folder").click());
    expect(reveal).toHaveBeenCalledWith({ applicationId: "a1", kind: "cover-letter" });
  });

  it("reports a failed export, and offers no reveal before a PDF exists", async () => {
    await render(
      bridgeWith({
        get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Hi.") })),
        exportPdf: vi.fn(async () => ({ ok: false as const, code: "export-failed" as const })),
      }),
    );

    expect(
      [...container.querySelectorAll("button")].some(
        (node) => node.textContent === "Show PDF in folder",
      ),
    ).toBe(false);
    await act(async () => button(container, "Export PDF").click());
    expect(container.textContent).toContain("The PDF could not be exported.");
  });
});
