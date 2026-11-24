import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { SETTING_LIMITS, type AiModelsResult, type JobFinderBridge } from "@job-finder/bridge";
import { Button } from "../../components/ui/Button";
import { SelectInput, type SelectOption } from "../../components/ui/SelectInput";
import { TextInput } from "../../components/ui/TextInput";
import { AI_CHOICES, switchAiChoice, type AiChoice, type AiChoiceFields } from "./provider-choice";

/** Waits for typing in an address to settle before asking for the models again. */
const MODEL_LIST_DEBOUNCE_MS = 400;

/** Failures the Ollama help explains in its own words. */
const OLLAMA_REASONS = new Set<string>(["not-local", "unreachable", "invalid-response"]);

/** An example that is small enough for most laptops, shown in the Ollama help. */
export const OLLAMA_EXAMPLE_MODEL = "qwen3:8b";

const CHOICE_LABEL_KEYS: Record<AiChoice, string> = {
  anthropic: "settings.ai.providers.anthropic",
  openai: "settings.ai.providers.openai",
  gemini: "settings.ai.providers.gemini",
  ollama: "settings.ai.providers.ollama",
  "openai-compatible": "settings.ai.providers.openaiCompatible",
};

const CHOICE_HELP_KEYS: Record<AiChoice, string> = {
  anthropic: "settings.ai.help.anthropic",
  openai: "settings.ai.help.openai",
  gemini: "settings.ai.help.gemini",
  ollama: "settings.ai.help.ollama",
  "openai-compatible": "settings.ai.help.openaiCompatible",
};

interface AiProviderFieldsProps {
  bridge: JobFinderBridge;
  value: AiChoiceFields;
  onChange: (next: AiChoiceFields) => void;
  /** The API key field; Ollama needs no key, so it is left out for that choice. */
  keyField: ReactNode;
  /** Whether a key is saved; saving or removing one reads the model list again. */
  keySet: boolean;
}

/**
 * Provider, address, key and model, with a line of help for each provider. The model is picked
 * from the provider's own list; when the list cannot be read, the name can be typed instead.
 */
export function AiProviderFields({
  bridge,
  value,
  onChange,
  keyField,
  keySet,
}: AiProviderFieldsProps) {
  const { t } = useTranslation();
  const options: SelectOption[] = AI_CHOICES.map((choice) => ({
    value: choice,
    label: t(CHOICE_LABEL_KEYS[choice]),
  }));
  const help =
    value.choice === "ollama"
      ? t(CHOICE_HELP_KEYS.ollama, { example: OLLAMA_EXAMPLE_MODEL })
      : t(CHOICE_HELP_KEYS[value.choice]);
  const modelField = (
    <ModelField bridge={bridge} value={value} onChange={onChange} keySet={keySet} />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SelectInput
          label={t("settings.ai.provider")}
          options={options}
          value={value.choice}
          onChange={(event) => onChange(switchAiChoice(value, event.target.value as AiChoice))}
        />
        <p className="text-sm text-app-muted">{help}</p>
      </div>
      {value.choice === "ollama" ? (
        <>
          {modelField}
          <TextInput
            label={t("settings.ai.ollama.address")}
            hint={t("settings.ai.ollama.addressHint")}
            type="url"
            value={value.baseUrl}
            maxLength={SETTING_LIMITS.baseUrlMaxLength}
            onChange={(event) => onChange({ ...value, baseUrl: event.target.value })}
          />
        </>
      ) : (
        <>
          {value.choice === "openai-compatible" ? (
            <TextInput
              label={t("settings.ai.baseUrl")}
              hint={t("settings.ai.baseUrlHint")}
              type="url"
              value={value.baseUrl}
              maxLength={SETTING_LIMITS.baseUrlMaxLength}
              onChange={(event) => onChange({ ...value, baseUrl: event.target.value })}
            />
          ) : null}
          {keyField}
          {modelField}
        </>
      )}
    </div>
  );
}

interface LoadedModels {
  /** The request the result answers, so a stale answer is never shown. */
  key: string;
  result: AiModelsResult;
}

