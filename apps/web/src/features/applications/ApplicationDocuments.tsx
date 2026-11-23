import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  DOCUMENT_AI_UNAVAILABLE_CODES,
  DOCUMENT_LANGUAGES,
  isCloudAiEndpoint,
  type DocumentLanguage,
  type ApplicationDocuments as ApplicationDocumentsRecord,
  type DocumentContent,
  type DocumentFailureCode,
  type DocumentIssue,
  type DocumentKind,
  type DocumentRecord,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
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
  /** Consent is asked when the provider is a cloud service. */
  cloud: boolean;
  provider: string;
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
 * The CV and cover letter of one application: generate them with the AI (after consent for a cloud
 * provider), edit the text, save it after the profile checks, and export a PDF. Nothing is sent to
 * an employer; the app never submits.
 */
export function ApplicationDocuments({ applicationId }: ApplicationDocumentsProps) {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [ai, setAi] = useState<AiState | null>(null);
  const [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState<DocumentLanguage>("en");
  const [drafts, setDrafts] = useState<Partial<Record<DocumentKind, Draft>>>({});
  const [busy, setBusy] = useState<{ kind: DocumentKind; action: Action } | null>(null);
  const [notices, setNotices] = useState<Partial<Record<DocumentKind, Notice>>>({});

  useEffect(() => {
    let active = true;
    void Promise.all([bridge.documents.get({ applicationId }), bridge.settings.get()]).then(
      ([documents, settings]) => {
        if (!active) return;
        const { ai: aiSettings } = settings;
        setAi({
          cloud: isCloudAiEndpoint(aiSettings),
          provider: aiSettings.provider,
          configured:
            aiSettings.model.trim() !== "" &&
            (aiSettings.provider !== "openai-compatible" || aiSettings.baseUrl.trim() !== ""),
        });
        setLanguage(documents.defaultLanguage.language);
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
  const providerName = ai === null ? "" : t(`settings.ai.providers.${ai.provider}`);
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

  async function generate(kind: DocumentKind) {
    setBusy({ kind, action: "generate" });
    setNotice(kind, null);
    try {
      const result = await bridge.documents.generate({ applicationId, kind, consent, language });
      if (result.ok) {
        applyRecord(result.document);
        setNotice(kind, { tone: "ok", text: t("applications.documents.generated") });
      } else {
        setNotice(kind, failureNotice(result.code));
      }
    } catch {
      setNotice(kind, failureNotice("unknown"));
    } finally {
      setBusy(null);
    }
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
      <h4 id="application-documents-title" className="text-sm font-medium text-app-fg">
        {t("applications.documents.heading")}
      </h4>
      <p className="text-sm text-app-muted">{t("applications.documents.intro")}</p>

      {ai !== null && (!ai.configured || ai.cloud) ? (
        <div className="flex flex-col gap-3 rounded-lg border border-app-border p-4">
          {!ai.configured ? (
            <>
              <p role="status" className="text-sm text-app-fg">
                {t("applications.documents.aiUnavailable")}
              </p>
              <Link to="/settings" className="text-sm text-app-accent underline">
                {t("applications.documents.openSettings")}
              </Link>
            </>
          ) : null}
          {ai.cloud && ai.configured ? (
            <>
              <p className="text-sm text-app-fg">
                {t("applications.documents.consentNote", { provider: providerName })}
              </p>
              <CheckboxInput
                label={t("applications.documents.consent", { provider: providerName })}
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
            </>
          ) : null}
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

      {(["cv", "cover-letter"] as const).map((kind) => {
        const record = records[kind];
        const draft = drafts[kind];
        const working = busy?.kind === kind;
        const notice = notices[kind];
        const needsConsent = ai !== null && ai.cloud && !consent;
        const generateDisabled = busy !== null || !ai?.configured || needsConsent;
        const stale =
          record !== null && record.exportedAt !== null && record.updatedAt > record.exportedAt;
        return (
          <section
            key={kind}
            aria-labelledby={`application-documents-${kind}`}
            className="flex flex-col gap-3 rounded-lg border border-app-border p-4"
          >
            <h5 id={`application-documents-${kind}`} className="text-sm font-medium text-app-fg">
              {t(`applications.documents.kinds.${kind}`)}
            </h5>
            {record === null ? (
              <p className="text-sm text-app-muted">{t("applications.documents.notGenerated")}</p>
            ) : (
              <>
                {record.language !== null ? (
                  <p className="text-sm text-app-muted">
                    {t("applications.documents.writtenIn", {
                      language: t(`applications.documents.language.options.${record.language}`),
                    })}
                  </p>
                ) : null}
                {record.exportedAt !== null ? (
                  <p className="text-sm text-app-muted">
                    {t("applications.documents.exportedAt", {
                      date: new Date(record.exportedAt).toLocaleString(),
                    })}
                  </p>
                ) : null}
                {stale ? (
                  <p className="text-sm text-app-fg">{t("applications.documents.stale")}</p>
                ) : null}
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
                    disabled={busy !== null || !draft}
                    onClick={() => void save(kind, record)}
                  >
                    {working && busy?.action === "save"
                      ? t("applications.documents.saving")
                      : t("applications.documents.save")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void exportPdf(kind)}
                  >
                    {working && busy?.action === "export"
                      ? t("applications.documents.exporting")
                      : t("applications.documents.export")}
                  </Button>
                  {record.exportedAt !== null ? (
                    <Button variant="secondary" onClick={() => void reveal(kind)}>
                      {t("applications.documents.reveal")}
                    </Button>
                  ) : null}
                </div>
              </>
            )}
            <div>
              <Button disabled={generateDisabled} onClick={() => void generate(kind)}>
                {working && busy?.action === "generate"
                  ? t("applications.documents.generating")
                  : record === null
                    ? t("applications.documents.generate")
                    : t("applications.documents.generateAgain")}
              </Button>
            </div>
            {notice ? (
              <div
                role={notice.tone === "error" ? "alert" : "status"}
                className="flex flex-col items-start gap-2"
              >
                <p className="text-sm text-app-fg">{notice.text}</p>
                {notice.aiUnavailable ? (
                  <Link to="/settings" className="text-sm text-app-accent underline">
                    {t("applications.documents.openSettings")}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </section>
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
              <legend className="text-sm font-medium text-app-fg">{title}</legend>
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
