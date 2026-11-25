import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, Loader2, Pencil } from "lucide-react";
import { Link } from "react-router";
import {
  DOCUMENT_AI_UNAVAILABLE_CODES,
  DOCUMENT_LANGUAGES,
  type DocumentLanguage,
  type ApplicationDocuments as ApplicationDocumentsRecord,
  type DocumentContent,
  type DocumentFailureCode,
  type DocumentIssue,
  type DocumentKind,
  type DocumentRecord,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import {
  startGeneration,
  useGeneration,
  type GenerationState,
} from "../../lib/document-generation";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { SelectInput } from "../../components/ui/SelectInput";
import { TextArea } from "../../components/ui/TextArea";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; documents: ApplicationDocumentsRecord };

/** The text a user edits: a CV's summary and bullets, or a letter's paragraphs. */
type Draft =
  | { kind: "cv"; summary: string; bullets: string[][] }
  | { kind: "cover-letter"; paragraphs: string[] };

type Action = "generate" | "save" | "export";

interface Notice {
  tone: "ok" | "error";
  text: string;
  /** The AI cannot be used now: the notice links to the AI settings. */
  aiUnavailable?: boolean;
}

interface AiState {
  /** A model (and, for a local endpoint, a base URL) is set up. */
  configured: boolean;
}

function draftOf(record: DocumentRecord): Draft {
  return record.content.kind === "cv"
    ? {
        kind: "cv",
        summary: record.content.cv.summary,
        bullets: record.content.cv.experience.map((entry) =>
          entry.bullets.map((bullet) => bullet.text),
        ),
      }
    : { kind: "cover-letter", paragraphs: record.content.letter.paragraphs };
}

/** The stored content with the user's edits applied. Blank bullets and paragraphs are dropped. */
function contentOf(record: DocumentRecord, draft: Draft): DocumentContent {
  if (record.content.kind === "cv" && draft.kind === "cv") {
    const cv = record.content.cv;
    return {
      kind: "cv",
      cv: {
        ...cv,
        summary: draft.summary.trim(),
        experience: cv.experience.map((entry, index) => ({
          ...entry,
          bullets: entry.bullets
            .map((bullet, bulletIndex) => ({
              ...bullet,
              text: (draft.bullets[index]?.[bulletIndex] ?? bullet.text).trim(),
            }))
            .filter((bullet) => bullet.text !== ""),
        })),
      },
    };
  }
  if (record.content.kind === "cover-letter" && draft.kind === "cover-letter") {
    return {
      kind: "cover-letter",
      letter: {
        paragraphs: draft.paragraphs
          .map((paragraph) => paragraph.trim())
          .filter((paragraph) => paragraph !== ""),
      },
    };
  }
  return record.content;
}

/** How long a word such as "PDF saved" stays next to its button. */
const FLASH_MS = 3000;

interface ApplicationDocumentsProps {
  applicationId: string;
}

/**
 * The CV and cover letter of one application: generate them with the AI, edit the text, save it after the profile checks, and export a PDF. Nothing is sent to
 * an employer; the app never submits.
 */
