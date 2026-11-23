import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  SETTING_LIMITS,
  type AiTestResult,
  type AppSettings,
  type SecretName,
  type SecretsStatus,
  type JobFinderBridge,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { i18n, resolveUiLanguage } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
import { SelectInput, type SelectOption } from "../../components/ui/SelectInput";
import { TextInput } from "../../components/ui/TextInput";
import { draftFromSettings, patchFromDraft, type SettingsDraft } from "./draft";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; settings: AppSettings; secrets: SecretsStatus };

export function SettingsScreen() {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const readSettings = useCallback(async (): Promise<LoadState> => {
    try {
      const [settings, secrets] = await Promise.all([
        bridge.settings.get(),
        bridge.secrets.status(),
      ]);
      return { status: "ready", settings, secrets };
    } catch {
      return { status: "error" };
    }
  }, [bridge]);

  useEffect(() => {
    let active = true;
    void readSettings().then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
    };
  }, [readSettings]);

  function retry() {
    setState({ status: "loading" });
    void readSettings().then(setState);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <nav>
        <Link to="/" className="text-sm text-app-accent underline">
          {t("settings.backHome")}
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold text-app-fg">{t("settings.title")}</h1>

      {state.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("settings.loading")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-fg">{t("settings.loadFailed")}</p>
          <Button variant="secondary" onClick={retry}>
            {t("settings.retry")}
          </Button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <SettingsForm
          key={JSON.stringify(state.settings)}
          initialSettings={state.settings}
          initialSecrets={state.secrets}
          bridge={bridge}
        />
      ) : null}
    </main>
  );
}

interface SettingsFormProps {
  initialSettings: AppSettings;
  initialSecrets: SecretsStatus;
  bridge: JobFinderBridge;
}

type SaveState = "idle" | "saving" | "saved" | "invalid" | "error";

