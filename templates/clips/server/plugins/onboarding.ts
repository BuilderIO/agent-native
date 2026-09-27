import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import {
  createOnboardingPlugin,
  registerOnboardingStep,
} from "@agent-native/core/onboarding";
import { registerPrivateBlobProvider } from "@agent-native/core/private-blob";

import {
  clipsOrganizationLogoPrivateBlobProvider,
  s3FileUploadProvider,
} from "../lib/s3-upload-provider.js";
import { hasRequestVideoStorage } from "../lib/video-storage.js";

const basePlugin = createOnboardingPlugin();

export default async (nitroApp: any): Promise<void> => {
  await basePlugin(nitroApp);

  registerFileUploadProvider(s3FileUploadProvider);
  registerPrivateBlobProvider(clipsOrganizationLogoPrivateBlobProvider);

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
        kind: "form",
        label: "Use S3-compatible storage",
        description:
          "AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, or any S3-compatible service.",
        payload: {
          writeScope: "workspace",
          saveTo: "scoped-secrets",
          secretDescription: "Clips S3-compatible storage",
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
    isComplete: hasRequestVideoStorage,
  });
};
