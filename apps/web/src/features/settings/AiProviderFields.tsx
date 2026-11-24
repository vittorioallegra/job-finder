import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import {
  SETTING_LIMITS,
  aiKeyNameForSource,
  type AiModelsResult,
  type JobFinderBridge,
  type SecretName,
} from "@job-finder/bridge";
import { Button } from "../../components/ui/Button";
import { SelectInput, type SelectOption } from "../../components/ui/SelectInput";
import { TextInput } from "../../components/ui/TextInput";
import {
  AI_CHOICES,
  contextSteps,
  switchAiChoice,
  type AiChoice,
  type AiChoiceFields,
} from "./provider-choice";

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
  /** The key field for the chosen provider's own key; Ollama needs none, so it gets no field. */
  keyField: (name: SecretName) => ReactNode;
  /** Whether a key is saved; saving or removing one reads the model list again. */
  isKeySet: (name: SecretName) => boolean;
  /**
   * The context size, as typed in the form. With `onContextSize`, Ollama shows a slider up to the
   * chosen model's limit and another server a number field; hosted providers show neither.
   */
  contextSize?: string;
  onContextSize?: (value: string) => void;
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
  isKeySet,
  contextSize,
  onContextSize,
}: AiProviderFieldsProps) {
  const { t } = useTranslation();
  const keyName = aiKeyNameForSource(value.choice);
  const keySet = keyName !== null && isKeySet(keyName);
  const options: SelectOption[] = AI_CHOICES.map((choice) => ({
    value: choice,
    label: t(CHOICE_LABEL_KEYS[choice]),
  }));
  const help =
    value.choice === "ollama"
      ? t(CHOICE_HELP_KEYS.ollama, { example: OLLAMA_EXAMPLE_MODEL })
      : t(CHOICE_HELP_KEYS[value.choice]);
  const modelField = (
    <ModelField
      bridge={bridge}
      value={value}
      onChange={onChange}
      keySet={keySet}
      contextSize={contextSize}
      onContextSize={onContextSize}
    />
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
          {keyName !== null ? keyField(keyName) : null}
          {modelField}
          {/* Another server reads what it was started with, so the user types that size; Ollama
              takes it per request (the slider by the model); hosted providers need neither. */}
          {value.choice === "openai-compatible" && contextSize !== undefined && onContextSize ? (
            <TextInput
              label={t("settings.ai.contextSize")}
              hint={t("settings.ai.contextSizeHint")}
              type="number"
              inputMode="numeric"
              min={SETTING_LIMITS.contextSizeMin}
              max={SETTING_LIMITS.contextSizeMax}
              value={contextSize}
              onChange={(event) => onContextSize(event.target.value)}
            />
          ) : null}
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

interface ModelFieldProps {
  bridge: JobFinderBridge;
  value: AiChoiceFields;
  onChange: (next: AiChoiceFields) => void;
  keySet: boolean;
  contextSize?: string | undefined;
  onContextSize?: ((value: string) => void) | undefined;
}

function ModelField({
  bridge,
  value,
  onChange,
  keySet,
  contextSize,
  onContextSize,
}: ModelFieldProps) {
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
      {ollama && contextSize !== undefined && onContextSize ? (
        <ContextSlider
          value={contextSize}
          onChange={onContextSize}
          modelLimit={models.find((model) => model.id === value.model)?.contextLength ?? null}
          // Until the list is read, the model's limit is unknown and nothing is cut to it.
          known={result !== null}
        />
      ) : null}
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

interface ContextSliderProps {
  value: string;
  onChange: (value: string) => void;
  /** The chosen model's longest context, or null when Ollama did not say. */
  modelLimit: number | null;
  known: boolean;
}

/** Ollama's context size per request, from 4k up to the chosen model's limit. */
function ContextSlider({ value, onChange, modelLimit, known }: ContextSliderProps) {
  const { t, i18n } = useTranslation();
  const steps = contextSteps(modelLimit);
  const current = Number(value);
  // The stop at or below the current size; a size above the model's limit comes down to it.
  let index = steps.findLastIndex((step) => step <= current);
  if (index < 0) index = 0;
  const shown = steps[index] ?? steps[0] ?? current;

  useEffect(() => {
    if (known && Number.isFinite(current) && current !== shown) onChange(String(shown));
  }, [known, current, shown, onChange]);

  const format = (tokens: number) => new Intl.NumberFormat(i18n.language).format(tokens);
  const short = (tokens: number) =>
    tokens >= 1024 ? `${Math.round(tokens / 1024)}k` : String(tokens);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-app-fg">
          {t("settings.ai.contextSize")}
        </label>
        <span className="text-sm tabular-nums text-app-fg">
          {t("settings.ai.contextTokens", { count: shown, formatted: format(shown) })}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={steps.length - 1}
        step={1}
        value={index}
        aria-valuetext={t("settings.ai.contextTokens", { count: shown, formatted: format(shown) })}
        onChange={(event) => onChange(String(steps[Number(event.target.value)] ?? shown))}
        className="w-full accent-app-accent"
      />
      <div className="flex justify-between text-xs tabular-nums text-app-muted" aria-hidden>
        {steps.map((step) => (
          <span key={step}>{short(step)}</span>
        ))}
      </div>
      <p className="text-xs text-app-muted">
        {modelLimit === null
          ? t("settings.ai.contextSizeHintOllama")
          : t("settings.ai.contextSizeHintOllamaLimit", { limit: format(modelLimit) })}
      </p>
    </div>
  );
}
