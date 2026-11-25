// protects=the documents panel shows loading, error and AI-unavailable states, generates both documents with one button, keeps writing after the panel closes, writes the history (in preparation, then ready), empties the documents when the language changes, shows cards with Preview, Edit and Save PDF (a brief "PDF saved"), edits in a dialog, previews in a sandboxed frame, keeps Preview, Edit and Save PDF off while writing, says "Generated" briefly next to the button, lets the CV and the letter be written at the same time without touching each other's buttons, and names every AI failure;
// fails_when=a run stops when the panel closes, the history misses a step, a language change keeps old documents, "PDF saved" stays for ever, the card shows loose fields or a tag, cancelling the editor keeps changes, the preview can run scripts, a refused save is hidden, Preview stays active while writing, "Generated" stays for ever or sits under the button, writing one document disables the other's buttons, or an AI failure lacks the settings link;
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
    defaultLanguage: { language: "en", source: "default" },
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
    (node) => node.textContent === "Language",
  );
  const control = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!(control instanceof HTMLSelectElement)) throw new Error("no language select");
  return control;
}

/** A button of the open dialog, which is rendered outside the panel's container. */
function dialogButton(text: string): HTMLButtonElement {
  const dialog = document.querySelector("[role=dialog]");
  const found = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no dialog button ${text}`);
  return found;
}

function textareaLabelled(container: HTMLElement, text: string): HTMLTextAreaElement {
  const label = [
    ...(document.querySelector("[role=dialog]") ?? container).querySelectorAll("label"),
  ].find((node) => node.textContent === text);
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
      setLanguage: vi.fn(async () => true),
      save: vi.fn(async () => ({ ok: false as const, code: "not-found" as const })),
      exportPdf: vi.fn(async () => ({ ok: false as const, code: "export-failed" as const })),
      preview: vi.fn(async () => ({ ok: true as const, html: "<html><body>CV</body></html>" })),
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

  it("saves the language the user picks at once, and shows a saved choice when reopened", async () => {
    const setLanguage = vi.fn(async () => true);
    await render(bridgeWith({ setLanguage }));
    await act(async () => {
      const select = languageSelect(container);
      select.value = "it";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setLanguage).toHaveBeenCalledWith({ applicationId: "a1", language: "it" });

    await act(async () => root.render(<div />));
    await render(
      bridgeWith({
        get: vi.fn(async () =>
          documentsOf({ defaultLanguage: { language: "it", source: "chosen" } }),
        ),
      }),
    );
    expect(languageSelect(container).value).toBe("it");
    expect(container.textContent).toContain("Your choice for this application.");
  });

  it("shows the language a stored document was written in, not the default, when the panel is reopened", async () => {
    await render(
      bridgeWith({
        get: vi.fn(async () =>
          documentsOf({
            coverLetter: coverLetter("Ciao.", { language: "it" }),
            defaultLanguage: { language: "en", source: "default" },
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
    // Visible feedback while it works, not only a disabled button.
    expect(container.querySelector("[role=status]")?.textContent).toContain("Writing your CV");

    // The user leaves: the panel goes away, but the run is not tied to it.
    await act(async () => root.render(<div />));
    await act(async () => pending.shift()?.());
    await act(async () => {});
    expect(generate).toHaveBeenCalledTimes(2);

    // Back on the application while the letter is still being written.
    await render(bridge);
    // The writing message takes the place of the button, so there is no second "Generating" button.
    expect(() => button(container, "Generate CV and cover letter")).toThrow();
    expect(container.querySelector("[role=status]")?.textContent).toContain(
      "Writing your cover letter",
    );

    await act(async () => pending.shift()?.());
    await act(async () => {});
    expect(container.textContent).toContain("Generated");
    expect(button(container, "Preview")).toBeTruthy();
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

  it("shows no tag under a document, and no export date", async () => {
    await render(
      bridgeWith({
        get: vi.fn(async () =>
          documentsOf({
            coverLetter: coverLetter("Ciao.", { language: "it", exportedAt: 30, updatedAt: 50 }),
          }),
        ),
      }),
    );

    expect(container.textContent).not.toContain("Written in");
    expect(container.textContent).not.toContain("Last PDF export");
    expect(container.textContent).not.toContain("older than");
  });

  it("empties the documents when the language changes, and offers to write them again", async () => {
    const setLanguage = vi.fn(async () => true);
    await render(
      bridgeWith({
        get: vi.fn(async () =>
          documentsOf({ cv: cvRecord(), coverLetter: coverLetter("Hi there.") }),
        ),
        setLanguage,
      }),
    );
    expect(button(container, "Preview")).toBeTruthy();

    await act(async () => {
      const select = languageSelect(container);
      select.value = "it";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {});

    expect(setLanguage).toHaveBeenCalledWith({ applicationId: "a1", language: "it" });
    expect(() => button(container, "Preview")).toThrow();
    expect(button(container, "Generate CV and cover letter")).toBeTruthy();
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

    // The card shows buttons, not a pile of fields.
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    await act(async () => button(container, "Edit").click());

    const paragraph = textareaLabelled(container, "Paragraph 1");
    expect(paragraph.value).toBe("Hi there.");
    await act(async () => type(paragraph, "Edited."));
    await act(async () => dialogButton("Save changes").click());

    expect(save).toHaveBeenCalledWith({
      applicationId: "a1",
      content: { kind: "cover-letter", letter: { paragraphs: ["Edited."] } },
    });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(container.textContent).toContain("Changes saved.");
  });

  it("drops the edits when the editor is cancelled", async () => {
    const save = vi.fn();
    await render(
      bridgeWith({
        get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Hi there.") })),
        save,
      }),
    );
    await act(async () => button(container, "Edit").click());
    await act(async () => type(textareaLabelled(container, "Paragraph 1"), "Typed, then dropped."));
    await act(async () => dialogButton("Cancel").click());
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(save).not.toHaveBeenCalled();

    await act(async () => button(container, "Edit").click());
    expect(textareaLabelled(container, "Paragraph 1").value).toBe("Hi there.");
  });

  it("opens a preview of the document as it will print, in a sandboxed frame", async () => {
    const preview = vi.fn(async () => ({
      ok: true as const,
      html: "<html><body>Maria Rossi</body></html>",
    }));
    await render(
      bridgeWith({
        get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Hi there.") })),
        preview,
      }),
    );
    await act(async () => button(container, "Preview").click());
    await act(async () => {});

    expect(preview).toHaveBeenCalledWith({ applicationId: "a1", kind: "cover-letter" });
    const frame = document.querySelector("[role=dialog] iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("Maria Rossi");
    // Sandboxed with no permissions: nothing in the document runs.
    expect(frame.getAttribute("sandbox")).toBe("");

    await act(async () => dialogButton("Close").click());
    expect(document.querySelector("[role=dialog]")).toBeNull();
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

    await act(async () => button(container, "Edit").click());
    await act(async () => dialogButton("Save changes").click());

    // The refusal is told inside the editor, which stays open.
    const dialogText = document.querySelector("[role=dialog]")?.textContent ?? "";
    expect(dialogText).toContain("Some text does not match your profile");
    expect(dialogText).toContain("a skill is not in your profile");
    expect(dialogText).not.toContain("Changes saved.");
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

  it("saves the PDF through the system dialog, and says nothing when the user closes the dialog", async () => {
    const exportPdf = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, document: coverLetter("Hi.", { exportedAt: 30 }) })
      .mockResolvedValueOnce({ ok: false, code: "cancelled" });
    await render(
      bridgeWith({
        get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Hi.") })),
        exportPdf,
      }),
    );

    await act(async () => button(container, "Save PDF…").click());
    expect(exportPdf).toHaveBeenCalledWith({ applicationId: "a1", kind: "cover-letter" });
    expect(container.textContent).toContain("PDF saved.");

    await act(async () => button(container, "Save PDF…").click());
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).not.toContain("could not be exported");
  });

  it("says the PDF was saved next to the button for a moment only", async () => {
    vi.useFakeTimers();
    try {
      await render(
        bridgeWith({
          get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Hi.") })),
          exportPdf: vi.fn(async () => ({
            ok: true as const,
            document: coverLetter("Hi.", { exportedAt: 30 }),
          })),
        }),
      );
      await act(async () => button(container, "Save PDF…").click());
      expect(container.textContent).toContain("PDF saved.");

      await act(async () => {
        vi.advanceTimersByTime(3500);
      });
      expect(container.textContent).not.toContain("PDF saved.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Preview, Edit and Save PDF off while a document is being written, and says Generated next to the button for a moment", async () => {
    vi.useFakeTimers();
    try {
      let finish: () => void = () => {};
      const generate = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ ok: true as const, document: coverLetter("New text.") });
          }),
      );
      await render(
        bridgeWith({
          get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Old text.") })),
          generate: generate as never,
        }),
      );
      await act(async () => button(container, "Generate again").click());

      for (const name of ["Preview", "Edit"]) {
        // The button stays out of the way while its document is being rewritten.
        expect(button(container, name).disabled).toBe(true);
      }
      expect(button(container, "Save PDF…").disabled).toBe(true);

      await act(async () => finish());
      await act(async () => {});
      expect(button(container, "Preview").disabled).toBe(false);
      const row = button(container, "Generate again").parentElement;
      expect(row?.textContent).toContain("Generated");
      expect(container.textContent).not.toContain("Review the text");

      await act(async () => {
        vi.advanceTimersByTime(3500);
      });
      expect(container.textContent).not.toContain("Generated");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the other document alone while one is being written, and lets both be written at once", async () => {
    const finishers: Record<string, () => void> = {};
    const generate = vi.fn(
      ({ kind }: { kind: string }) =>
        new Promise((resolve) => {
          finishers[kind] = () =>
            resolve({
              ok: true as const,
              document: kind === "cv" ? cvRecord() : coverLetter("New letter."),
            });
        }),
    );
    const update = vi.fn(async (_request: { applicationId: string; status: string }) => ({
      ok: true as const,
    }));
    const base = bridgeWith({
      get: vi.fn(async () => documentsOf({ cv: cvRecord(), coverLetter: coverLetter("Old.") })),
      generate: generate as never,
    });
    const bridge = {
      ...base,
      applications: { ...base.applications, update },
    } as unknown as JobFinderBridge;
    await render(bridge);

    const cards = () =>
      [...container.querySelectorAll("section")].filter((node) =>
        node.getAttribute("aria-labelledby")?.startsWith("application-documents-"),
      );
    const inCard = (kind: string, name: string) => {
      const card = cards().find(
        (node) => node.getAttribute("aria-labelledby") === `application-documents-${kind}`,
      );
      const found = [...(card?.querySelectorAll("button") ?? [])].find(
        (node) => node.textContent?.trim() === name,
      );
      if (!found) throw new Error(`no ${name} in ${kind}`);
      return found;
    };

    // Rewrite the CV: only the CV's own buttons are off.
    await act(async () => inCard("cv", "Generate again").click());
    expect(inCard("cv", "Preview").disabled).toBe(true);
    expect(inCard("cover-letter", "Preview").disabled).toBe(false);
    expect(inCard("cover-letter", "Edit").disabled).toBe(false);
    expect(inCard("cover-letter", "Save PDF…").disabled).toBe(false);
    expect(inCard("cover-letter", "Generate again").disabled).toBe(false);

    // The letter can be rewritten at the same time, by its own run.
    await act(async () => inCard("cover-letter", "Generate again").click());
    expect(generate).toHaveBeenCalledTimes(2);
    expect(inCard("cover-letter", "Edit").disabled).toBe(true);

    // "Ready" goes into the history once, when the last run is over.
    await act(async () => finishers["cv"]?.());
    await act(async () => {});
    expect(update.mock.calls.map(([request]) => request.status)).toEqual(["preparing"]);
    await act(async () => finishers["cover-letter"]?.());
    await act(async () => {});
    expect(update.mock.calls.map(([request]) => request.status)).toEqual(["preparing", "ready"]);
  });

  it("records the work in the history: in preparation when writing starts, ready when it is done", async () => {
    const update = vi.fn(async (_request: { applicationId: string; status: string }) => ({
      ok: true as const,
    }));
    const base = bridgeWith({
      generate: vi.fn(async () => ({ ok: true as const, document: coverLetter("Hi.") })),
    });
    const bridge = {
      ...base,
      applications: { ...base.applications, update },
    } as unknown as JobFinderBridge;
    await render(bridge);

    await act(async () => button(container, "Generate CV and cover letter").click());
    await act(async () => {});

    expect(update.mock.calls.map(([request]) => request.status)).toEqual(["preparing", "ready"]);
  });

  it("reports a failed export", async () => {
    await render(
      bridgeWith({
        get: vi.fn(async () => documentsOf({ coverLetter: coverLetter("Hi.") })),
        exportPdf: vi.fn(async () => ({ ok: false as const, code: "export-failed" as const })),
      }),
    );

    await act(async () => button(container, "Save PDF…").click());
    expect(container.textContent).toContain("The PDF could not be exported.");
  });
});
