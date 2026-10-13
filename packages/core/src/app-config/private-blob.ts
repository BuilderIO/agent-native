import { z } from "zod";

export const privateBlobConfig = z.object({
  provider: z.string().min(1).optional().meta({
    doc: "Id of the registered private blob provider to use. Unset falls back to the first registered provider that reports itself configured.",
  }),
  publicUploadFallback: z.boolean().default(true).meta({
    env: "AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK",
    doc: "Store private blobs as encrypted objects in public file-upload storage when no private blob provider is configured.",
  }),
});
