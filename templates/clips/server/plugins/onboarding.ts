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
        label: "Use Builder.io",
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
