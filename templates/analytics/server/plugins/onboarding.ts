/**
 * Custom onboarding plugin for Analytics.
 *
 * Overrides the framework's default onboarding plugin to add an optional
 * "Session replay storage" step and register the S3 file upload provider. Must
 * live in server/plugins/ so the framework skips its default onboarding plugin,
 * and all registrations share the same module context as the onboarding route
 * handlers (which read from the same in-memory Map).
 *
 * The step is `required: false` because session replay is opt-in: capturing
 * replays only matters once a site embeds the tracking SDK with replay enabled,
 * so we surface storage setup without forcing it into the onboarding checklist.
 */

import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import {
  createOnboardingPlugin,
  registerOnboardingStep,
} from "@agent-native/core/onboarding";

import { hasRequestReplayStorage } from "../lib/replay-storage.js";
import { s3FileUploadProvider } from "../lib/s3-upload-provider.js";

const basePlugin = createOnboardingPlugin();

export default async (nitroApp: any): Promise<void> => {
  // Mount the framework's default onboarding plugin (routes + default steps).
  await basePlugin(nitroApp);

  // Register S3-compatible file upload provider for session-replay chunks.
  registerFileUploadProvider(s3FileUploadProvider);

  // Add the optional "Session replay storage" onboarding step.
  registerOnboardingStep({
    id: "replay-storage",
    order: 15,
    required: false,
    title: "Session replay storage",
    description:
      "Store session replay recordings with Builder.io or S3-compatible storage.",
    methods: [
      {
        id: "builder",
        kind: "builder-cli-auth",
        label: "Connect Builder.io",
        description:
          "Builder.io's free tier includes object storage for replay chunks.",
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
              placeholder: "my-replays-bucket",
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
    isComplete: hasRequestReplayStorage,
  });
};
