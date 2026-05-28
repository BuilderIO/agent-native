/**
 * Custom onboarding plugin for Content.
 *
 * Mounts the framework default onboarding routes and adds an optional
 * "Media uploads" step so document media blocks point users at Builder.io file
 * storage when they need uploads.
 */

import {
  createOnboardingPlugin,
  registerOnboardingStep,
} from "@agent-native/core/onboarding";
import { getActiveFileUploadProvider } from "@agent-native/core/file-upload";
import { resolveHasBuilderPrivateKey } from "@agent-native/core/server";

const basePlugin = createOnboardingPlugin();

export default async (nitroApp: any): Promise<void> => {
  await basePlugin(nitroApp);

  registerOnboardingStep({
    id: "media-uploads",
    order: 15,
    required: false,
    title: "Media uploads",
    description:
      "Connect Builder.io to upload and embed images, videos, and audio files in Content documents.",
    methods: [
      {
        id: "builder",
        kind: "builder-cli-auth",
        label: "Connect Builder.io",
        description:
          "One-click file storage for media blocks. Free during beta.",
        primary: true,
        badge: "free",
        payload: { scope: "browser" },
      },
    ],
    isComplete: async () => {
      const active = getActiveFileUploadProvider();
      if (active && active.id !== "builder") return true;
      try {
        if (await resolveHasBuilderPrivateKey()) return true;
      } catch {
        // Fall back to sync provider status below.
      }
      return !!active;
    },
  });
};
