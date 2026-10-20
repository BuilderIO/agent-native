import { registerOnboardingStep } from "@agent-native/core/onboarding";
import {
  isCreativeContextLabAvailable,
  registerNativeResourceCaptureAdapter,
  setupCreativeContext,
} from "@agent-native/creative-context/server";
import { listContextSources } from "@agent-native/creative-context/store";

import { CONTENT_CREATIVE_CONTEXT } from "../../shared/labs.js";
import { nativeDocumentCreativeContextAdapter } from "../lib/native-creative-context.js";

registerOnboardingStep({
  id: "creative-context-library",
  order: 18,
  required: false,
  title: "Connect your creative library",
  description:
    "Connect prior work and reference sources so agents can reuse approved creative context.",
  isAvailable: (context) =>
    isCreativeContextLabAvailable(
      context?.userEmail,
      CONTENT_CREATIVE_CONTEXT.key,
    ),
  methods: [
    {
      id: "library",
      kind: "link",
      primary: true,
      label: "Open Library",
      payload: { url: "/settings/library", external: false },
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

export default setupCreativeContext({
  appId: "content",
  labKey: CONTENT_CREATIVE_CONTEXT.key,
});