export function ApplicationDocuments({ applicationId }: ApplicationDocumentsProps) {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [ai, setAi] = useState<AiState | null>(null);
  const [language, setLanguage] = useState<DocumentLanguage>("en");
  const [drafts, setDrafts] = useState<Partial<Record<DocumentKind, Draft>>>({});
  const [localBusy, setBusy] = useState<{ kind: DocumentKind; action: Action } | null>(null);
  const generation = useGeneration(applicationId);
  // Results up to this version are already in the page (or were stored before it opened).
  const seenVersion = useRef(generation.version);
  const scrollTarget = useRef<DocumentKind | null>(null);
  const [previewing, setPreviewing] = useState<DocumentKind | null>(null);
  // A short word next to the button that was just used ("saved", "generated"), gone after a moment.
  const [flash, setFlash] = useState<{ kind: DocumentKind; word: "saved" | "generated" } | null>(
    null,
  );
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  const [editing, setEditing] = useState<DocumentKind | null>(null);
  const busy =
    generation.running !== null
      ? { kind: generation.running, action: "generate" as Action }
      : localBusy;
  const [notices, setNotices] = useState<Partial<Record<DocumentKind, Notice>>>({});

  useEffect(() => {
    let active = true;
    void Promise.all([bridge.documents.get({ applicationId }), bridge.settings.get()]).then(
      ([documents, settings]) => {
        if (!active) return;
        const { ai: aiSettings } = settings;
        setAi({
          configured:
            aiSettings.model.trim() !== "" &&
            (aiSettings.provider !== "openai-compatible" || aiSettings.baseUrl.trim() !== ""),
        });
        // The user's saved choice is the default here. Without one, the language the documents were
        // written in wins over the posting's and the UI's.
        const stored =
          documents.defaultLanguage.source === "chosen"
            ? null
            : (documents.cv?.language ?? documents.coverLetter?.language ?? null);
        setLanguage(stored ?? documents.defaultLanguage.language);
        setDrafts(
          Object.fromEntries(
            [documents.cv, documents.coverLetter]
              .filter((record): record is DocumentRecord => record !== null)
              .map((record) => [record.kind, draftOf(record)]),
          ),
        );
        setLoad({ status: "ready", documents });
      },
      () => {
        if (active) setLoad({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [bridge, applicationId, attempt]);

  if (load.status === "loading") {
    return (
      <p role="status" className="text-sm text-app-muted">
        {t("applications.documents.loading")}
      </p>
    );
  }
  if (load.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-app-fg">{t("applications.documents.loadFailed")}</p>
        <Button
          variant="secondary"
          onClick={() => {
            setLoad({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          {t("applications.retry")}
        </Button>
      </div>
    );
  }

  const { documents } = load;
  const languageOptions = DOCUMENT_LANGUAGES.map((code) => ({
    value: code,
    label: t(`applications.documents.language.options.${code}`),
  }));
  const records: Record<DocumentKind, DocumentRecord | null> = {
    cv: documents.cv,
    "cover-letter": documents.coverLetter,
  };

  function applyRecord(record: DocumentRecord) {
    setLoad((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            documents: {
              ...current.documents,
              ...(record.kind === "cv" ? { cv: record } : { coverLetter: record }),
            },
          }
        : current,
    );
    setDrafts((current) => ({ ...current, [record.kind]: draftOf(record) }));
  }

  function issueText(issue: DocumentIssue): string {
    return t(`applications.documents.issues.${issue.code}`);
  }

  function setNotice(kind: DocumentKind, notice: Notice | null) {
    setNotices((current) => {
      const next = { ...current };
      if (notice === null) delete next[kind];
      else next[kind] = notice;
      return next;
    });
  }

  function failureNotice(code: DocumentFailureCode): Notice {
    return {
      tone: "error",
      text: t(`applications.documents.failures.${code}`, {
        defaultValue: t("applications.documents.failures.unknown"),
      }),
      aiUnavailable: DOCUMENT_AI_UNAVAILABLE_CODES.includes(code),
    };
  }

  /** Says a word next to a button for a moment. */
  function showFlash(kind: DocumentKind, word: "saved" | "generated") {
    setFlash({ kind, word });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }

  /** Starts writing the given documents. The run goes on if the user leaves; see `startGeneration`. */
  function generate(kinds: DocumentKind[]) {
    for (const kind of kinds) setNotice(kind, null);
    void startGeneration(bridge, applicationId, kinds, language);
  }

  /** A run that finished while this panel was open (or after it was reopened) shows its result. */
  function applyGeneration(state: GenerationState) {
    if (state.version <= seenVersion.current) return;
    seenVersion.current = state.version;
    scrollTarget.current = state.last?.records[0]?.kind ?? null;
    for (const record of state.last?.records ?? []) {
      applyRecord(record);
    }
    const last = state.last?.records.at(-1);
    if (last) showFlash(last.kind, "generated");
    if (state.last?.failure) {
      setNotice(state.last.failure.kind, failureNotice(state.last.failure.code));
    }
  }

  /** What shows while a document is being written, in place of the button that started it. */
  function writingView(kind: DocumentKind) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-2xl bg-app-accent-soft p-4 text-sm text-app-fg"
      >
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        {t(`applications.documents.writing.${kind}`)}
      </p>
    );
  }

  /** Leaving the editor without saving drops the changes: the text goes back to what is stored. */
  function stopEditing(kind: DocumentKind) {
    const record = records[kind];
    if (record) setDrafts((current) => ({ ...current, [kind]: draftOf(record) }));
    setNotice(kind, null);
    setEditing(null);
  }

  function noticeView(notice: Notice) {
    return (
      <div
        role={notice.tone === "error" ? "alert" : "status"}
        className="flex flex-col items-start gap-2"
      >
        <p className={`text-sm ${notice.tone === "error" ? "text-app-danger" : "text-app-good"}`}>
          {notice.text}
        </p>
        {notice.aiUnavailable ? (
          <Link to="/settings" className={buttonClass("secondary", "sm")}>
            {t("applications.documents.openSettings")}
          </Link>
        ) : null}
      </div>
    );
  }

  /** Resolves true when the edits were stored. */
  async function save(kind: DocumentKind, record: DocumentRecord): Promise<boolean> {
    const draft = drafts[kind];
    if (!draft) return false;
    setBusy({ kind, action: "save" });
    setNotice(kind, null);
    try {
      const result = await bridge.documents.save({
        applicationId,
        content: contentOf(record, draft),
      });
      if (result.ok) {
        applyRecord(result.document);
        setNotice(kind, { tone: "ok", text: t("applications.documents.saved") });
        return true;
      } else if (result.code === "validation-failed") {
        setNotice(kind, {
          tone: "error",
          text: t("applications.documents.validationFailed", {
            issues: result.issues.map((issue) => issueText(issue)).join("; "),
          }),
        });
      } else {
        setNotice(kind, failureNotice(result.code));
      }
    } catch {
      setNotice(kind, failureNotice("unknown"));
    } finally {
      setBusy(null);
    }
    return false;
  }

  async function exportPdf(kind: DocumentKind) {
    setBusy({ kind, action: "export" });
    setNotice(kind, null);
    try {
      const result = await bridge.documents.exportPdf({ applicationId, kind });
      if (result.ok) {
        applyRecord(result.document);
        // Said next to the button for a moment only, then it goes away.
        showFlash(kind, "saved");
      } else if (result.code !== "cancelled") {
        // Closing the save dialog is not a failure: nothing is said.
        setNotice(kind, failureNotice(result.code));
      }
    } catch {
      setNotice(kind, failureNotice("export-failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="application-documents-title" className="flex flex-col gap-4">
      <OnChange value={generation} onChange={applyGeneration} />
      <h4
        id="application-documents-title"
        className="font-display text-xl font-semibold text-app-fg"
      >
        {t("applications.documents.heading")}
      </h4>
      <p className="text-sm text-app-muted">{t("applications.documents.intro")}</p>

      {ai !== null && !ai.configured ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-app-fair-soft p-4">
          <p role="status" className="text-sm text-app-fg">
            {t("applications.documents.aiUnavailable")}
          </p>
          <div>
            <Link to="/settings" className={buttonClass("secondary", "sm")}>
              {t("applications.documents.openSettings")}
            </Link>
          </div>
        </div>
      ) : null}

      <SelectInput
        label={t("applications.documents.language.label")}
        options={languageOptions}
        value={language}
        disabled={busy !== null}
        hint={t(`applications.documents.language.hint.${documents.defaultLanguage.source}`, {
          language: t(
            `applications.documents.language.options.${documents.defaultLanguage.language}`,
          ),
        })}
        onChange={(event) => {
          const picked = event.target.value as DocumentLanguage;
          if (picked === language) return;
          setLanguage(picked);
          // Saved at once, so it is still there when the user comes back. Documents written in
          // another language no longer fit, so they are removed (the service does it) and the
          // panel returns to "not generated".
          void bridge.documents
            .setLanguage({ applicationId, language: picked })
            .then((saved) => {
              if (!saved) return;
              setPreviewing(null);
              setEditing(null);
              setNotices({});
              setDrafts({});
              setLoad((current) =>
                current.status === "ready"
                  ? {
                      status: "ready",
                      documents: {
                        ...current.documents,
                        cv: null,
                        coverLetter: null,
                        defaultLanguage: { language: picked, source: "chosen" },
                      },
                    }
                  : current,
              );
            })
            .catch(() => {});
        }}
      />

      {records.cv === null && records["cover-letter"] === null ? (
        generation.running !== null ? (
          writingView(generation.running)
        ) : (
          <div>
            <Button
              disabled={busy !== null || !ai?.configured}
              onClick={() => generate(["cv", "cover-letter"])}
            >
              {t("applications.documents.generateBoth")}
            </Button>
          </div>
        )
      ) : null}
      {records.cv === null &&
      records["cover-letter"] === null &&
      (notices.cv ?? notices["cover-letter"])
        ? noticeView((notices.cv ?? notices["cover-letter"]) as Notice)
        : null}

      {(records.cv === null && records["cover-letter"] === null
        ? []
        : (["cv", "cover-letter"] as const)
      ).map((kind) => {
        const record = records[kind];
        const draft = drafts[kind];
        const working = busy?.kind === kind;
        const notice = notices[kind];
        const generateDisabled = busy !== null || !ai?.configured;
        return (
          <div
            key={kind}
            ref={(element) => {
              // A document that was just written comes into view, so the user sees what was done.
              if (element && scrollTarget.current === kind) {
                scrollTarget.current = null;
                element.scrollIntoView?.({ behavior: "smooth", block: "start" });
              }
            }}
          >
            <Card
              as="section"
              aria-labelledby={`application-documents-${kind}`}
              className="flex flex-col gap-3"
            >
              <CardTitle level={3} id={`application-documents-${kind}`}>
                {t(`applications.documents.kinds.${kind}`)}
              </CardTitle>
              {record === null ? (
                <p className="text-sm text-app-muted">{t("applications.documents.notGenerated")}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={generation.running === kind}
                      onClick={() => setPreviewing(kind)}
                    >
                      <Eye className="size-4" strokeWidth={1.8} aria-hidden="true" />
                      {t("applications.documents.preview")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null || !draft || generation.running === kind}
                      onClick={() => {
                        setNotice(kind, null);
                        setEditing(kind);
                      }}
                    >
                      <Pencil className="size-4" strokeWidth={1.8} aria-hidden="true" />
                      {t("applications.documents.edit")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null || generation.running === kind}
                      onClick={() => void exportPdf(kind)}
                    >
                      {working && busy?.action === "export"
                        ? t("applications.documents.exporting")
                        : t("applications.documents.export")}
                    </Button>
                    {flash?.kind === kind && flash.word === "saved" ? (
                      <span role="status" className="self-center text-sm text-app-good">
                        {t("applications.documents.exported")}
                      </span>
                    ) : null}
                  </div>
                </>
              )}
              <div className="flex items-center justify-end gap-3 border-t border-app-border pt-3">
                {generation.running === kind ? (
                  writingView(kind)
                ) : (
                  <>
                    {flash?.kind === kind && flash.word === "generated" ? (
                      <span role="status" className="text-sm text-app-good">
                        {t("applications.documents.generatedWord")}
                      </span>
                    ) : null}
                    <Button size="sm" disabled={generateDisabled} onClick={() => generate([kind])}>
                      {record === null
                        ? t("applications.documents.generate")
                        : t("applications.documents.generateAgain")}
                    </Button>
                  </>
                )}
              </div>
              {notice && editing !== kind ? noticeView(notice) : null}
            </Card>
          </div>
        );
      })}

      {previewing !== null && records[previewing] !== null ? (
        <Modal
          title={t("applications.documents.previewTitle", {
            kind: t(`applications.documents.kinds.${previewing}`),
          })}
          closeLabel={t("applications.documents.close")}
          wide
          onClose={() => setPreviewing(null)}
          footer={
            <Button variant="secondary" onClick={() => setPreviewing(null)}>
              {t("applications.documents.close")}
            </Button>
          }
        >
          <DocumentPreview
            applicationId={applicationId}
            kind={previewing}
            version={records[previewing]?.updatedAt ?? 0}
          />
        </Modal>
      ) : null}

      {editing !== null && records[editing] !== null && drafts[editing] ? (
        <Modal
          title={t("applications.documents.editTitle", {
            kind: t(`applications.documents.kinds.${editing}`),
          })}
          closeLabel={t("applications.documents.cancel")}
          onClose={() => stopEditing(editing)}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => stopEditing(editing)}
              >
                {t("applications.documents.cancel")}
              </Button>
              <Button
                disabled={busy !== null}
                onClick={() => {
                  const record = records[editing];
                  if (record) void save(editing, record).then((saved) => saved && setEditing(null));
                }}
              >
                {busy?.kind === editing && busy.action === "save"
                  ? t("applications.documents.saving")
                  : t("applications.documents.save")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-app-muted">{t("applications.documents.editIntro")}</p>
            <DocumentEditor
              draft={drafts[editing] as Draft}
              content={(records[editing] as DocumentRecord).content}
              onDraft={(next) => setDrafts((current) => ({ ...current, [editing]: next }))}
            />
            {notices[editing] ? noticeView(notices[editing] as Notice) : null}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/** The document as it will look in the PDF: the HTML it is printed from, shown on a white page. */
function DocumentPreview({
  applicationId,
  kind,
  version,
}: {
  applicationId: string;
  kind: DocumentKind;
  /** Changes when the document is edited, so the preview is read again. */
  version: number;
}) {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [state, setState] = useState<
    { status: "loading" } | { status: "failed" } | { status: "ready"; html: string }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    bridge.documents
      .preview({ applicationId, kind })
      .then((result) => {
        if (active)
          setState(result.ok ? { status: "ready", html: result.html } : { status: "failed" });
      })
      .catch(() => {
        if (active) setState({ status: "failed" });
      });
    return () => {
      active = false;
    };
  }, [bridge, applicationId, kind, version]);

  if (state.status === "loading") {
    return (
      <p role="status" className="text-sm text-app-muted">
        {t("applications.documents.previewLoading")}
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p role="alert" className="text-sm text-app-danger">
        {t("applications.documents.previewFailed")}
      </p>
    );
  }
  return (
    <iframe
      title={t("applications.documents.previewFrame")}
      // Nothing in the document runs: no scripts, no forms, no links followed.
      sandbox=""
      srcDoc={state.html}
      className="h-[70vh] w-full rounded-lg border border-app-border bg-[#d9d9d9]"
    />
  );
}

interface DocumentEditorProps {
  draft: Draft;
  content: DocumentContent;
  onDraft: (draft: Draft) => void;
}

/** The text fields of a document. Structure (employers, dates, degrees) is read-only: the profile sets it. */
function DocumentEditor({ draft, content, onDraft }: DocumentEditorProps) {
  const { t } = useTranslation();
  if (draft.kind === "cv" && content.kind === "cv") {
    return (
      <div className="flex flex-col gap-4">
        <TextArea
          label={t("applications.documents.summary")}
          value={draft.summary}
          maxLength={1200}
          onChange={(event) => onDraft({ ...draft, summary: event.target.value })}
        />
        {content.cv.experience.map((entry, index) => {
          const title = `${entry.title} — ${entry.company}`;
          return (
            <fieldset key={`${index}-${entry.company}`} className="flex flex-col gap-2">
              <legend className="text-[13px] font-semibold text-app-fg">{title}</legend>
              {(draft.bullets[index] ?? []).map((text, bulletIndex) => (
                <TextArea
                  key={bulletIndex}
                  label={t("applications.documents.bulletLabel", {
                    number: bulletIndex + 1,
                    title,
                  })}
                  value={text}
                  maxLength={500}
                  onChange={(event) => {
                    const bullets = draft.bullets.map((row) => [...row]);
                    bullets[index] = bullets[index] ?? [];
                    bullets[index][bulletIndex] = event.target.value;
                    onDraft({ ...draft, bullets });
                  }}
                />
              ))}
            </fieldset>
          );
        })}
        {content.cv.education.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm text-app-fg">
            <h6 className="font-medium">{t("applications.documents.education")}</h6>
            <ul className="list-disc pl-5">
              {content.cv.education.map((entry, index) => (
                <li key={index}>{`${entry.degree} — ${entry.institution}`}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {content.cv.skills.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm text-app-fg">
            <h6 className="font-medium">{t("applications.documents.skills")}</h6>
            <p>{content.cv.skills.map((skill) => skill.name).join(", ")}</p>
          </div>
        ) : null}
      </div>
    );
  }
  if (draft.kind === "cover-letter" && content.kind === "cover-letter") {
    return (
      <div className="flex flex-col gap-3">
        {draft.paragraphs.map((text, index) => (
          <TextArea
            key={index}
            label={t("applications.documents.paragraphLabel", { number: index + 1 })}
            value={text}
            maxLength={1200}
            onChange={(event) => {
              const paragraphs = [...draft.paragraphs];
              paragraphs[index] = event.target.value;
              onDraft({ ...draft, paragraphs });
            }}
          />
        ))}
      </div>
    );
  }
  return null;
}

/** Calls `onChange` with the value each time it changes (and once at the start). */
function OnChange<T>({ value, onChange }: { value: T; onChange: (value: T) => void }) {
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
}
