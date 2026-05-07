/**
 * Custom onboarding plugin for Images.
 *
 * Lead with Builder-managed image generation (one-click, org-shared
 * credential) while keeping S3-compatible storage explicit for originals,
 * thumbnails, and exports.
 *
 * Why it lives here: must be in server/plugins/ so the framework skips its
 * default onboarding plugin, and all step registrations share the same module
 * context as the framework onboarding route handlers (in-memory Map).
 */

import {
  createOnboardingPlugin,
  registerOnboardingStep,
} from "@agent-native/core/onboarding";
import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import {
  resolveHasBuilderPrivateKey,
  resolveSecret,
} from "@agent-native/core/server";
import { isObjectStorageConfigured } from "../lib/storage.js";
import { s3FileUploadProvider } from "../lib/s3-upload-provider.js";
import { isBuilderImageGenerationEnabled } from "../lib/generation.js";

const basePlugin = createOnboardingPlugin();

const builderImageGenerationEnabled = isBuilderImageGenerationEnabled();

export default async (nitroApp: any): Promise<void> => {
  await basePlugin(nitroApp);

  // Register the S3-compatible upload provider. It self-checks env vars
  // (IMAGES_STORAGE_* / S3_*) and only activates when configured. The
  // framework falls through to Builder.io storage when BUILDER_PRIVATE_KEY
  // is set, then to the SQL fallback in dev.
  registerFileUploadProvider(s3FileUploadProvider);

  registerOnboardingStep({
    id: "image-generation",
    order: 14,
    required: true,
    title: "Image generation",
    description:
      "Use Builder-managed image generation, or add a Gemini key as a manual fallback.",
    methods: [
      {
        id: "builder",
        kind: "builder-cli-auth",
        label: "Connect Builder.io",
        description: builderImageGenerationEnabled
          ? "Recommended one-click setup. Uses Builder credits and keeps provider keys out of this app."
          : "Disabled by BUILDER_IMAGE_GENERATION_ENABLED=false. Use a Gemini key for this deployment.",
        primary: true,
        badge: builderImageGenerationEnabled ? "recommended" : undefined,
        disabled: !builderImageGenerationEnabled,
        disabledLabel: "Disabled",
        payload: { scope: "image-generation" },
      },
      {
        id: "gemini-key",
        kind: "form",
        label: "Gemini API key",
        description:
          "Secondary BYOK option for local development or teams that want to pay Google directly.",
        payload: {
          writeScope: "workspace",
          fields: [
            {
              key: "GEMINI_API_KEY",
              label: "GEMINI_API_KEY",
              placeholder: "AIza...",
              secret: true,
            },
          ],
        },
      },
    ],
    isComplete: async () => {
      if (builderImageGenerationEnabled) {
        try {
          if (await resolveHasBuilderPrivateKey()) return true;
        } catch {
          // Fall through to the manual key fallback.
        }
      }
      return !!(await resolveSecret("GEMINI_API_KEY").catch(() => null));
    },
  });

  registerOnboardingStep({
    id: "image-storage",
    order: 16,
    required: true,
    title: "Image storage",
    description:
      "Images needs S3-compatible object storage for original images, thumbnails, and cross-agent exports.",
    methods: [
      {
        id: "s3",
        kind: "form",
        label: "Use S3-compatible storage",
        description:
          "AWS S3, Cloudflare R2, DigitalOcean Spaces, Tigris, MinIO, or another S3-compatible provider.",
        payload: {
          writeScope: "workspace",
          fields: [
            { key: "IMAGES_STORAGE_BUCKET", label: "Bucket name" },
            {
              key: "IMAGES_STORAGE_REGION",
              label: "Region",
              placeholder: "auto",
            },
            {
              key: "IMAGES_STORAGE_ENDPOINT",
              label: "Endpoint URL",
              placeholder: "https://<account>.r2.cloudflarestorage.com",
            },
            { key: "IMAGES_STORAGE_ACCESS_KEY_ID", label: "Access key ID" },
            {
              key: "IMAGES_STORAGE_SECRET_ACCESS_KEY",
              label: "Secret access key",
              secret: true,
            },
            {
              key: "IMAGES_STORAGE_PUBLIC_BASE_URL",
              label: "Public base URL (optional)",
              placeholder: "https://cdn.example.com",
            },
          ],
        },
      },
    ],
    isComplete: async () => isObjectStorageConfigured(),
  });
};
