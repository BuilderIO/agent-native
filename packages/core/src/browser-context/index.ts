import { z } from "zod";

export const BROWSER_CONTEXT_V1_SCHEMA = "browser-context.v1" as const;

export const BROWSER_CONTEXT_V1_LIMITS = {
  totalBytes: 96 * 1024,
  projections: 3,
  readableTextChars: 64 * 1024,
  readableBlocks: 500,
  readableLinks: 250,
  designElements: 300,
  designStylesPerElement: 80,
  designTokens: 300,
  controlNodes: 2_000,
  controlChildrenPerNode: 200,
  controlPropertiesPerNode: 40,
  screenshots: 4,
} as const;

const nonBlankString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Value must not be blank.");

const isoTimestampSchema = z.iso.datetime({ offset: true });

const safeHttpUrlSchema = nonBlankString(16_384).refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}, "Expected a credential-free HTTP(S) URL.");

const exactHttpOriginSchema = nonBlankString(2_048).refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}, "Expected an exact credential-free HTTP(S) origin.");

const projectionStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("complete") }).strict(),
  z
    .object({
      state: z.literal("truncated"),
      reason: z.enum([
        "byte-limit",
        "item-limit",
        "source-limit",
        "permission-limit",
      ]),
      omittedItems: z.number().int().nonnegative().optional(),
      omittedBytes: z.number().int().nonnegative().optional(),
      detail: nonBlankString(1_024).optional(),
    })
    .strict(),
]);

const rectangleSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative().max(100_000),
    height: z.number().finite().nonnegative().max(100_000),
  })
  .strict();

const readableBlockSchema = z
  .object({
    role: z.enum([
      "heading",
      "paragraph",
      "list-item",
      "table-cell",
      "code",
      "quote",
      "other",
    ]),
    text: nonBlankString(8_000),
    level: z.number().int().min(1).max(6).optional(),
  })
  .strict();

const readableLinkSchema = z
  .object({
    label: nonBlankString(1_024),
    url: safeHttpUrlSchema,
  })
  .strict();

export const browserReadableProjectionV1Schema = z
  .object({
    type: z.literal("readable"),
    status: projectionStatusSchema,
    text: z.string().max(BROWSER_CONTEXT_V1_LIMITS.readableTextChars),
    selection: z.string().max(20_000).optional(),
    blocks: z
      .array(readableBlockSchema)
      .max(BROWSER_CONTEXT_V1_LIMITS.readableBlocks)
      .optional(),
    links: z
      .array(readableLinkSchema)
      .max(BROWSER_CONTEXT_V1_LIMITS.readableLinks)
      .optional(),
  })
  .strict();

const styleMapSchema = z
  .record(nonBlankString(120), z.string().max(4_096))
  .superRefine((styles, context) => {
    if (
      Object.keys(styles).length >
      BROWSER_CONTEXT_V1_LIMITS.designStylesPerElement
    ) {
      context.addIssue({
        code: "custom",
        message: `Computed styles cannot exceed ${BROWSER_CONTEXT_V1_LIMITS.designStylesPerElement} properties.`,
      });
    }
  });

const designElementSchema = z
  .object({
    id: nonBlankString(256),
    tagName: nonBlankString(64),
    selector: nonBlankString(2_048).optional(),
    text: z.string().max(4_000).optional(),
    bounds: rectangleSchema,
    computedStyles: styleMapSchema.optional(),
  })
  .strict();

