import {
  createOnboardingPlugin,
  registerOnboardingStep,
} from "@agent-native/core/onboarding";
import { isObjectStorageConfigured } from "../lib/storage.js";

const basePlugin = createOnboardingPlugin();

export default async (nitroApp: any): Promise<void> => {
  await basePlugin(nitroApp);

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
