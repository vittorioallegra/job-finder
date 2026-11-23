import { useAiConsent } from "../../lib/useAiConsent";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import {
  CV_UPLOAD_MAX_BYTES,
  emptyProfile,
  aiConsentTarget,
  isCloudAiEndpoint,
  SETTING_LIMITS,
  type AiProvider,
  type AppSettings,
  type CvImportFailureCode,
  type CvImportWarning,
  type JobFinderBridge,
  type SecretsStatus,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
import { SelectInput, type SelectOption } from "../../components/ui/SelectInput";
import { TextInput } from "../../components/ui/TextInput";
import { AiConnectionTest, SecretField } from "../settings/AiControls";
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <nav>
        <Link to="/" className="text-sm text-app-accent underline">
          {t("onboarding.backHome")}
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold text-app-fg">{t("onboarding.title")}</h1>

      <ol aria-label={t("onboarding.steps.label")} className="flex flex-wrap gap-4 text-sm">
        {STEPS.map((name, index) => (
          <li
            key={name}
            aria-current={name === step ? "step" : undefined}
            className={name === step ? "font-semibold text-app-accent" : "text-app-muted"}
          >
            {index + 1}. {t(`onboarding.steps.${name}`)}
          </li>
        ))}
      </ol>

      {loadFailed ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-fg">{t("onboarding.loadFailed")}</p>
          <Button variant="secondary" onClick={retry}>
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
        />
      ) : null}

      {settings !== null && step === "review" ? (
        <section aria-labelledby="onboarding-review" className="flex flex-col gap-4">
          <h2 id="onboarding-review" className="text-lg font-medium text-app-fg">
            {t("onboarding.review.title")}
          </h2>
          <p className="text-app-muted">{t("onboarding.review.intro")}</p>
          {warnings.some((warning) => warning.code === "context-exceeded") ? (
            <p role="note" className="rounded-md border border-app-border p-3 text-sm text-app-fg">
              {t("onboarding.review.contextWarning")}
            </p>
          ) : null}
          <ProfileEditor initialDraft={draft} onSaved={() => navigate("/")} />
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
  const [provider, setProvider] = useState<AiProvider>(settings.ai.provider);
  const [model, setModel] = useState(settings.ai.model);
  const [baseUrl, setBaseUrl] = useState(settings.ai.baseUrl);
  const [secrets, setSecrets] = useState<SecretsStatus | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<"idle" | "saving" | "saved" | "error">("idle");

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

  const providerOptions: SelectOption[] = [
    { value: "anthropic", label: t("settings.ai.providers.anthropic") },
    { value: "openai", label: t("settings.ai.providers.openai") },
    { value: "openai-compatible", label: t("settings.ai.providers.openaiCompatible") },
  ];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("saving");
    try {
      const next = await bridge.settings.update({
        ai: { provider, model, baseUrl, contextSize: settings.ai.contextSize },
      });
      setDirty(false);
      setMessage("saved");
      onSaved(next);
    } catch {
      setMessage("error");
    }
  }

  return (
    <section aria-labelledby="onboarding-ai" className="flex flex-col gap-4">
      <h2 id="onboarding-ai" className="text-lg font-medium text-app-fg">
        {t("onboarding.ai.title")}
      </h2>
      <p className="text-app-muted">{t("onboarding.ai.intro")}</p>
      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        <SelectInput
          label={t("settings.ai.provider")}
          options={providerOptions}
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as AiProvider);
            setDirty(true);
          }}
        />
        <TextInput
          label={t("settings.ai.model")}
          value={model}
          maxLength={SETTING_LIMITS.modelMaxLength}
          onChange={(event) => {
            setModel(event.target.value);
            setDirty(true);
          }}
        />
        {provider === "openai-compatible" ? (
          <TextInput
            label={t("settings.ai.baseUrl")}
            hint={t("settings.ai.baseUrlHint")}
            type="url"
            value={baseUrl}
            maxLength={SETTING_LIMITS.baseUrlMaxLength}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setDirty(true);
            }}
          />
        ) : null}
        {secrets !== null ? (
          <SecretField
            bridge={bridge}
            name="ai.apiKey"
            label={t("settings.ai.apiKey")}
            secrets={secrets}
            onStatus={setSecrets}
          />
        ) : null}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={message === "saving"}>
            {message === "saving" ? t("onboarding.ai.saving") : t("onboarding.ai.save")}
          </Button>
          <p role="status" className="text-sm text-app-muted">
            {message === "saved" ? t("onboarding.ai.saved") : null}
            {message === "error" ? t("onboarding.ai.saveFailed") : null}
          </p>
        </div>
      </form>
      <AiConnectionTest bridge={bridge} />
      <div>
        <Button onClick={onContinue} disabled={dirty || message === "saving"}>
          {t("onboarding.ai.continue")}
        </Button>
      </div>
    </section>
  );
}

interface CvStepProps {
  bridge: JobFinderBridge;
  settings: AppSettings;
  onImported: (draft: ProfileDraft, warnings: CvImportWarning[]) => void;
  onManual: () => void;
}

type CvState =
  { status: "idle" } | { status: "importing" } | { status: "failed"; code: CvImportFailureCode };

/** Picks a CV, asks for consent when the provider is a cloud service, and imports it into a draft. */
function CvStep({ bridge, settings, onImported, onManual }: CvStepProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const { consent, consentTarget, setConsent } = useAiConsent(aiConsentTarget(settings.ai));
  const [state, setState] = useState<CvState>({ status: "idle" });
  const cloud = isCloudAiEndpoint(settings.ai);
  const providerKey =
    settings.ai.provider === "openai-compatible" ? "openaiCompatible" : settings.ai.provider;
  const providerName = t(`settings.ai.providers.${providerKey}`);
  const canImport = file !== null && (!cloud || consent) && state.status !== "importing";

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
      } else {
        setState({ status: "failed", code: result.code });
      }
    } catch {
      setState({ status: "failed", code: "unknown" });
    }
  }

  return (
    <section aria-labelledby="onboarding-cv" className="flex flex-col gap-4">
      <h2 id="onboarding-cv" className="text-lg font-medium text-app-fg">
        {t("onboarding.cv.title")}
      </h2>
      <p className="text-app-muted">{t("onboarding.cv.intro")}</p>

      <div className="flex flex-col gap-1">
        <label htmlFor="onboarding-cv-file" className="text-sm font-medium text-app-fg">
          {t("onboarding.cv.fileLabel")}
        </label>
        <input
          id="onboarding-cv-file"
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-describedby="onboarding-cv-file-hint"
          className="text-sm text-app-fg"
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
        <div className="flex flex-col gap-3 rounded-lg border border-app-border p-4">
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

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void runImport()} disabled={!canImport}>
          {state.status === "importing" ? t("onboarding.cv.importing") : t("onboarding.cv.import")}
        </Button>
        <Button variant="secondary" onClick={onManual}>
          {t("onboarding.cv.manual")}
        </Button>
      </div>

      {state.status === "importing" ? (
        <p role="status" className="text-sm text-app-muted">
          {t("onboarding.cv.importing")}
        </p>
      ) : null}

      {state.status === "failed" ? (
        <p role="alert" className="text-sm text-app-fg">
          {FILE_FAILURE_CODES.includes(state.code)
            ? t("onboarding.cv.failed", { reason: t(`onboarding.cv.reasons.${state.code}`) })
            : t("settings.ai.test.unavailable", {
                reason: t(`settings.ai.test.reasons.${state.code}`),
              })}
        </p>
      ) : null}
    </section>
  );
}
