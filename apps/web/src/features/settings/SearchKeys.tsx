import { useTranslation } from "react-i18next";
import type { JobFinderBridge, SecretName, SecretsStatus } from "@job-finder/bridge";
import { SecretField } from "./AiControls";

interface SearchKeyProps {
  bridge: JobFinderBridge;
  provider: "brave" | "tavily" | "serper";
  /** Where the free key is made. */
  site: string;
  secrets: SecretsStatus;
  onStatus: (status: SecretsStatus) => void;
}

/** The key of one search service. A service with a key is used when DuckDuckGo cannot answer. */
export function SearchKey({ bridge, provider, site, secrets, onStatus }: SearchKeyProps) {
  const { t } = useTranslation();
  const name: SecretName = `search.${provider}`;
  const service = t(`settings.search.${provider}`);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-app-muted">{t("settings.search.site", { site })}</p>
      <SecretField
        bridge={bridge}
        name={name}
        label={t("settings.search.keyLabel", { name: service })}
        secrets={secrets}
        onStatus={onStatus}
      />
    </div>
  );
}