const designTokenSchema = z
  .object({
    kind: z.enum([
      "color",
      "font",
      "space",
      "radius",
      "shadow",
      "motion",
      "other",
    ]),
    name: nonBlankString(256).optional(),
    value: nonBlankString(4_096),
    occurrences: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict();

export const browserScreenshotReferenceV1Schema = z
  .object({
    id: nonBlankString(256).optional(),
    url: nonBlankString(16_384)
      .refine((value) => {
        if (value.startsWith("/")) return !value.startsWith("//");
        try {
          const url = new URL(value);
          return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "Screenshot URL must be root-relative or credential-free HTTP(S).")
      .optional(),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest."),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    width: z.number().int().positive().max(16_384),
    height: z.number().int().positive().max(16_384),
  })
  .strict()
  .refine(
    (reference) => Boolean(reference.id || reference.url),
    "Screenshot reference requires an id or URL.",
  );

export const browserDesignProjectionV1Schema = z
  .object({
    type: z.literal("design"),
    status: projectionStatusSchema,
    viewport: z
      .object({
        width: z.number().int().positive().max(100_000),
        height: z.number().int().positive().max(100_000),
        scrollX: z.number().finite(),
        scrollY: z.number().finite(),
      })
      .strict(),
    elements: z
      .array(designElementSchema)
      .max(BROWSER_CONTEXT_V1_LIMITS.designElements),
    tokens: z
      .array(designTokenSchema)
      .max(BROWSER_CONTEXT_V1_LIMITS.designTokens)
      .optional(),
    screenshots: z
      .array(browserScreenshotReferenceV1Schema)
      .max(BROWSER_CONTEXT_V1_LIMITS.screenshots)
      .optional(),
  })
  .strict();

const accessibilityValueSchema = z.union([
  z.string().max(4_096),
  z.number().finite(),
  z.boolean(),
]);

const controlNodeSchema = z
  .object({
    nodeId: nonBlankString(256),
    backendNodeId: z.number().int().positive().optional(),
    ignored: z.boolean().optional(),
    role: accessibilityValueSchema.optional(),
    name: accessibilityValueSchema.optional(),
    value: accessibilityValueSchema.optional(),
    description: accessibilityValueSchema.optional(),
    childIds: z
      .array(nonBlankString(256))
      .max(BROWSER_CONTEXT_V1_LIMITS.controlChildrenPerNode)
      .optional(),
    properties: z
      .array(
        z
          .object({
            name: nonBlankString(256),
            value: accessibilityValueSchema,
          })
          .strict(),
      )
      .max(BROWSER_CONTEXT_V1_LIMITS.controlPropertiesPerNode)
      .optional(),
  })
  .strict();

export const browserControlProjectionV1Schema = z
  .object({
    type: z.literal("control"),
    status: projectionStatusSchema,
    ephemeral: z.literal(true),
    observationId: nonBlankString(256),
    expiresAt: isoTimestampSchema,
    tabId: z.number().int().nonnegative(),
    origin: exactHttpOriginSchema,
    nodes: z
      .array(controlNodeSchema)
      .max(BROWSER_CONTEXT_V1_LIMITS.controlNodes),
  })
  .strict()
  .refine(
    (projection) => Date.parse(projection.expiresAt) > Date.now(),
    "Control observations must have a future expiry.",
  );

export const browserContextProjectionV1Schema = z.discriminatedUnion("type", [
  browserReadableProjectionV1Schema,
  browserDesignProjectionV1Schema,
  browserControlProjectionV1Schema,
]);

const capturedOutcomeSchema = z
  .object({
    state: z.enum(["complete", "truncated"]),
    projections: z
      .array(browserContextProjectionV1Schema)
      .min(1)
      .max(BROWSER_CONTEXT_V1_LIMITS.projections),
  })
  .strict()
  .superRefine((outcome, context) => {
    const types = new Set(
      outcome.projections.map((projection) => projection.type),
    );
    if (types.size !== outcome.projections.length) {
      context.addIssue({
        code: "custom",
        message: "Browser context cannot contain duplicate projection types.",
      });
    }
    const hasTruncatedProjection = outcome.projections.some(
      (projection) => projection.status.state === "truncated",
    );
    if ((outcome.state === "truncated") !== hasTruncatedProjection) {
      context.addIssue({
        code: "custom",
        message:
          "Browser context outcome must be truncated exactly when a projection is truncated.",
      });
    }
  });

const failedOutcomeSchema = z
  .object({
    state: z.literal("failure"),
    failure: z
      .object({
        code: nonBlankString(120),
        message: nonBlankString(4_096),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const browserContextV1Schema = z
  .object({
    schema: z.literal(BROWSER_CONTEXT_V1_SCHEMA),
    captureId: nonBlankString(256),
    capturedAt: isoTimestampSchema,
    page: z
      .object({
        url: safeHttpUrlSchema,
        origin: exactHttpOriginSchema,
        title: z.string().max(2_048),
      })
      .strict(),
    outcome: z.discriminatedUnion("state", [
      capturedOutcomeSchema,
      failedOutcomeSchema,
    ]),
  })
  .strict()
  .superRefine((contextValue, context) => {
    if (new URL(contextValue.page.url).origin !== contextValue.page.origin) {
      context.addIssue({
        code: "custom",
        path: ["page", "origin"],
        message: "Page origin must match the captured page URL.",
      });
    }
    const bytes = new TextEncoder().encode(
      JSON.stringify(contextValue),
    ).byteLength;
    if (bytes > BROWSER_CONTEXT_V1_LIMITS.totalBytes) {
      context.addIssue({
        code: "custom",
        message: `Browser context exceeds ${BROWSER_CONTEXT_V1_LIMITS.totalBytes} JSON bytes.`,
      });
    }
  });

export type BrowserReadableProjectionV1 = z.infer<
  typeof browserReadableProjectionV1Schema
>;
export type BrowserDesignProjectionV1 = z.infer<
  typeof browserDesignProjectionV1Schema
>;
export type BrowserControlProjectionV1 = z.infer<
  typeof browserControlProjectionV1Schema
>;
export type BrowserScreenshotReferenceV1 = z.infer<
  typeof browserScreenshotReferenceV1Schema
>;
export type BrowserContextProjectionV1 = z.infer<
  typeof browserContextProjectionV1Schema
>;
export type BrowserContextV1 = z.infer<typeof browserContextV1Schema>;

export function parseBrowserContextV1(value: unknown): BrowserContextV1 {
  return browserContextV1Schema.parse(value);
}

export function safeParseBrowserContextV1(value: unknown) {
  return browserContextV1Schema.safeParse(value);
}
