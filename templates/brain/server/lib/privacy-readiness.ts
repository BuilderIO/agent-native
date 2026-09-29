import type { BrainSettings } from "../../shared/types.js";
import {
  resolveClassifierPreference,
  type JevClassifierPreference,
  type JevCredentialStatus,
} from "./jev-classifier.js";

export type BrainJevCredentialStatus = JevCredentialStatus;

export interface BrainPrivacyReadiness {
  configured: boolean;
  classifier: JevClassifierPreference;
  model: string | null;
  engine: string | null;
  jevCredential: BrainJevCredentialStatus;
  warning: string | null;
}

const UNCONFIGURED_WARNING =
  "No approved privacy classifier is configured. Deterministic-clean captures may be stored; uncertain captures are quarantined and deterministic hard-category captures are suppressed. Neither can be searched, cited, distilled, or exposed to agents.";

export function brainPrivacyReadiness(
  settings: BrainSettings,
  jevCredential: BrainJevCredentialStatus,
): BrainPrivacyReadiness {
  const classifier = resolveClassifierPreference(settings);
  const model = settings.privacyClassifierModel?.trim() || null;
  const engine = settings.privacyClassifierEngine?.trim() || null;
  const modelConfigured = Boolean(model && engine);
  const jevReady =
    jevCredential === "stored-key" || jevCredential === "builder-gateway";

  const base = {
    classifier,
    model: modelConfigured ? model : null,
    engine: modelConfigured ? engine : null,
    jevCredential,
  };

  if (classifier === "deterministic") {
    return {
      ...base,
      configured: false,
      warning:
        "Deterministic-only screening is selected. Captures are screened by pattern rules alone; anything uncertain is quarantined and never searched, cited, or distilled.",
    };
  }

  if (classifier === "jev") {
    if (jevReady) return { ...base, configured: true, warning: null };
    if (modelConfigured) {
      return {
        ...base,
        configured: true,
        warning:
          jevCredential === "unavailable"
            ? "The Jev credential lookup failed, so Brain is classifying with the approved model instead. Check JEV_API_KEY or the Builder connection."
            : "Jev is selected but no credential was found, so Brain is classifying with the approved model instead. Add JEV_API_KEY or connect Builder.",
      };
    }
    return {
      ...base,
      configured: false,
      warning:
        jevCredential === "unavailable"
          ? "The Jev credential lookup failed and no approved model is configured. Uncertain captures stay quarantined until a classifier is reachable."
          : "Jev is selected but no credential was found and no approved model is configured. Add JEV_API_KEY, connect Builder, or configure an approved model.",
    };
  }

  return modelConfigured
    ? { ...base, configured: true, warning: null }
    : { ...base, configured: false, warning: UNCONFIGURED_WARNING };
}
