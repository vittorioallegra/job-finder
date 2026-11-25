import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Badge } from "../../components/ui/Badge";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
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
        // The language the documents were written in wins over the default, so the choice is kept.
        const stored = documents.cv?.language ?? documents.coverLetter?.language ?? null;
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

  /** Starts writing the given documents. The run goes on if the user leaves; see `startGeneration`. */
  function generate(kinds: DocumentKind[]) {
    for (const kind of kinds) setNotice(kind, null);
    void startGeneration(bridge, applicationId, kinds, language);
  }

  /** A run that finished while this panel was open (or after it was reopened) shows its result. */
  function applyGeneration(state: GenerationState) {
    if (state.version <= seenVersion.current) return;
    seenVersion.current = state.version;
    for (const record of state.last?.records ?? []) {
      applyRecord(record);
      setNotice(record.kind, { tone: "ok", text: t("applications.documents.generated") });
    }
    if (state.last?.failure) {
      setNotice(state.last.failure.kind, failureNotice(state.last.failure.code));
    }
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

  async function save(kind: DocumentKind, record: DocumentRecord) {
    const draft = drafts[kind];
    if (!draft) return;
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
  }

  async function exportPdf(kind: DocumentKind) {
    setBusy({ kind, action: "export" });
    setNotice(kind, null);
    try {
      const result = await bridge.documents.exportPdf({ applicationId, kind });
      if (result.ok) {
        applyRecord(result.document);
        setNotice(kind, { tone: "ok", text: t("applications.documents.exported") });
      } else {
        setNotice(kind, failureNotice(result.code));
      }
    } catch {
      setNotice(kind, failureNotice("export-failed"));
    } finally {
      setBusy(null);
    }
  }

  async function reveal(kind: DocumentKind) {
    setNotice(kind, null);
    try {
      const shown = await bridge.documents.reveal({ applicationId, kind });
      if (!shown)
        setNotice(kind, { tone: "error", text: t("applications.documents.revealFailed") });
    } catch {
      setNotice(kind, { tone: "error", text: t("applications.documents.revealFailed") });
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
        onChange={(event) => setLanguage(event.target.value as DocumentLanguage)}
      />

      {records.cv === null && records["cover-letter"] === null ? (
        <div>
          <Button
            disabled={busy !== null || !ai?.configured}
            onClick={() => generate(["cv", "cover-letter"])}
          >
            {busy !== null
              ? t("applications.documents.generating")
              : t("applications.documents.generateBoth")}
          </Button>
        </div>
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
        const stale =
          record !== null && record.exportedAt !== null && record.updatedAt > record.exportedAt;
        return (
          <Card
            as="section"
            key={kind}
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
                <div className="flex flex-wrap items-center gap-2">
                  {record.language !== null ? (
                    <Badge>
                      {t("applications.documents.writtenIn", {
                        language: t(`applications.documents.language.options.${record.language}`),
                      })}
                    </Badge>
                  ) : null}
                  {record.exportedAt !== null ? (
                    <Badge tone="good">
                      {t("applications.documents.exportedAt", {
                        date: new Date(record.exportedAt).toLocaleString(),
                      })}
                    </Badge>
                  ) : null}
                  {stale ? <Badge tone="fair">{t("applications.documents.stale")}</Badge> : null}
                </div>
                {draft ? (
                  <DocumentEditor
                    draft={draft}
                    content={record.content}
                    onDraft={(next) => setDrafts((current) => ({ ...current, [kind]: next }))}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null || !draft}
                    onClick={() => void save(kind, record)}
                  >
                    {working && busy?.action === "save"
                      ? t("applications.documents.saving")
                      : t("applications.documents.save")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void exportPdf(kind)}
                  >
                    {working && busy?.action === "export"
                      ? t("applications.documents.exporting")
                      : t("applications.documents.export")}
                  </Button>
                  {record.exportedAt !== null ? (
                    <Button variant="secondary" size="sm" onClick={() => void reveal(kind)}>
                      {t("applications.documents.reveal")}
                    </Button>
                  ) : null}
                </div>
              </>
            )}
            <div className="flex justify-end border-t border-app-border pt-3">
              <Button size="sm" disabled={generateDisabled} onClick={() => generate([kind])}>
                {working && busy?.action === "generate"
                  ? t("applications.documents.generating")
                  : record === null
                    ? t("applications.documents.generate")
                    : t("applications.documents.generateAgain")}
              </Button>
            </div>
            {notice ? noticeView(notice) : null}
          </Card>
        );
      })}
    </section>
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
