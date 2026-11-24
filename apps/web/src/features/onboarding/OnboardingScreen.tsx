import { useAiConsent } from "../../lib/useAiConsent";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileUp, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import {
  CV_UPLOAD_MAX_BYTES,
  SETTING_LIMITS,
  emptyProfile,
  aiConsentTarget,
  isCloudAiEndpoint,
  type AppSettings,
  type CvImportFailureCode,
  type CvImportWarning,
  type JobFinderBridge,
  type SecretsStatus,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
import { AiConnectionTest, SecretField } from "../settings/AiControls";
import { AiProviderFields } from "../settings/AiProviderFields";
import {
  aiChoiceFromSettings,
  aiSettingsFromChoice,
  type AiChoiceFields,
  contextSizeFor,
  defaultContextSize,
} from "../settings/provider-choice";
import { draftFromExtraction, draftFromProfile, type ProfileDraft } from "../profile/profile-draft";
import { ProfileEditor } from "../profile/ProfileEditor";

type Step = "ai" | "cv" | "review";
const STEPS: readonly Step[] = ["ai", "cv", "review"];

/** Failures of the CV file itself or of the consent gate. Every other code is an AI failure. */
const FILE_FAILURE_CODES: readonly CvImportFailureCode[] = [
  "unsupported-type",
  "too-large",
  "unreadable",
  "empty-document",
  "consent-required",
];

/** Setup in order: AI provider with a test, then the CV, then a review of the extracted profile. */
export function OnboardingScreen() {
  const { t } = useTranslation();
  const bridge = useBridge();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [step, setStep] = useState<Step>("ai");
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(emptyProfile()));
  const [warnings, setWarnings] = useState<CvImportWarning[]>([]);

  useEffect(() => {
    let active = true;
    bridge.settings
      .get()
      .then((next) => {
        if (active) {
          setSettings(next);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  function retry() {
    setLoadFailed(false);
    void bridge.settings
      .get()
      .then(setSettings)
      .catch(() => setLoadFailed(true));
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <PageHeader title={t("onboarding.title")} />

      <ol
        aria-label={t("onboarding.steps.label")}
        className="flex flex-wrap items-center gap-3 text-sm"
      >
        {STEPS.map((name, index) => {
          const active = name === step;
          const done = STEPS.indexOf(step) > index;
          return (
            <li
              key={name}
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-2 ${active ? "font-semibold text-app-fg" : "text-app-muted"}`}
            >
              <span
                aria-hidden="true"
                className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${
                  active
                    ? "bg-app-accent text-app-accent-fg"
                    : done
                      ? "bg-app-good-soft text-app-good"
                      : "bg-app-sunken text-app-muted"
                }`}
              >
                {index + 1}
              </span>
              {t(`onboarding.steps.${name}`)}
              {index < STEPS.length - 1 ? (
                <span aria-hidden="true" className="ml-1 h-px w-8 bg-app-border" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {loadFailed ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-danger">{t("onboarding.loadFailed")}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            {t("onboarding.retry")}
          </Button>
        </div>
      ) : null}

      {!loadFailed && settings === null ? (
        <p role="status" className="text-app-muted">
          {t("onboarding.loading")}
        </p>
      ) : null}

      {settings !== null && step === "ai" ? (
        <AiStep
          bridge={bridge}
          settings={settings}
          onSaved={setSettings}
          onContinue={() => setStep("cv")}
        />
      ) : null}

      {settings !== null && step === "cv" ? (
        <CvStep
          bridge={bridge}
          settings={settings}
          onImported={(nextDraft, nextWarnings) => {
            setDraft(nextDraft);
            setWarnings(nextWarnings);
            setStep("review");
          }}
          onManual={() => {
            setDraft(draftFromProfile(emptyProfile()));
            setWarnings([]);
            setStep("review");
          }}
          onBack={() => setStep("ai")}
        />
      ) : null}

      {settings !== null && step === "review" ? (
        <section aria-labelledby="onboarding-review" className="flex flex-col gap-4">
          <h2 id="onboarding-review" className="text-2xl font-semibold text-app-fg">
            {t("onboarding.review.title")}
          </h2>
          <p className="text-app-muted">{t("onboarding.review.intro")}</p>
          {warnings.some((warning) => warning.code === "context-exceeded") ? (
            <p role="note" className="rounded-xl bg-app-fair-soft p-3 text-sm text-app-fg">
              {t("onboarding.review.contextWarning")}
            </p>
          ) : null}
          <ProfileEditor
            initialDraft={draft}
            // The draft from the CV or the empty one is not stored yet: it can be saved as it is.
            stored={false}
            // With roles to look for, setup ends on the jobs list, which starts the company search.
            onSaved={(record) =>
              navigate(record.profile.preferences.roles.length > 0 ? "/jobs?discover=1" : "/")
            }
          />
          <div>
            <Button variant="ghost" onClick={() => setStep("cv")}>
              <ArrowLeft aria-hidden className="size-4" />
              {t("onboarding.back")}
            </Button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

interface AiStepProps {
  bridge: JobFinderBridge;
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
  onContinue: () => void;
}

/** Saves the provider, model and endpoint, then the key. Continue unlocks only once the settings are saved. */
function AiStep({ bridge, settings, onSaved, onContinue }: AiStepProps) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<AiChoiceFields>(() => ({
    choice: aiChoiceFromSettings(settings.ai),
    model: settings.ai.model,
    baseUrl: settings.ai.baseUrl,
  }));
  // Kept as typed, like the settings form; a hosted provider's size never carries to a server.
  const [contextSize, setContextSize] = useState(() =>
    String(contextSizeFor(aiChoiceFromSettings(settings.ai), settings.ai.contextSize)),
  );
  const [secrets, setSecrets] = useState<SecretsStatus | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<"idle" | "saving" | "saved" | "error" | "invalid">("idle");

  useEffect(() => {
    let active = true;
    bridge.secrets
      .status()
      .then((status) => {
        if (active) {
          setSecrets(status);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bridge]);

  const changeFields = useCallback(
    (next: AiChoiceFields) => {
      // Each provider starts from its own context size, as in Settings.
      if (next.choice !== fields.choice) setContextSize(String(defaultContextSize(next.choice)));
      setFields(next);
      setDirty(true);
    },
    [fields.choice],
  );

  const changeContextSize = useCallback((value: string) => {
    setContextSize(value);
    setDirty(true);
  }, []);

  async function saveFields(): Promise<boolean> {
    const typed = Number(contextSize);
    if (
      !Number.isInteger(typed) ||
      typed < SETTING_LIMITS.contextSizeMin ||
      typed > SETTING_LIMITS.contextSizeMax
    ) {
      setMessage("invalid");
      return false;
    }
    setMessage("saving");
    try {
      const next = await bridge.settings.update({
        ai: {
          ...aiSettingsFromChoice(fields),
          contextSize: contextSizeFor(fields.choice, typed),
        },
      });
      setDirty(false);
      setMessage("saved");
      onSaved(next);
      return true;
    } catch {
      setMessage("error");
      return false;
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveFields();
  }

  return (
    <Card as="section" aria-labelledby="onboarding-ai" className="flex flex-col gap-4">
      <CardTitle id="onboarding-ai">{t("onboarding.ai.title")}</CardTitle>
      <p className="text-app-muted">{t("onboarding.ai.intro")}</p>
      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        <AiProviderFields
          bridge={bridge}
          value={fields}
          onChange={changeFields}
          contextSize={contextSize}
          onContextSize={changeContextSize}
          isKeySet={(name) => secrets?.keys[name] ?? false}
          keyField={(name) =>
            secrets !== null ? (
              <SecretField
                key={name}
                bridge={bridge}
                name={name}
                label={t("settings.ai.apiKey")}
                secrets={secrets}
                onStatus={setSecrets}
              />
            ) : null
          }
        />
        <div className="flex items-center justify-end gap-3">
          <p
            role="status"
            className={`text-sm ${message === "error" || message === "invalid" ? "text-app-danger" : message === "saved" ? "text-app-good" : "text-app-muted"}`}
          >
            {message === "saved" ? t("onboarding.ai.saved") : null}
            {message === "error" ? t("onboarding.ai.saveFailed") : null}
            {message === "invalid" ? t("settings.invalid") : null}
          </p>
          <Button type="submit" variant="secondary" disabled={message === "saving"}>
            {message === "saving" ? t("onboarding.ai.saving") : t("onboarding.ai.save")}
          </Button>
        </div>
      </form>
      <AiConnectionTest
        bridge={bridge}
        saveChanges={() => (dirty ? saveFields() : Promise.resolve(true))}
      />
      <div className="flex justify-end border-t border-app-border pt-4">
        <Button onClick={onContinue} disabled={dirty || message === "saving"}>
          {t("onboarding.ai.continue")}
        </Button>
      </div>
    </Card>
  );
}

interface CvStepProps {
  bridge: JobFinderBridge;
  settings: AppSettings;
  onImported: (draft: ProfileDraft, warnings: CvImportWarning[]) => void;
  onManual: () => void;
  onBack: () => void;
}

type CvState =
  { status: "idle" } | { status: "importing" } | { status: "failed"; code: CvImportFailureCode };

/** Picks a CV, asks for consent when the provider is a cloud service, and imports it into a draft. */
function CvStep({ bridge, settings, onImported, onManual, onBack }: CvStepProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const { consent, consentTarget, setConsent } = useAiConsent(aiConsentTarget(settings.ai));
  const [state, setState] = useState<CvState>({ status: "idle" });
  const cloud = isCloudAiEndpoint(settings.ai);
  const providerKey =
    settings.ai.provider === "openai-compatible" ? "openaiCompatible" : settings.ai.provider;
  const providerName = t(`settings.ai.providers.${providerKey}`);
  const importing = state.status === "importing";
  const canImport = file !== null && (!cloud || consent) && !importing;

  // Leaving this step while the CV is read stops the import, so the model does not keep working.
  const importingRef = useRef(false);
  useEffect(() => {
    importingRef.current = importing;
  }, [importing]);
  useEffect(
    () => () => {
      if (importingRef.current) void bridge.profile.cancelImport().catch(() => undefined);
    },
    [bridge],
  );

  function stopImport() {
    // Cancelled here already: leaving the step right after must not cancel a second time.
    importingRef.current = false;
    void bridge.profile.cancelImport().catch(() => undefined);
    setState({ status: "idle" });
  }

  function back() {
    if (importing) stopImport();
    onBack();
  }

  async function runImport() {
    if (file === null) {
      return;
    }
    if (file.size > CV_UPLOAD_MAX_BYTES) {
      setState({ status: "failed", code: "too-large" });
      return;
    }
    setState({ status: "importing" });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await bridge.profile.importCv({
        fileName: file.name,
        bytes,
        consent,
        consentTarget,
      });
      if (result.ok) {
        onImported(draftFromExtraction(result.extraction, emptyProfile()), result.warnings);
      } else if (result.code === "cancelled") {
        // Stopped by the user, who already sees the step as it was before the import.
        setState({ status: "idle" });
      } else {
        setState({ status: "failed", code: result.code });
      }
    } catch {
      setState({ status: "failed", code: "unknown" });
    }
  }

  return (
    <Card as="section" aria-labelledby="onboarding-cv" className="flex flex-col gap-5">
      <CardTitle id="onboarding-cv">{t("onboarding.cv.title")}</CardTitle>
      <p className="text-app-muted">{t("onboarding.cv.intro")}</p>

      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-app-subtle bg-app-sunken/50 px-6 py-8 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-app-accent-soft text-app-accent">
          <FileUp className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </div>
        <label
          htmlFor="onboarding-cv-file"
          className="font-display text-lg font-semibold text-app-fg"
        >
          {t("onboarding.cv.fileLabel")}
        </label>
        <input
          id="onboarding-cv-file"
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-describedby="onboarding-cv-file-hint"
          className="max-w-full text-sm text-app-fg file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-app-ink file:px-4 file:py-2 file:text-sm file:font-medium file:text-app-ink-fg"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setState({ status: "idle" });
          }}
        />
        <p id="onboarding-cv-file-hint" className="text-xs text-app-muted">
          {t("onboarding.cv.fileHint")}
        </p>
      </div>

      {cloud ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-app-fair-soft p-4">
          <p className="text-sm text-app-fg">
            {t("onboarding.cv.consentNote", { provider: providerName })}
          </p>
          <CheckboxInput
            label={t("onboarding.cv.consent", { provider: providerName })}
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="ghost" onClick={back} className="mr-auto">
          <ArrowLeft aria-hidden className="size-4" />
          {t("onboarding.back")}
        </Button>
        <Button variant="ghost" onClick={onManual} disabled={importing}>
          {t("onboarding.cv.manual")}
        </Button>
        <Button onClick={() => void runImport()} disabled={!canImport}>
          {state.status === "importing" ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : null}
          {t("onboarding.cv.import")}
        </Button>
      </div>

      {importing ? <ImportProgress local={!cloud} onStop={stopImport} /> : null}

      {state.status === "failed" ? (
        <p role="alert" className="text-sm text-app-danger">
          {FILE_FAILURE_CODES.includes(state.code)
            ? t("onboarding.cv.failed", { reason: t(`onboarding.cv.reasons.${state.code}`) })
            : t("settings.ai.test.unavailable", {
                reason: t(`settings.ai.test.reasons.${state.code}`),
              })}
        </p>
      ) : null}
    </Card>
  );
}

/** How long the import has run, so a slow local model still shows that work goes on. */
function ImportProgress({ local, onStop }: { local: boolean; onStop: () => void }) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl bg-app-sunken/60 p-4 text-sm text-app-fg"
    >
      <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-app-accent" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{t("onboarding.cv.importing")}</p>
        <p className="text-app-muted">
          {local ? t("onboarding.cv.importingLocal") : t("onboarding.cv.importingCloud")}
        </p>
        <p className="tabular-nums text-app-muted">
          {t("onboarding.cv.elapsed", { count: seconds })}
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onStop} className="ml-auto shrink-0">
        {t("onboarding.cv.stop")}
      </Button>
    </div>
  );
}
