import { registerOnboardingStep } from "@agent-native/core/onboarding";

import { readBrainSettings } from "./lib/brain.js";
import { brainPrivacyReadiness } from "./lib/privacy-readiness.js";

registerOnboardingStep({
  id: "brain-privacy-classifier",
  order: 16,
  required: false,
  title: "Configure Brain privacy classification",
  description:
    "Choose the approved model and engine that review captures before storage. Until configured, deterministic-clean content can be stored but uncertain content is quarantined and unavailable to search or agents.",
  methods: [
    {
      id: "settings",
      kind: "link",
      primary: true,
      label: "Open Brain privacy settings",
      payload: { url: "/settings", external: false },
    },
  ],
  isComplete: async () => {
    try {
      return brainPrivacyReadiness(await readBrainSettings()).configured;
    } catch {
      return false;
    }
  },
});
