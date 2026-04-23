/**
 * Custom onboarding plugin for Clips.
 *
 * Overrides the framework's default onboarding plugin to add the required
 * "Video storage" step and register the S3 file upload provider. Must live
 * in server/plugins/ so the framework skips its default onboarding plugin,
 * and all registrations share the same module context as the onboarding
 * route handlers (which read from the same in-memory Map).
 */

import { createOnboardingPlugin } from "@agent-native/core/onboarding";
import { registerOnboardingStep } from "@agent-native/core/onboarding";
import {
  getActiveFileUploadProvider,
  registerFileUploadProvider,
} from "@agent-native/core/file-upload";
import { s3FileUploadProvider } from "../lib/s3-upload-provider.js";

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
    title: "Video storage",
    description:
      "Clips needs a file storage provider for recorded videos. Builder.io is free and one click.",
    methods: [
      {
        id: "builder",
        kind: "builder-cli-auth",
        label: "Connect Builder.io",
        description:
          "One-click setup — also unlocks LLM + browser automation. Free during beta.",
        primary: true,
        badge: "free",
        payload: { scope: "browser" },
      },
      {
        id: "s3",
        kind: "form",
        label: "Use S3-compatible storage",
        description:
          "AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, or any S3-compatible service.",
        payload: {
          writeScope: "workspace",
          fields: [
            {
              key: "S3_ENDPOINT",
              label: "Endpoint URL",
              placeholder: "https://s3.us-east-1.amazonaws.com",
            },
            {
              key: "S3_BUCKET",
              label: "Bucket name",
              placeholder: "my-clips-bucket",
            },
            {
              key: "S3_ACCESS_KEY_ID",
              label: "Access key ID",
              placeholder: "AKIA...",
            },
            {
              key: "S3_SECRET_ACCESS_KEY",
              label: "Secret access key",
              secret: true,
            },
            {
              key: "S3_REGION",
              label: "Region (optional)",
              placeholder: "us-east-1",
            },
            {
              key: "S3_PUBLIC_BASE_URL",
              label: "Public base URL (optional)",
              placeholder: "https://cdn.example.com",
            },
          ],
        },
      },
    ],
    isComplete: () => !!getActiveFileUploadProvider(),
  });
};
