import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  SETTING_LIMITS,
  type AppSettings,
  type SecretName,
  type SecretsStatus,
  type JobFinderBridge,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { i18n, resolveUiLanguage } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
import { SelectInput, type SelectOption } from "../../components/ui/SelectInput";
import { TextInput } from "../../components/ui/TextInput";
import { draftFromSettings, patchFromDraft, type SettingsDraft } from "./draft";
import { AiConnectionTest, SecretField } from "./AiControls";
import { AiProviderFields } from "./AiProviderFields";
import type { AiChoiceFields } from "./provider-choice";

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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title={t("settings.title")} />

      {state.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("settings.loading")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-danger">{t("settings.loadFailed")}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
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
  const [savedDraft, setSavedDraft] = useState<SettingsDraft>(draft);
  const unsaved = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const [secrets, setSecrets] = useState<SecretsStatus>(initialSecrets);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [allowBasicText, setAllowBasicText] = useState(initialSettings.secrets.allowBasicText);
  const isLinux = bridge.platform === "linux";

  function change<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
  }

  const aiFields: AiChoiceFields = {
    choice: draft.aiProvider,
    model: draft.aiModel,
    baseUrl: draft.aiBaseUrl,
  };
  const changeAi = useCallback((next: AiChoiceFields) => {
    setDraft((current) => ({
      ...current,
      aiProvider: next.choice,
      aiModel: next.model,
      aiBaseUrl: next.baseUrl,
    }));
    setSaveState("idle");
  }, []);

  /** Saves the whole form; resolves whether the saved settings now match it. */
  async function saveDraft(): Promise<boolean> {
    const patch = patchFromDraft(draft);
    if (!patch) {
      setSaveState("invalid");
      return false;
    }
    setSaveState("saving");
    try {
      const next = await bridge.settings.update(patch);
      setSavedDraft(draft);
      await i18n.changeLanguage(resolveUiLanguage(next.ui.language));
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraft();
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
    <form onSubmit={save} className="flex flex-col gap-6" noValidate>
      <Card as="section" aria-labelledby="settings-ai" className="flex flex-col gap-4">
        <CardTitle id="settings-ai">{t("settings.sections.ai")}</CardTitle>
        <AiProviderFields
          bridge={bridge}
          value={aiFields}
          onChange={changeAi}
          isKeySet={(name) => secrets.keys[name]}
          keyField={(name) => (
            <SecretField
              key={name}
              bridge={bridge}
              name={name}
              label={t("settings.ai.apiKey")}
              secrets={secrets}
              onStatus={setSecrets}
            />
          )}
        />
        <TextInput
          label={t("settings.ai.contextSize")}
          hint={
            draft.aiProvider === "ollama"
              ? t("settings.ai.contextSizeHintOllama")
              : t("settings.ai.contextSizeHint")
          }
          type="number"
          inputMode="numeric"
          min={SETTING_LIMITS.contextSizeMin}
          max={SETTING_LIMITS.contextSizeMax}
          value={draft.aiContextSize}
          onChange={(event) => change("aiContextSize", event.target.value)}
        />
        {/* The test reads the saved settings, so the changes on screen are saved first. */}
        <AiConnectionTest
          bridge={bridge}
          saveChanges={() => (unsaved ? saveDraft() : Promise.resolve(true))}
        />
      </Card>

      <Card as="section" aria-labelledby="settings-search" className="flex flex-col gap-4">
        <CardTitle id="settings-search">{t("settings.sections.search")}</CardTitle>
        <CheckboxInput
          label={t("settings.search.duckduckgo")}
          hint={t("settings.search.duckduckgoHint")}
          checked={draft.search.duckduckgo}
          onChange={(event) =>
            change("search", { ...draft.search, duckduckgo: event.target.checked })
          }
        />
        {(["brave", "tavily", "serper"] as const).map((provider) => (
          <div key={provider} className="flex flex-col gap-3 rounded-xl bg-app-sunken/60 p-4">
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
      </Card>

      <Card as="section" aria-labelledby="settings-language" className="flex flex-col gap-4">
        <CardTitle id="settings-language">{t("settings.sections.language")}</CardTitle>
        <SelectInput
          label={t("settings.language.label")}
          options={languageOptions}
          value={draft.language}
          onChange={(event) => change("language", event.target.value as SettingsDraft["language"])}
        />
      </Card>

      <Card as="section" aria-labelledby="settings-notifications" className="flex flex-col gap-4">
        <CardTitle id="settings-notifications">{t("settings.sections.notifications")}</CardTitle>
        <CheckboxInput
          label={t("settings.notifications.enabled")}
          checked={draft.notifications}
          onChange={(event) => change("notifications", event.target.checked)}
        />
      </Card>

      <Card as="section" aria-labelledby="settings-scheduler" className="flex flex-col gap-4">
        <CardTitle id="settings-scheduler">{t("settings.sections.scheduler")}</CardTitle>
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
      </Card>

      <Card as="section" aria-labelledby="settings-window" className="flex flex-col gap-4">
        <CardTitle id="settings-window">{t("settings.sections.window")}</CardTitle>
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
      </Card>

      <Card as="section" aria-labelledby="settings-updates" className="flex flex-col gap-4">
        <CardTitle id="settings-updates">{t("settings.sections.updates")}</CardTitle>
        <CheckboxInput
          label={t("settings.updates.checkEnabled")}
          hint={t("settings.updates.hint")}
          checked={draft.checkUpdates}
          onChange={(event) => change("checkUpdates", event.target.checked)}
        />
      </Card>

      {isLinux && secrets.storage.optInRequired ? (
        <Card as="section" aria-labelledby="settings-keyring" className="flex flex-col gap-3">
          <CardTitle id="settings-keyring">{t("settings.secrets.optInTitle")}</CardTitle>
          <p className="text-sm text-app-muted">{t("settings.secrets.optInBody")}</p>
          <CheckboxInput
            label={t("settings.secrets.optIn")}
            checked={allowBasicText}
            onChange={(event) => void toggleBasicText(event.target.checked)}
          />
        </Card>
      ) : null}

      <div className="sticky bottom-4 flex items-center justify-end gap-4 rounded-2xl border border-app-border bg-app-surface/95 px-5 py-3 shadow-pop backdrop-blur">
        <p
          role="status"
          className={`text-sm ${saveState === "saved" ? "text-app-good" : saveState === "invalid" || saveState === "error" ? "text-app-danger" : "text-app-muted"}`}
        >
          {saveState === "saved" ? t("settings.saved") : null}
          {saveState === "invalid" ? t("settings.invalid") : null}
          {saveState === "error" ? t("settings.saveFailed") : null}
          {saveState === "idle" && unsaved ? t("settings.unsaved") : null}
        </p>
        <Button type="submit" disabled={saveState === "saving"}>
          {saveState === "saving" ? t("settings.saving") : t("settings.save")}
        </Button>
      </div>
    </form>
  );
}
