import {
  aiConsentTarget,
  hasAiConsent,
  isCloudAiEndpoint,
  type AiTestFailureCode,
} from "@job-finder/bridge";
import type { AiFieldAnswer, FormField } from "@job-finder/core/ats/autofill";
import type { AutofillMapOutcome } from "@job-finder/core/ats/autofill/ai";
import type { DocumentLanguage } from "@job-finder/core/documents/language";
import type { Profile } from "@job-finder/core/profile";
import type { MapFormFieldsRequest } from "../../engine/protocol";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";

/** The engine side of the form mapping, as seen from main. */
export interface AutofillAiEngine {
  mapFormFields(request: MapFormFieldsRequest): Promise<AutofillMapOutcome>;
}

export interface AiFillOptions {
  settings: Pick<SettingsRepository, "get">;
  secrets: Pick<SecretStore, "read">;
  engine: AutofillAiEngine;
  /** The language of the drafts for an application: the posting's, else the UI's. */
  language(applicationId: string): Promise<DocumentLanguage>;
}

/** Whether an AI provider is set up, and whether it is a cloud service that needs consent. */
export type AiFillStatus =
  { state: "not-configured" } | { state: "ready"; cloud: boolean; consentTarget: string };

/** The answer of the AI, or the reason it could not answer. */
export type AiFillOutcome =
  { ok: true; answers: AiFieldAnswer[] } | { ok: false; code: AiTestFailureCode };

export interface AiFill {
  status(): Promise<AiFillStatus>;
  /**
   * Asks the AI to map the given fields. The profile and the fields leave the machine only for a
   * cloud provider, which the caller has checked for consent first.
   */
  map(input: {
    applicationId: string;
    profile: Profile;
    fields: FormField[];
    /** The user's consent for this run and the provider and host it was given for. */
    consent: boolean;
    consentTarget?: string | undefined;
  }): Promise<AiFillOutcome>;
}

/**
 * Main's side of the autofill AI fallback. The provider settings and the saved key are read here
 * and handed to the engine, which makes the call; the answer goes back to the service unchanged.
 */
export function createAutofillAi(options: AiFillOptions): AiFill {
  return {
    async status() {
      const { ai } = await options.settings.get();
      const configured =
        ai.model.trim() !== "" && (ai.provider !== "openai-compatible" || ai.baseUrl.trim() !== "");
      return configured
        ? { state: "ready", cloud: isCloudAiEndpoint(ai), consentTarget: aiConsentTarget(ai) }
        : { state: "not-configured" };
    },

    async map({ applicationId, profile, fields, consent, consentTarget }) {
      // The settings are read again here, after the page has loaded: the provider may have changed
      // since the consent was checked, and a cloud provider never gets the profile without it.
      const { ai } = await options.settings.get();
      if (!hasAiConsent(ai, { consent, consentTarget })) {
        return { ok: false, code: "not-configured" };
      }
      const apiKey = await options.secrets.read("ai.apiKey");
      const language = await options.language(applicationId);
      try {
        const outcome = await options.engine.mapFormFields({
          fields,
          profile,
          language,
          ai: {
            config: { provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl, apiKey },
            contextSize: ai.contextSize,
          },
        });
        return outcome.ok ? outcome : { ok: false, code: outcome.code };
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { ok: false, code: "engine-unavailable" };
        }
        return { ok: false, code: "unknown" };
      }
    },
  };
}
