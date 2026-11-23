import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AiTestResult, JobFinderBridge, SecretName, SecretsStatus } from "@job-finder/bridge";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";

type AiTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "done"; result: AiTestResult }
  | { status: "error" };

/** Runs the engine-side test of the saved AI settings. Shows loading, connected, or AI unavailable with a reason. */
export function AiConnectionTest({ bridge }: { bridge: JobFinderBridge }) {
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
export function SecretField({ bridge, name, label, secrets, onStatus }: SecretFieldProps) {
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
