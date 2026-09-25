import { z } from "zod";

import { defineAction } from "../../action.js";
import { clearFileStorage, saveFileStorage } from "../storage-settings.js";

const text = (description: string) =>
  z.string().max(2048).optional().describe(description);

export default defineAction({
  description:
    'Save or clear the workspace\'s S3-compatible file storage (Amazon S3, Cloudflare R2, Supabase Storage, or another S3-compatible service). Owners and admins only. "save" writes the given values and keeps saved keys that are omitted; the first save needs endpoint, bucket, access key ID, secret access key, and a public URL unless get-file-storage reports publicUrlRequired: false. "clear" deletes every saved storage key, so new uploads go to Builder.io storage when it is connected and fail otherwise; existing files stay in the bucket. Call get-file-storage first to see what is saved.',
  schema: z.object({
    operation: z
      .enum(["save", "clear"])
      .describe('"save" to write values, "clear" to delete every saved key.'),
    endpoint: text(
      'save: the S3 API endpoint URL, e.g. "https://s3.us-west-2.amazonaws.com" or "https://<account-id>.r2.cloudflarestorage.com". Omit to keep the saved one.',
    ),
    bucket: text("save: the bucket name. Omit to keep the saved one."),
    accessKeyId: text("save: the access key ID. Omit to keep the saved one."),
    secretAccessKey: text(
      "save: the secret access key. Omit to keep the saved one.",
    ),
    region: text(
      'save: the region, e.g. "us-east-1". Pass "" to remove it; omit to keep it.',
    ),
    publicBaseUrl: text(
      'save: the public base URL files are served from, e.g. "https://cdn.example.com". Pass "" to remove it when it is optional; omit to keep it.',
    ),
  }),
  // Pointing every upload in the organization at another bucket is not
  // something a sandboxed extension should be able to do.
  toolCallable: false,
  audit: {
    recordInputs: false,
    target: () => ({
      type: "file-storage",
      id: "workspace",
      visibility: "org",
    }),
    summary: (args) =>
      args.operation === "clear"
        ? "Cleared file storage credentials"
        : "Saved file storage settings",
  },
  run: async ({ operation, ...values }, ctx) =>
    operation === "clear"
      ? clearFileStorage(ctx)
      : { removedKeys: [], status: await saveFileStorage(ctx, values) },
});
