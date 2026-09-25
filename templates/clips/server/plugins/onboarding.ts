/**
 * Custom onboarding plugin for Clips.
 *
 * Overrides the framework's default onboarding plugin to add the required
 * "Video storage" step and register the S3 file upload provider. Must live
 * in server/plugins/ so the framework skips its default onboarding plugin,
 * and all registrations share the same module context as the onboarding
 * route handlers (which read from the same in-memory Map).
 */

import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import {
  createOnboardingPlugin,
  registerOnboardingStep,
} from "@agent-native/core/onboarding";

import { s3FileUploadProvider } from "../lib/s3-upload-provider.js";
import { hasRequestVideoStorage } from "../lib/video-storage.js";

const basePlugin = createOnboardingPlugin();

export default async (nitroApp: any): Promise<void> => {
  // Mount the framework's default onboarding plugin (routes + default steps).
  await basePlugin(nitroApp);

  // Register S3-compatible file upload provider.
  registerFileUploadProvider(s3FileUploadProvider);

  // Add the required "Video storage" onboarding step.
  registerOnboardingStep({
    id: "file-storage",
    order: 15,
    required: true,
    title: "Connect storage",
    description:
      "Store recorded videos with Builder.io or S3-compatible storage.",
    methods: [
      {
        id: "builder",
        kind: "builder-cli-auth",
        label: "Connect Builder.io",
        description:
          "Builder.io's free tier includes video storage and AI credits.",
        primary: true,
        badge: "free",
        payload: { scope: "browser" },
      },
      {
        id: "s3",
        kind: "file-storage",
        label: "Use S3-compatible storage",
        description:
          "AWS S3, Cloudflare R2, Supabase Storage, MinIO, or any S3-compatible service.",
      },
    ],
    isComplete: hasRequestVideoStorage,
  });
};
