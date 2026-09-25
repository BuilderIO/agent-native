/**
 * Custom onboarding plugin for Assets.
 *
 * Lead with Builder-managed image and video generation (one-click,
 * org-shared credential) while keeping S3-compatible storage explicit for
 * originals, thumbnails, videos, and exports.
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
  BuilderCredentialLookupError,
  resolveHasBuilderGatewayCredential,
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
      "Connect Builder for managed image generation and video generation when enabled for your space, or add OpenAI/Gemini keys as manual fallbacks.",
    methods: [
      {
        id: "builder",
        kind: "builder-cli-auth",
        label: "Connect Builder.io",
        description: builderImageGenerationEnabled
          ? "Recommended one-click setup for managed image generation and video generation when enabled for your space. Uses Builder credits and keeps provider keys out of this app."
          : "Managed image generation is disabled here. Connect Builder for video when your space supports it, or add Gemini/OpenAI keys for manual generation.",
        primary: true,
        badge: builderImageGenerationEnabled ? "recommended" : undefined,
        payload: { scope: "image-generation" },
      },
      {
        id: "gemini-key",
        kind: "form",
        label: "Gemini API key",
        description:
          "Manual video-generation option and optional image-generation fallback.",
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
      let builderLookupError: BuilderCredentialLookupError | undefined;
      try {
        if (await resolveHasBuilderGatewayCredential()) return true;
      } catch (error) {
        if (!(error instanceof BuilderCredentialLookupError)) throw error;
        builderLookupError = error;
      }

      const manualLookups = await Promise.allSettled([
        resolveSecret("GEMINI_API_KEY"),
        resolveSecret("OPENAI_API_KEY"),
      ]);
      if (
        manualLookups.some(
          (result) => result.status === "fulfilled" && Boolean(result.value),
        )
      ) {
        return true;
      }
      const manualLookupFailure = manualLookups.find(
        (result) => result.status === "rejected",
      );
      if (manualLookupFailure?.status === "rejected") {
        throw manualLookupFailure.reason;
      }
      if (builderLookupError) throw builderLookupError;
      return false;
    },
  });

  registerOnboardingStep({
    id: "image-storage",
    order: 16,
    required: false,
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
