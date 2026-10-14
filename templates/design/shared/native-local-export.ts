import { z } from "zod";

export const NATIVE_LOCAL_EXPORT_PENDING_MS = 90_000;
export const NATIVE_LOCAL_EXPORT_RUNNING_MS = 15 * 60_000;
export const NATIVE_RENDER_CONTEXT_TTL_MS = 45_000;
export const NATIVE_RENDER_CONTEXT_LIMIT = 8;
export const NATIVE_RENDER_CONTEXT_LEDGER_KEY = "native-render-contexts-v1";

export const nativeRenderContextSchema = z
  .object({
    tabId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
    designId: z.string().min(1).max(128),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();
export type NativeRenderContext = z.infer<typeof nativeRenderContextSchema>;
export const nativeRenderContextLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    contexts: z
      .array(nativeRenderContextSchema)
      .max(NATIVE_RENDER_CONTEXT_LIMIT),
  })
  .strict();

export const nativeLocalExportOptionsSchema = z
  .object({
    format: z.literal("png"),
    viewport: z
      .object({
        width: z.number().int().min(1).max(4096),
        height: z.number().int().min(1).max(4096),
      })
      .strict(),
    pixelRatio: z.number().finite().gt(0).max(4),
  })
  .strict()
  .refine(({ viewport, pixelRatio }) => {
    const width = Math.ceil(viewport.width * pixelRatio);
    const height = Math.ceil(viewport.height * pixelRatio);
    return width <= 4096 && height <= 4096 && width * height <= 8_388_608;
  }, "The native PNG frame exceeds the bounded viewport.");
export const nativeLocalExportRequestSchema = z
  .object({
    designId: z.string().min(1).max(128),
    fileId: z.string().min(1).max(128),
    expectedVersionHash: z.string().min(1).max(256),
    export: nativeLocalExportOptionsSchema,
  })
  .strict();
export const nativeLocalExportFailureCodeSchema = z.enum([
  "source-stale",
  "scene-unavailable",
  "render-failed",
  "encode-failed",
  "upload-failed",
  "canceled",
  "client-unavailable",
  "navigation-unreadable",
  "editor-left",
]);
export const nativeLocalExportStateSchema = nativeLocalExportRequestSchema
  .extend({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    tabId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
    status: z.enum([
      "pending",
      "running",
      "uploading",
      "cancel-requested",
      "canceled",
      "download-initiated",
      "completed",
      "failed",
      "expired",
    ]),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    ownerDocumentId: z.string().uuid().optional(),
    attachmentRef: z.string().min(1).max(4096).optional(),
    attachmentBytes: z
      .number()
      .int()
      .min(1)
      .max(40 * 1024 * 1024)
      .optional(),
    failure: z
      .object({
        code: nativeLocalExportFailureCodeSchema,
        message: z.string().max(300),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (state) =>
      state.status !== "completed" ||
      (Boolean(state.attachmentRef) && Boolean(state.attachmentBytes)),
    "Completed PNG state requires a verified attachment.",
  );
export type NativeLocalExportState = z.infer<
  typeof nativeLocalExportStateSchema
>;
export function nativeLocalExportStateKey(
  designId: string,
  tabId: string,
): string {
  return `native-local-export:${designId}:${tabId}`;
}
