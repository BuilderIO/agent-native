import { registerOnboardingStep } from "../onboarding/registry.js";
import type { OnboardingStep } from "../onboarding/types.js";

export interface RegisterWorkspaceConnectionOnboardingStepOptions {
  id?: string;
  providerId: string;
  providerLabel?: string;
  title?: string;
  description?: string;
  order?: number;
  required?: boolean;
  settingsUrl?: string;
  isComplete: OnboardingStep["isComplete"];
}

export function registerWorkspaceConnectionOnboardingStep({
  id,
  providerId,
  providerLabel,
  title,
  description,
  order = 50,
  required = false,
  settingsUrl = "/settings#connections",
  isComplete,
}: RegisterWorkspaceConnectionOnboardingStepOptions): void {
  const label = providerLabel ?? providerId;
  registerOnboardingStep({
    id: id ?? `${providerId}-connection`,
    title: title ?? `Connect ${label}`,
    description:
      description ??
      `Connect ${label} so the app and agent can use the shared workspace connection.`,
    order,
    required,
    methods: [
      {
        id: "settings",
        kind: "link",
        label: "Open connections",
        primary: true,
        payload: { url: settingsUrl },
      },
    ],
    isComplete,
  });
}
