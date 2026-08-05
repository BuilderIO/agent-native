import { registerOnboardingStep } from "@agent-native/core/onboarding";
import {
  registerNativeResourceCaptureAdapter,
  setupCreativeContext,
} from "@agent-native/creative-context/server";
import { listContextSources } from "@agent-native/creative-context/store";

import { nativeDocumentCreativeContextAdapter } from "../lib/native-creative-context.js";

registerOnboardingStep({
  id: "creative-context-library",
  order: 18,
  required: false,
  title: "Connect your creative library",
  description:
    "Connect prior work and reference sources so agents can reuse approved creative context.",
  methods: [
    {
      id: "library",
      kind: "link",
      primary: true,
      label: "Open Library",
      payload: { url: "/agent#library", external: false },
    },
  ],
  isComplete: async () => {
    try {
      const result = await listContextSources({ limit: 1 });
      return result.sources.length > 0;
    } catch {
      return false;
    }
  },
});

registerNativeResourceCaptureAdapter(nativeDocumentCreativeContextAdapter);

export default setupCreativeContext({ appId: "content" });
