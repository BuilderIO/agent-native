import { z } from "zod";

export const NATIVE_DRAFT_PENDING_MS = 90_000;
export const NATIVE_DRAFT_RUNNING_MS = 45_000;
const id = z.string().min(1).max(128);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);

export const nativeDraftDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    severity: z.enum(["error", "warning", "info"]),
    passId: id.optional(),
    line: z.number().int().min(1).max(100_000).optional(),
    column: z.number().int().min(1).max(100_000).optional(),
  })
  .strict();

export const nativeDraftTerminalSchema = z
  .object({
    status: z.enum(["ready", "last-good", "error"]),
    displayed: z.enum([
      "none",
      "published",
      "draft-current",
      "draft-last-good",
    ]),
    executionHash: hash.optional(),
    diagnostics: z.array(nativeDraftDiagnosticSchema).max(16),
    compileWallMs: z.number().finite().min(0).max(120_000).optional(),
    renderWallMs: z.number().finite().min(0).max(120_000).optional(),
  })
  .strict()
  .refine(
    (result) =>
      result.status !== "ready" ||
      ["draft-current", "published"].includes(result.displayed),
  )
  .refine(
    (result) =>
      result.status !== "last-good" || result.displayed === "draft-last-good",
  )
  .refine(
    (result) =>
      result.status !== "error" || result.displayed !== "draft-current",
  );

export const nativeDraftForegroundStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    designId: id,
    fileId: id,
    nodeId: id,
    instanceId: id,
    tabId: token,
    expectedVersionHash: z.string().min(1).max(256),
    baseExecutionHash: hash,
    draftExecutionHash: hash.optional(),
    draftPayloadHash: hash.optional(),
    command: z.enum(["preview", "clear"]),
    draftRef: z.string().min(1).max(4096).optional(),
    seed: z.number().int().min(0).max(1_000_000).optional(),
    time: z.number().finite().min(0).max(3600).optional(),
    status: z.enum([
      "pending",
      "running",
      "cancel-requested",
      "canceled",
      "completed",
      "failed",
      "expired",
    ]),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    result: nativeDraftTerminalSchema.optional(),
    failure: z
      .object({
        code: z.string().min(1).max(80),
        message: z.string().min(1).max(300),
      })
      .strict()
      .optional(),
  })
  .strict();

export type NativeDraftForegroundState = z.infer<
  typeof nativeDraftForegroundStateSchema
>;
export type NativeDraftTerminal = z.infer<typeof nativeDraftTerminalSchema>;

export function nativeDraftForegroundKey(
  designId: string,
  tabId: string,
): string {
  return `native-shader-draft:${designId}:${tabId}`;
}

export function publicNativeDraftState(state: NativeDraftForegroundState) {
  const { draftRef: _privateRef, ...publicState } = state;
  return publicState;
}
