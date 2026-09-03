import { z } from "zod";

const finiteNumber = z.number().finite();
const boundsSchema = z
  .object({
    x: finiteNumber,
    y: finiteNumber,
    width: finiteNumber.nonnegative(),
    height: finiteNumber.nonnegative(),
  })
  .strict();
const fidelityReasonSchema = z
  .object({
    nodeId: z.string().min(1).max(256),
    nodeName: z.string().max(500),
    nodeType: z.string().max(100),
    reasons: z.array(z.string().max(2_000)).max(50),
  })
  .strict();
const fidelityReportSchema = z
  .object({
    exact: z.object({ count: z.number().int().nonnegative() }).strict(),
    approximated: z
      .object({
        count: z.number().int().nonnegative(),
        reasons: z.array(fidelityReasonSchema).max(1_000),
      })
      .strict(),
    imageFallback: z
      .object({
        count: z.number().int().nonnegative(),
        reasons: z.array(fidelityReasonSchema).max(1_000),
      })
      .strict(),
  })
  .strict();
const manifestChildSchema = z
  .object({
    externalId: z.string().min(1).max(1_000),
    sourceNodeId: z.string().min(1).max(256),
    bounds: boundsSchema,
    transform: z
      .tuple([
        finiteNumber,
        finiteNumber,
        finiteNumber,
        finiteNumber,
        finiteNumber,
        finiteNumber,
      ])
      .optional(),
    zOrder: z.number().int().nonnegative(),
  })
  .strict();

export const nativeCreativeArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    app: z.enum(["design", "slides"]),
    format: z.enum(["design-html", "slides-html"]),
    rootExternalId: z.string().min(1).max(1_000),
    sourceBounds: boundsSchema.optional(),
    childExternalIds: z
      .array(z.string().min(1).max(1_000))
      .max(2_000)
      .optional(),
    manifest: z
      .object({
        kind: z.literal("hierarchical-artboard"),
        children: z.array(manifestChildSchema).min(1).max(2_000),
      })
      .strict()
      .optional(),
    fidelityReport: fidelityReportSchema,
    assetRefs: z.array(z.string().min(1).max(2_000)).max(1_000).optional(),
  })
  .strict();

export type NativeCreativeArtifact = z.infer<
  typeof nativeCreativeArtifactSchema
>;
export type NativeCreativeArtifactFidelityReport = z.infer<
  typeof fidelityReportSchema
>;

export function parseNativeCreativeArtifact(
  value: unknown,
): NativeCreativeArtifact {
  return nativeCreativeArtifactSchema.parse(value);
}

export function nativeCreativeArtifactFromMetadata(
  metadata: unknown,
): NativeCreativeArtifact | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const result = nativeCreativeArtifactSchema.safeParse(
    (metadata as Record<string, unknown>).nativeArtifact,
  );
  return result.success ? result.data : null;
}
