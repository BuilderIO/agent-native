/**
 * Custom onboarding plugin for Assets.
 *
 * Lead with Builder-managed image generation (one-click, org-shared
 * credential) and Gemini for video generation while keeping S3-compatible
 * storage explicit for originals, thumbnails, videos, and exports.
 *
 * Why it lives here: must be in server/plugins/ so the framework skips its
 * default onboarding plugin, and all step registrations share the same module
 * context as the framework onboarding route handlers (in-memory Map).
 */

import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import {
  createOnboardingPlugin,
  registerOnboardingStep,
} from "@agent-native/core/onboarding";
import {
  resolveHasCompleteBuilderConnection,
  resolveSecret,
} from "@agent-native/core/server";

import { isBuilderImageGenerationEnabled } from "../lib/generation.js";
import { s3FileUploadProvider } from "../lib/s3-upload-provider.js";
import { isObjectStorageConfigured } from "../lib/storage.js";

const basePlugin = createOnboardingPlugin();

const builderImageGenerationEnabled = isBuilderImageGenerationEnabled();

export default async (nitroApp: any): Promise<void> => {
  await basePlugin(nitroApp);

  // Register the S3-compatible upload provider. It self-checks env vars
  // (ASSETS_STORAGE_* / legacy IMAGES_STORAGE_* / S3_*) and only activates when configured. The
  // framework falls through to Builder.io storage when BUILDER_PRIVATE_KEY
  // is set, then to the SQL fallback in dev.
  registerFileUploadProvider(s3FileUploadProvider);

  registerOnboardingStep({
    id: "image-generation",
    order: 14,
    required: true,
    title: "Image and video generation",
    description:
      "Connect Builder for managed image generation, or add OpenAI/Gemini keys manually. Gemini is required for video generation.",
    methods: [
      {
        id: "builder",
        kind: "builder-cli-auth",
        label: "Connect Builder.io",
        description: builderImageGenerationEnabled
          ? "Recommended one-click setup for image generation. Uses Builder credits and keeps provider keys out of this app."
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
          "Powers video generation and can also generate image fallbacks.",
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
      {
        id: "openai-key",
        kind: "form",
        label: "OpenAI API key",
        description:
          "Optional manual fallback for image generation when Builder is not connected.",
        payload: {
          writeScope: "workspace",
          fields: [
            {
              key: "OPENAI_API_KEY",
              label: "OPENAI_API_KEY",
              placeholder: "sk-...",
              secret: true,
            },
          ],
        },
      },
    ],
    isComplete: async () => {
      if (builderImageGenerationEnabled) {
        try {
          if (await resolveHasCompleteBuilderConnection()) return true;
        } catch {
          // Fall through to the manual key fallback.
        }
      }
      const [gemini, openai] = await Promise.all([
        resolveSecret("GEMINI_API_KEY").catch(() => null),
        resolveSecret("OPENAI_API_KEY").catch(() => null),
      ]);
      return !!(gemini || openai);
    },
  });

  registerOnboardingStep({
    id: "image-storage",
    order: 16,
    required: true,
    title: "Asset storage",
    description:
      "Assets needs S3-compatible object storage for original images, videos, thumbnails, and cross-agent exports.",
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
            { key: "ASSETS_STORAGE_BUCKET", label: "Bucket name" },
            {
              key: "ASSETS_STORAGE_REGION",
              label: "Region",
              placeholder: "auto",
            },
            {
              key: "ASSETS_STORAGE_ENDPOINT",
              label: "Endpoint URL",
              placeholder: "https://<account>.r2.cloudflarestorage.com",
            },
            { key: "ASSETS_STORAGE_ACCESS_KEY_ID", label: "Access key ID" },
            {
              key: "ASSETS_STORAGE_SECRET_ACCESS_KEY",
              label: "Secret access key",
              secret: true,
            },
            {
              key: "ASSETS_STORAGE_PUBLIC_BASE_URL",
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
