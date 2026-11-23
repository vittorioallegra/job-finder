import { useState } from "react";

/**
 * The user's cloud-AI consent, bound to the provider and host it was given for (`aiConsentTarget`).
 * When the provider or base URL changes, the target differs and the consent reads as not given, so
 * the checkbox clears and has to be ticked again. `target` is null until the settings are loaded.
 */
export function useAiConsent(target: string | null): {
  consent: boolean;
  /** Send this with the request as `consentTarget`. */
  consentTarget: string | undefined;
  setConsent: (value: boolean) => void;
} {
  const [grantedFor, setGrantedFor] = useState<string | null>(null);
  return {
    consent: target !== null && grantedFor === target,
    consentTarget: target ?? undefined,
    setConsent: (value) => setGrantedFor(value ? target : null),
  };
}
