import { registerOnboardingStep } from "@agent-native/core/onboarding";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";

import { readBrainSettings } from "./lib/brain.js";
import { probeJevCredential } from "./lib/jev-classifier.js";
import { brainPrivacyReadiness } from "./lib/privacy-readiness.js";

registerOnboardingStep({
  id: "brain-privacy-classifier",
  order: 16,
  required: false,
  title: "Configure Brain privacy classification",
  description:
    "Choose how captures are reviewed before storage: Jev, an approved model and engine, or deterministic screening alone. Until a classifier is reachable, deterministic-clean content can be stored but uncertain content is quarantined and unavailable to search or agents.",
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
      const settings = await readBrainSettings();
      return brainPrivacyReadiness(
        settings,
        await probeJevCredential({
          ownerEmail: getRequestUserEmail() ?? "",
          orgId: getRequestOrgId(),
        }),
      ).configured;
    } catch {
      return false;
    }
  },
});
