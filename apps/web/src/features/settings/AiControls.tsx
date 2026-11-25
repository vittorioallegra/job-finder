import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AiTestResult, JobFinderBridge, SecretName, SecretsStatus } from "@job-finder/bridge";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";
import { useAutoDismiss } from "../../lib/useAutoDismiss";

type AiTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "done"; result: AiTestResult }
  | { status: "error" };

interface AiConnectionTestProps {
  bridge: JobFinderBridge;
  /**
   * Saves the form's unsaved changes before the test, which reads the saved settings. Resolves
   * false when nothing could be saved; the test then does not run, and the form shows why.
   */
  saveChanges?: () => Promise<boolean>;
}

/** Runs the engine-side test of the saved AI settings. Shows loading, connected, or AI unavailable with a reason. */
export function AiConnectionTest({ bridge, saveChanges }: AiConnectionTestProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<AiTestState>({ status: "idle" });

  async function run() {
    setState({ status: "testing" });
    if (saveChanges && !(await saveChanges())) {
      setState({ status: "idle" });
      return;
    }
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
    const failure = state.status === "done" && !state.result.ok ? state.result : null;
    const reason = t(`settings.ai.test.reasons.${failure?.code ?? "unknown"}`);
    // The detail (an HTTP status and the provider's error identifiers) helps tell causes apart.
    message = failure?.detail
      ? t("settings.ai.test.unavailableDetail", { reason, detail: failure.detail })
      : t("settings.ai.test.unavailable", { reason });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void run()}
        disabled={state.status === "testing"}
      >
        {t("settings.ai.test.action")}
      </Button>
      <p
        role="status"
        className={`text-sm ${
          state.status === "done" && state.result.ok
            ? "text-app-good"
            : state.status === "error" || state.status === "done"
              ? "text-app-danger"
              : "text-app-muted"
        }`}
      >
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

/**
 * Write-only key field. Without a key it shows the input and Save; with one it shows only that a key
 * is set and Remove, since a saved key is never shown again.
 */
export function SecretField({ bridge, name, label, secrets, onStatus }: SecretFieldProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Only a success fades; a failure stays until the next try.
  const [succeeded, setSucceeded] = useState(false);
  useAutoDismiss(succeeded && message !== null, () => setMessage(null));
  const isSet = secrets.keys[name];

  async function save() {
    try {
      onStatus(await bridge.secrets.set(name, value));
      setValue("");
      setMessage(t("settings.secrets.keySaved"));
      setSucceeded(true);
    } catch {
      setMessage(t("settings.secrets.keyFailed"));
      setSucceeded(false);
    }
  }

  async function remove() {
    try {
      onStatus(await bridge.secrets.clear(name));
      setMessage(t("settings.secrets.keyRemoved"));
      setSucceeded(true);
    } catch {
      setMessage(t("settings.secrets.removeFailed"));
      setSucceeded(false);
    }
  }

  const storageNote = t("settings.secrets.storagePlain");

  return (
    <div className="flex flex-col gap-2">
      {isSet ? (
        <p className="text-sm font-medium text-app-fg">{label}</p>
      ) : (
        <TextInput
          label={label}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          hint={storageNote}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={isSet ? "good" : "neutral"}>
          {isSet ? t("settings.secrets.keySet") : t("settings.secrets.keyNotSet")}
        </Badge>
        <span role="status" className="text-xs text-app-muted">
          {message}
        </span>
        <span className="flex-1" />
        {/* A saved key is not shown again: the field and Save give way to Remove. */}
        {isSet ? (
          <Button variant="danger" size="sm" onClick={() => void remove()}>
            {t("settings.secrets.remove")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void save()}
            disabled={value.trim() === ""}
          >
            {t("settings.secrets.save")}
          </Button>
        )}
      </div>
    </div>
  );
}
