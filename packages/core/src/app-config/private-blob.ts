import { z } from "zod";

/**
 * Private blob storage.
 *
 * `provider` names which registered provider is active. Leaving it unset keeps
 * the historical rule — the first registered provider reporting itself
 * configured — which is decided by module import order, so an app cannot state
 * its choice, only hope its provider registered first. Set it explicitly
 * whenever more than one provider can be configured in the same deployment.
 */
export const privateBlobConfig = z.object({
  provider: z.string().min(1).optional().meta({
    doc: "Id of the registered private blob provider to use. Unset falls back to the first registered provider that reports itself configured.",
  }),
  publicUploadFallback: z.boolean().default(true).meta({
    env: "AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK",
    doc: "Store private blobs as encrypted objects in public file-upload storage when no private blob provider is configured.",
  }),
});
