/**
 * Custom onboarding plugin for Analytics.
 *
 * Overrides the framework's default onboarding plugin to register the S3 file
 * upload provider. Must live in server/plugins/ so the framework skips its
 * default onboarding plugin, and all registrations share the same module
 * context as the onboarding route handlers (which read from the same in-memory
 * Map). Analytics only needs storage when someone enables session replay, so
 * replay setup lives with that workflow instead of onboarding.
 */

import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import { createOnboardingPlugin } from "@agent-native/core/onboarding";

import { s3FileUploadProvider } from "../lib/s3-upload-provider.js";

const basePlugin = createOnboardingPlugin();

export default async (nitroApp: any): Promise<void> => {
  // Mount the framework's default onboarding plugin (routes + default steps).
  await basePlugin(nitroApp);

  // Register S3-compatible file upload provider for session-replay chunks.
  registerFileUploadProvider(s3FileUploadProvider);
};