function SettingsForm({ initialSettings, initialSecrets, bridge }: SettingsFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromSettings(initialSettings));
  const [secrets, setSecrets] = useState<SecretsStatus>(initialSecrets);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [allowBasicText, setAllowBasicText] = useState(initialSettings.secrets.allowBasicText);
  const isLinux = bridge.platform === "linux";

  function change<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const patch = patchFromDraft(draft);
    if (!patch) {
      setSaveState("invalid");
      return;
    }
    setSaveState("saving");
    try {
      const next = await bridge.settings.update(patch);
      await i18n.changeLanguage(resolveUiLanguage(next.ui.language));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  async function toggleBasicText(allowed: boolean) {
    try {
      const next = await bridge.settings.update({ secrets: { allowBasicText: allowed } });
      setAllowBasicText(next.secrets.allowBasicText);
      setSecrets(await bridge.secrets.status());
    } catch {
      setSaveState("error");
    }
  }

  const providerOptions: SelectOption[] = [
    { value: "anthropic", label: t("settings.ai.providers.anthropic") },
    { value: "openai", label: t("settings.ai.providers.openai") },
    { value: "openai-compatible", label: t("settings.ai.providers.openaiCompatible") },
  ];
  const languageOptions: SelectOption[] = [
    { value: "system", label: t("settings.language.system") },
    { value: "en", label: t("settings.language.en") },
    { value: "it", label: t("settings.language.it") },
  ];
  const closeOptions: SelectOption[] = [
    { value: "ask", label: t("settings.window.closeAsk") },
    { value: "keep-running", label: t("settings.window.closeKeepRunning") },
    { value: "quit", label: t("settings.window.closeQuit") },
  ];

  return (
    <form onSubmit={save} className="flex flex-col gap-8" noValidate>
      <section aria-labelledby="settings-ai" className="flex flex-col gap-4">
        <h2 id="settings-ai" className="text-lg font-medium text-app-fg">
          {t("settings.sections.ai")}
        </h2>
        <SelectInput
          label={t("settings.ai.provider")}
          options={providerOptions}
          value={draft.aiProvider}
          onChange={(event) =>
            change("aiProvider", event.target.value as SettingsDraft["aiProvider"])
          }
        />
        <TextInput
          label={t("settings.ai.model")}
          value={draft.aiModel}
          maxLength={SETTING_LIMITS.modelMaxLength}
          onChange={(event) => change("aiModel", event.target.value)}
        />
        {draft.aiProvider === "openai-compatible" ? (
          <TextInput
            label={t("settings.ai.baseUrl")}
            hint={t("settings.ai.baseUrlHint")}
            type="url"
            value={draft.aiBaseUrl}
            maxLength={SETTING_LIMITS.baseUrlMaxLength}
            onChange={(event) => change("aiBaseUrl", event.target.value)}
          />
        ) : null}
        <TextInput
          label={t("settings.ai.contextSize")}
          hint={t("settings.ai.contextSizeHint")}
          type="number"
          inputMode="numeric"
          min={SETTING_LIMITS.contextSizeMin}
          max={SETTING_LIMITS.contextSizeMax}
          value={draft.aiContextSize}
          onChange={(event) => change("aiContextSize", event.target.value)}
        />
        <SecretField
          bridge={bridge}
          name="ai.apiKey"
          label={t("settings.ai.apiKey")}
          secrets={secrets}
          onStatus={setSecrets}
        />
        <AiConnectionTest bridge={bridge} />
      </section>

      <section aria-labelledby="settings-search" className="flex flex-col gap-4">
        <h2 id="settings-search" className="text-lg font-medium text-app-fg">
          {t("settings.sections.search")}
        </h2>
        <CheckboxInput
          label={t("settings.search.duckduckgo")}
          hint={t("settings.search.duckduckgoHint")}
          checked={draft.search.duckduckgo}
          onChange={(event) =>
            change("search", { ...draft.search, duckduckgo: event.target.checked })
          }
        />
        {(["brave", "tavily", "serper"] as const).map((provider) => (
          <div key={provider} className="flex flex-col gap-3">
            <CheckboxInput
              label={t(`settings.search.${provider}`)}
              hint={t("settings.search.keyHint")}
              checked={draft.search[provider]}
              onChange={(event) =>
                change("search", { ...draft.search, [provider]: event.target.checked })
              }
            />
            <SecretField
              bridge={bridge}
              name={`search.${provider}` as SecretName}
              label={t(`settings.search.${provider}`)}
              secrets={secrets}
              onStatus={setSecrets}
            />
          </div>
        ))}
      </section>

      <section aria-labelledby="settings-language" className="flex flex-col gap-4">
        <h2 id="settings-language" className="text-lg font-medium text-app-fg">
          {t("settings.sections.language")}
        </h2>
        <SelectInput
          label={t("settings.language.label")}
          options={languageOptions}
          value={draft.language}
          onChange={(event) => change("language", event.target.value as SettingsDraft["language"])}
        />
      </section>

      <section aria-labelledby="settings-notifications" className="flex flex-col gap-4">
        <h2 id="settings-notifications" className="text-lg font-medium text-app-fg">
          {t("settings.sections.notifications")}
        </h2>
        <CheckboxInput
          label={t("settings.notifications.enabled")}
          checked={draft.notifications}
          onChange={(event) => change("notifications", event.target.checked)}
        />
      </section>

      <section aria-labelledby="settings-scheduler" className="flex flex-col gap-4">
        <h2 id="settings-scheduler" className="text-lg font-medium text-app-fg">
          {t("settings.sections.scheduler")}
        </h2>
        <TextInput
          label={t("settings.scheduler.intervalHours")}
          hint={t("settings.scheduler.hint")}
          type="number"
          inputMode="numeric"
          min={SETTING_LIMITS.schedulerIntervalHoursMin}
          max={SETTING_LIMITS.schedulerIntervalHoursMax}
          value={draft.intervalHours}
          onChange={(event) => change("intervalHours", event.target.value)}
        />
      </section>

      <section aria-labelledby="settings-window" className="flex flex-col gap-4">
        <h2 id="settings-window" className="text-lg font-medium text-app-fg">
          {t("settings.sections.window")}
        </h2>
        <SelectInput
          label={t("settings.window.closeBehavior")}
          options={closeOptions}
          value={draft.closeBehavior}
          onChange={(event) =>
            change("closeBehavior", event.target.value as SettingsDraft["closeBehavior"])
          }
        />
        {isLinux ? null : (
          <CheckboxInput
            label={t("settings.window.launchAtLogin")}
            checked={draft.launchAtLogin}
            onChange={(event) => change("launchAtLogin", event.target.checked)}
          />
        )}
      </section>

      <section aria-labelledby="settings-updates" className="flex flex-col gap-4">
        <h2 id="settings-updates" className="text-lg font-medium text-app-fg">
          {t("settings.sections.updates")}
        </h2>
        <CheckboxInput
          label={t("settings.updates.checkEnabled")}
          hint={t("settings.updates.hint")}
          checked={draft.checkUpdates}
          onChange={(event) => change("checkUpdates", event.target.checked)}
        />
      </section>

      {isLinux && secrets.storage.optInRequired ? (
        <section
          aria-labelledby="settings-keyring"
          className="flex flex-col gap-3 rounded-lg border border-app-border p-4"
        >
          <h2 id="settings-keyring" className="text-lg font-medium text-app-fg">
            {t("settings.secrets.optInTitle")}
          </h2>
          <p className="text-sm text-app-muted">{t("settings.secrets.optInBody")}</p>
          <CheckboxInput
            label={t("settings.secrets.optIn")}
            checked={allowBasicText}
            onChange={(event) => void toggleBasicText(event.target.checked)}
          />
        </section>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saveState === "saving"}>
            {saveState === "saving" ? t("settings.saving") : t("settings.save")}
          </Button>
          <p role="status" className="text-sm text-app-muted">
            {saveState === "saved" ? t("settings.saved") : null}
            {saveState === "invalid" ? t("settings.invalid") : null}
            {saveState === "error" ? t("settings.saveFailed") : null}
          </p>
        </div>
      </div>
    </form>
  );
}

type AiTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "done"; result: AiTestResult }
  | { status: "error" };