function ModelField({ bridge, value, onChange, keySet }: Omit<AiProviderFieldsProps, "keyField">) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<LoadedModels | null>(null);
  const source = value.choice;
  const usesAddress = source === "ollama" || source === "openai-compatible";
  const baseUrl = usesAddress ? value.baseUrl.trim() : "";
  const missingAddress = usesAddress && baseUrl === "";
  const key = `${attempt}:${source}:${baseUrl}:${keySet ? "key" : "no-key"}`;

  useEffect(() => {
    if (missingAddress) return;
    let active = true;
    const timer = setTimeout(() => {
      bridge.ai
        .models({ source, baseUrl })
        .catch((): AiModelsResult => ({ ok: false, code: "engine-unavailable" }))
        .then((result) => {
          if (active) setLoaded({ key, result });
        });
    }, MODEL_LIST_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bridge, source, baseUrl, missingAddress, key]);

  const result = loaded?.key === key ? loaded.result : null;
  const models = result?.ok ? result.models : [];

  // Ollama's models are the user's own: an empty model picks the first one, so one choice is enough.
  const firstLocal = source === "ollama" ? models[0]?.id : undefined;
  useEffect(() => {
    if (value.model === "" && firstLocal !== undefined) {
      onChange({ ...value, model: firstLocal });
    }
  }, [firstLocal, onChange, value]);

  const ollama = source === "ollama";
  const server = ollama || source === "openai-compatible";
  let status: string;
  if (missingAddress) {
    status = ollama ? t("settings.ai.ollama.noUrl") : t("settings.ai.models.noUrl");
  } else if (result === null) {
    status = t("settings.ai.models.loading");
  } else if (result.ok) {
    if (models.length === 0) {
      status = ollama
        ? t("settings.ai.ollama.empty", { example: OLLAMA_EXAMPLE_MODEL })
        : t("settings.ai.models.empty");
    } else {
      status = ollama
        ? t("settings.ai.ollama.found", { count: models.length })
        : t("settings.ai.models.found", { count: models.length });
    }
  } else if (ollama && OLLAMA_REASONS.has(result.code)) {
    status = t(`settings.ai.ollama.reasons.${result.code}`, { url: baseUrl });
  } else {
    const code =
      server && (result.code === "invalid-key" || result.code === "unreachable")
        ? `${result.code}-server`
        : result.code;
    status = t(`settings.ai.models.reasons.${code}`, { url: baseUrl });
  }
  const problem = !missingAddress && result !== null && (!result.ok || models.length === 0);

  const modelOptions: SelectOption[] = models.map((model) => ({
    value: model.id,
    label:
      model.sizeBytes !== null
        ? t("settings.ai.models.option", {
            name: model.id,
            size: (model.sizeBytes / 1e9).toFixed(1),
          })
        : (model.label ?? model.id),
  }));
  if (value.model !== "" && !models.some((model) => model.id === value.model)) {
    modelOptions.unshift({
      value: value.model,
      label: t("settings.ai.models.notListed", { name: value.model }),
    });
  }
  if (value.model === "") {
    modelOptions.unshift({ value: "", label: t("settings.ai.models.choose") });
  }

  return (
    <div className="flex flex-col gap-2">
      {models.length > 0 ? (
        <SelectInput
          label={t("settings.ai.model")}
          options={modelOptions}
          value={value.model}
          onChange={(event) => onChange({ ...value, model: event.target.value })}
        />
      ) : (
        <TextInput
          label={t("settings.ai.model")}
          value={value.model}
          placeholder={ollama ? OLLAMA_EXAMPLE_MODEL : undefined}
          maxLength={SETTING_LIMITS.modelMaxLength}
          onChange={(event) => onChange({ ...value, model: event.target.value })}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <p
          role="status"
          className={`flex-1 text-sm ${problem ? "text-app-danger" : "text-app-muted"}`}
        >
          {status}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setAttempt((current) => current + 1)}
          disabled={missingAddress || result === null}
        >
          <RefreshCw aria-hidden className="size-3.5" />
          {t("settings.ai.models.refresh")}
        </Button>
      </div>
    </div>
  );
}
