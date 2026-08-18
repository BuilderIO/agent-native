import type { BrainSettings } from "../../shared/types.js";

export interface BrainPrivacyReadiness {
  configured: boolean;
  model: string | null;
  engine: string | null;
  warning: string | null;
}

export function brainPrivacyReadiness(
  settings: BrainSettings,
): BrainPrivacyReadiness {
  const model = settings.privacyClassifierModel?.trim() || null;
  const engine = settings.privacyClassifierEngine?.trim() || null;
  const configured = Boolean(model && engine);
  return {
    configured,
    model: configured ? model : null,
    engine: configured ? engine : null,
    warning: configured
      ? null
      : "No approved privacy classifier is configured. Deterministic-clean captures may be stored; uncertain captures are quarantined and deterministic hard-category captures are suppressed. Neither can be searched, cited, distilled, or exposed to agents.",
  };
}