/** Runs the engine-side test of the saved AI settings. Shows loading, connected, or AI unavailable with a reason. */
function AiConnectionTest({ bridge }: { bridge: JobFinderBridge }) {
  const { t } = useTranslation();
  const [state, setState] = useState<AiTestState>({ status: "idle" });

  async function run() {
    setState({ status: "testing" });
    try {
      setState({ status: "done", result: await bridge.ai.testConnection() });
    } catch {
      setState({ status: "error" });
    }
  }

  let message: string = t("settings.ai.test.hint");
  if (state.status === "testing") {
    message = t("settings.ai.test.testing");
  } else if (state.status === "done" && state.result.ok) {
    message = t("settings.ai.test.connected", { model: state.result.model });
  } else if (state.status === "done" || state.status === "error") {
    const code = state.status === "done" && !state.result.ok ? state.result.code : "unknown";
    message = t("settings.ai.test.unavailable", {
      reason: t(`settings.ai.test.reasons.${code}`),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="secondary"
          onClick={() => void run()}
          disabled={state.status === "testing"}
        >
          {t("settings.ai.test.action")}
        </Button>
      </div>
      <p role="status" className="text-sm text-app-muted">
        {message}
      </p>
    </div>
  );
}

interface SecretFieldProps {
  bridge: JobFinderBridge;
  name: SecretName;
  label: string;
  secrets: SecretsStatus;
  onStatus: (status: SecretsStatus) => void;
}

/** Write-only key field: shows only whether a key is set, and clears its input after saving. */
function SecretField({ bridge, name, label, secrets, onStatus }: SecretFieldProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const isSet = secrets.keys[name];

  async function save() {
    try {
      onStatus(await bridge.secrets.set(name, value));
      setValue("");
      setMessage(t("settings.secrets.keySaved"));
    } catch {
      setMessage(t("settings.secrets.keyFailed"));
    }
  }

  async function remove() {
    try {
      onStatus(await bridge.secrets.clear(name));
      setMessage(t("settings.secrets.keyRemoved"));
    } catch {
      setMessage(t("settings.secrets.removeFailed"));
    }
  }

  const storageNote =
    secrets.storage.mode === "encrypted"
      ? t("settings.secrets.storageEncrypted")
      : secrets.storage.mode === "basic-text"
        ? t("settings.secrets.storageBasicText")
        : t("settings.secrets.storageSessionOnly");

  return (
    <div className="flex flex-col gap-2">
      <TextInput
        label={label}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        hint={`${isSet ? t("settings.secrets.keySet") : t("settings.secrets.keyNotSet")} ${storageNote}`}
      />
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => void save()} disabled={value.trim() === ""}>
          {t("settings.secrets.save")}
        </Button>
        <Button variant="secondary" onClick={() => void remove()} disabled={!isSet}>
          {t("settings.secrets.remove")}
        </Button>
        <span role="status" className="text-xs text-app-muted">
          {message}
        </span>
      </div>
    </div>
  );
}
