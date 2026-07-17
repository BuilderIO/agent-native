import { registerOnboardingStep } from "@agent-native/core/onboarding";
import { setupCreativeContext } from "@agent-native/creative-context/server";
import { listContextSources } from "@agent-native/creative-context/store";

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

export default setupCreativeContext({ appId: "design" });
