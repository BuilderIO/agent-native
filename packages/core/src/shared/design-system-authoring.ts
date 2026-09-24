import type { DesignSystemSourceInput as ToolkitDesignSystemSourceInput } from "@agent-native/toolkit/design-system-creation";
import { z } from "zod";

import {
  builderDsiArtifactSchema,
  builderDsiPublicationSchema,
  type BuilderDsiSession,
} from "./builder-dsi-authoring.js";

const identifier = z.string().trim().min(1).max(200);
const revision = z.coerce.number().int().min(0);
const httpUrl = z
  .string()
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "Use an HTTP(S) URL without embedded credentials");

export const designSystemSourceInputSchema = z.discriminatedUnion("kind", [
  z.object({ id: identifier, kind: z.literal("website"), url: httpUrl }),
  z.object({
    id: identifier,
    kind: z.literal("figma"),
    url: httpUrl.refine((value) => {
      const url = new URL(value);
      return (
        ["figma.com", "www.figma.com"].includes(url.hostname) &&
        /^\/(file|design)\/[a-zA-Z0-9]+(?:\/|$)/.test(url.pathname)
      );
    }, "Use a Figma file or design URL"),
  }),
  z.object({
    id: identifier,
    kind: z.literal("file"),
    name: z.string().trim().min(1).max(255),
    mimeType: z.string().min(1).max(150),
    size: z.number().int().min(0),
    handle: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("stored-file"),
        path: z.string().min(1).max(16384),
      }),
      z.object({
        kind: z.literal("builder-upload"),
        uploadToken: z.string().min(1).max(4096),
      }),
    ]),
  }),
]) satisfies z.ZodType<ToolkitDesignSystemSourceInput>;

export const designSystemSourceStatusSchema = z.enum([
  "staged",
  "reading",
  "ready",
  "needs-attention",
  "failed",
]);
export const designSystemProvenanceSchema = z.enum([
  "extracted",
  "inferred",
  "generated",
  "manual",
]);
const sourceResultSchema = z.object({
  excluded: z.boolean().default(false),
  status: designSystemSourceStatusSchema,
  error: z
    .object({
      code: identifier,
      message: z.string().min(1).max(2000),
      retryable: z.boolean(),
    })
    .nullable(),
  evidence: z.string().max(12000).nullable(),
  provenance: designSystemProvenanceSchema.nullable(),
  updatedAt: z.string(),
});
export const designSystemSourceSchema = z.intersection(
  designSystemSourceInputSchema,
  sourceResultSchema,
);

export const designSystemOriginDraftSchema = z.object({
  app: z.enum(["design", "slides"]),
  draftId: identifier,
  returnPath: z
    .string()
    .min(1)
    .max(2048)
    .refine((value) => value.startsWith("/") && !value.startsWith("//")),
});
export const designSystemRunSchema = z.object({
  id: identifier,
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  stage: z.enum([
    "reading-sources",
    "drafting-foundations",
    "building-components",
    "writing-rules",
    "awaiting-input",
    "ready",
    "needs-attention",
  ]),
  error: z
    .object({
      code: identifier,
      message: z.string().min(1).max(2000),
      retryable: z.boolean(),
    })
    .nullable(),
});

const blobHandleSchema = z.object({
  id: z.string(),
  provider: z.string(),
  opaque: z.literal(true),
  encrypted: z.boolean(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
  createdAt: z.string().optional(),
  metadata: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]),
    )
    .optional(),
});
const valuesSchema = z
  .record(z.string().min(1).max(100), z.string().max(1000))
  .refine((value) => Object.keys(value).length <= 100);
const artifactContentTypeSchema = z.enum([
  "text/html",
  "text/markdown",
  "text/css",
  "application/json",
]);
export const designSystemArtifactSchema = z.object({
  id: identifier,
  kind: z.enum(["foundation", "component", "usage-rule"]),
  name: z.string().trim().min(1).max(255),
  revision: revision,
  provenance: designSystemProvenanceSchema,
  sourceIds: z.array(identifier).max(50),
  values: valuesSchema.optional(),
  content: blobHandleSchema.nullable(),
  contentType: artifactContentTypeSchema.nullable(),
  provider: builderDsiArtifactSchema.pick({ id: true, kind: true }).optional(),
  contentHash: z.string().nullable(),
  updatedAt: z.string(),
  history: z
    .array(
      z.object({
        name: z.string().optional(),
        provenance: designSystemProvenanceSchema.optional(),
        sourceIds: z.array(identifier).optional(),
        revision,
        content: blobHandleSchema.nullable(),
        contentType: artifactContentTypeSchema.nullable(),
        contentHash: z.string().nullable(),
        values: valuesSchema.optional(),
        updatedAt: z.string(),
      }),
    )
    .max(20),
});

const builderIdentifier = z.string().min(1).max(1024);
const builderSourceOutcomesSchema = z
  .array(
    z.object({
      sourceId: identifier,
      status: z.enum(["staged", "ready", "needs-attention"]),
      excluded: z.boolean(),
      representation: z.enum(["original", "extracted-text"]).nullable(),
      warnings: z.array(z.string()),
      error: sourceResultSchema.shape.error,
      upload: z
        .object({ name: z.string(), mimeType: z.string(), size: z.number() })
        .nullable(),
    }),
  )
  .max(50);
export const designSystemBuilderOperationSchema = z.object({
  requestId: identifier,
  providerRequestId: identifier,
  hash: z.string().length(64),
  kind: z.enum(["start", "message", "publish"]),
  status: z.enum([
    "preparing",
    "dispatched",
    "submitted",
    "completed",
    "failed",
    "unknown",
  ]),
  error: sourceResultSchema.shape.error,
  createdAt: z.string(),
  updatedAt: z.string(),
  preparationLeaseUntil: z.number().optional(),
  publicationTarget: z
    .object({
      expectedRevision: builderIdentifier,
      contentRevision: revision,
    })
    .optional(),
  sourceBatch: z
    .object({
      hash: z.string().length(64),
      sourceIds: z.array(identifier).max(50),
      addedSourceIds: z.array(identifier).max(50),
      status: z.enum([
        "preparing",
        "uploaded",
        "submitted",
        "applied",
        "needs-attention",
        "unknown",
      ]),
      outcomes: builderSourceOutcomesSchema,
    })
    .optional(),
});
export const designSystemBuilderStateSchema = z.object({
  sessionId: builderIdentifier.optional(),
  codegenSessionId: builderIdentifier.optional(),
  designSystemId: builderIdentifier.optional(),
  projectId: builderIdentifier.optional(),
  branchName: builderIdentifier.optional(),
  revision: builderIdentifier.optional(),
  status: z.enum(["preparing", "ready", "failed"]).optional(),
  workspaceStatus: z.enum(["idle", "working", "failed"]).optional(),
  sourceHash: z.string().length(64).optional(),
  sourceIds: z.array(identifier).max(50),
  sourceOutcomes: builderSourceOutcomesSchema,
  operations: z.array(designSystemBuilderOperationSchema).max(1000),
  publication: builderDsiPublicationSchema
    .extend({
      contentRevision: revision,
      requestId: identifier,
    })
    .nullable(),
});

export const runBuilderDesignSystemSchema = z.object({
  id: identifier.describe("Local design-system ID"),
  requestId: identifier.describe(
    "Stable request ID bound to this exact input; an unconfirmed request is never automatically resubmitted",
  ),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(32_000)
    .describe(
      "User-authored direction for the same Builder design-system conversation",
    ),
  targetId: identifier
    .optional()
    .describe(
      "Local artifact ID to refine, resolved to the canonical Builder file by the service",
    ),
  expectedRevision: builderIdentifier
    .optional()
    .describe(
      "Builder revision from workspace.builder.revision; omit only when starting or intentionally using the latest saved revision",
    ),
});
export const publishBuilderDesignSystemSchema = z.object({
  id: identifier.describe("Local design-system ID"),
  requestId: identifier.describe(
    "Stable publication request ID bound to this exact revision",
  ),
  expectedRevision: builderIdentifier.describe(
    "Exact Builder revision to publish, from workspace.builder.revision; not the numeric AN workspace revision",
  ),
});

export const designSystemWorkspaceSchema = z.object({
  schemaVersion: z.literal(1),
  runtime: z.enum(["native", "builder"]).optional(),
  builder: designSystemBuilderStateSchema.optional(),
  ownerApp: z.enum(["design", "slides"]),
  systemId: identifier,
  revision,
  contentRevision: revision.default(0),
  conversationId: identifier,
  conversationScope: identifier,
  intent: z.enum(["fresh", "references"]),
  sources: z.array(designSystemSourceSchema).max(50),
  artifacts: z.array(designSystemArtifactSchema).max(200),
  run: designSystemRunSchema.nullable(),
  kickoff: z
    .object({
      status: z.enum(["pending", "claimed", "delivered", "failed"]),
      requestId: identifier,
      claimId: identifier.nullable(),
      leaseUntil: z.number().nullable(),
      error: z.string().max(2000).nullable(),
    })
    .nullable()
    .default(null),
  selectedTargetId: identifier.nullable(),
  originDraft: designSystemOriginDraftSchema.nullable(),
  updatedAt: z.string(),
  creationHash: z.string(),
  operations: z.array(z.object({ id: identifier, hash: z.string() })).max(100),
});

export const startDesignSystemAuthoringSchema = z.object({
  requestId: identifier.describe(
    "Stable creation request ID; reuse the same ID and input when retrying",
  ),
  title: z.string().trim().min(1).max(200).describe("System name"),
  intent: z
    .enum(["fresh", "references"])
    .describe("Start fresh or from the staged reference batch"),
  sources: z
    .array(designSystemSourceInputSchema)
    .max(50)
    .default([])
    .describe("Entire staged source batch; defaults to empty for fresh"),
  originDraft: designSystemOriginDraftSchema
    .optional()
    .describe("Exact originating composer draft and return route"),
});
export const updateDesignSystemWorkspaceSchema = z.object({
  id: identifier.describe("Design system ID"),
  expectedRevision: revision.describe(
    "Workspace revision from get-design-system-workspace",
  ),
  operationId: identifier.describe("Stable operation ID for identical retries"),
  sources: z
    .array(designSystemSourceInputSchema)
    .max(50)
    .optional()
    .describe("Append staged sources without replacing earlier sources"),
  sourceExclusions: z
    .array(z.object({ id: identifier, excluded: z.boolean() }))
    .max(50)
    .optional()
    .describe(
      "Explicit user-directed exclusion or restoration; retains evidence and artifacts. Never exclude a failed source merely to report completion",
    ),
  sourceUpdates: z
    .array(
      z.object({
        id: identifier,
        status: designSystemSourceStatusSchema,
        error: sourceResultSchema.shape.error,
        evidence: sourceResultSchema.shape.evidence,
        provenance: sourceResultSchema.shape.provenance,
      }),
    )
    .max(50)
    .optional()
    .describe(
      "Explicit per-source extraction results; ready requires evidence",
    ),
  run: designSystemRunSchema
    .optional()
    .describe(
      "Actual native agent run ID, stage and error; never a provider submission receipt",
    ),
  selectedTargetId: identifier
    .nullable()
    .optional()
    .describe("Selected existing artifact ID, or null to clear selection"),
  originDraft: designSystemOriginDraftSchema
    .optional()
    .describe("Origin draft to restore when using the system"),
});
export const writeDesignSystemArtifactSchema = z
  .object({
    id: identifier.describe("Design system ID"),
    targetId: identifier.describe(
      "Stable target ID; use colors, typography, spacing, radius, button, input, card, avatar, or usage for starter targets",
    ),
    expectedRevision: revision.describe(
      "Target artifact revision, not workspace revision; 0 creates a new target",
    ),
    operationId: identifier.describe(
      "Stable operation ID for identical retries",
    ),
    kind: designSystemArtifactSchema.shape.kind.describe(
      "foundation, component, or usage-rule",
    ),
    name: designSystemArtifactSchema.shape.name.describe("Display name"),
    provenance: designSystemProvenanceSchema.describe(
      "extracted, inferred, generated, or manual",
    ),
    sourceIds: z
      .array(identifier)
      .max(50)
      .default([])
      .describe(
        "Sources used for this artifact; empty for generated fresh content",
      ),
    values: valuesSchema
      .optional()
      .describe("Editable foundation tokens as name/value pairs"),
    html: z
      .string()
      .min(1)
      .max(200000)
      .optional()
      .describe(
        "Complete standalone rendered component HTML; persisted to private blob storage",
      ),
    text: z
      .string()
      .trim()
      .min(1)
      .max(40000)
      .optional()
      .describe(
        "Usage guidance in Markdown; persisted to private blob storage",
      ),
  })
  .superRefine((value, ctx) => {
    if (
      value.kind === "component" &&
      (!value.html || value.text || value.values)
    )
      ctx.addIssue({ code: "custom", message: "Components require html only" });
    if (
      value.kind === "foundation" &&
      (!value.values ||
        !Object.keys(value.values).length ||
        value.html ||
        value.text)
    )
      ctx.addIssue({
        code: "custom",
        message: "Foundations require nonempty values only",
      });
    if (
      value.kind === "usage-rule" &&
      (!value.text || value.html || value.values)
    )
      ctx.addIssue({
        code: "custom",
        message: "Usage rules require text only",
      });
  });

export const writeDesignSystemArtifactAgentSchema = z
  .object(writeDesignSystemArtifactSchema.shape)
  .pick({
    id: true,
    targetId: true,
    expectedRevision: true,
    operationId: true,
    name: true,
    provenance: true,
    sourceIds: true,
  })
  .extend({
    provenance: z
      .enum(["inferred", "generated", "manual"])
      .describe(
        "Use inferred for artifacts synthesized from source evidence, generated for fresh authored content, or manual for user-specified content. extracted is reserved for deterministic source readers and migrations, never model-authored artifacts.",
      ),
    sourceIds: z
      .array(identifier)
      .max(50)
      .describe("Actual source IDs used; use [] for fresh generated content"),
    content: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("foundation"),
            tokens: z
              .array(
                z
                  .object({
                    name: z
                      .string()
                      .min(1)
                      .max(100)
                      .describe(
                        "Token key, e.g. primary, headingFont, headingSizes.h1, pagePadding or radius. A radius scale may use radius.sm/md/lg/pill; radius.md is the default when scalar radius is absent.",
                      ),
                    value: z
                      .string()
                      .trim()
                      .min(1)
                      .max(1000)
                      .describe(
                        "Actual editable token value, e.g. #2a4d69, Inter, 48px or 12px",
                      ),
                  })
                  .strict(),
              )
              .min(1)
              .max(100)
              .describe(
                "Required nonempty foundation token entries; never omit token values",
              ),
          })
          .strict(),
        z
          .object({
            kind: z.literal("component"),
            html: z
              .string()
              .min(1)
              .max(200000)
              .describe(
                "Required complete standalone component HTML with real rendered content",
              ),
          })
          .strict(),
        z
          .object({
            kind: z.literal("usage-rule"),
            text: z
              .string()
              .trim()
              .min(1)
              .max(40000)
              .describe("Required Markdown usage guidance"),
          })
          .strict(),
      ])
      .describe(
        "Required artifact payload: foundation tokens, component HTML, or usage-rule text",
      ),
  })
  .strict();

export function designSystemArtifactInputFromContent({
  content,
  ...input
}: z.infer<
  typeof writeDesignSystemArtifactAgentSchema
>): WriteDesignSystemArtifactInput {
  if (
    content.kind === "foundation" &&
    new Set(content.tokens.map((token) => token.name)).size !==
      content.tokens.length
  )
    throw new Error(
      "Foundation token names must be unique; combine edits explicitly.",
    );
  return writeDesignSystemArtifactSchema.parse({
    ...input,
    kind: content.kind,
    ...(content.kind === "foundation"
      ? {
          values: Object.fromEntries(
            content.tokens.map((token) => [token.name, token.value]),
          ),
        }
      : content.kind === "component"
        ? { html: content.html }
        : { text: content.text }),
  });
}

export type DesignSystemSourceInput = ToolkitDesignSystemSourceInput;
export type DesignSystemSource = z.infer<typeof designSystemSourceSchema>;
export type DesignSystemArtifact = z.infer<typeof designSystemArtifactSchema>;
export type DesignSystemWorkspace = z.infer<typeof designSystemWorkspaceSchema>;
export type DesignSystemBuilderState = z.infer<
  typeof designSystemBuilderStateSchema
>;
export type RunBuilderDesignSystemInput = z.infer<
  typeof runBuilderDesignSystemSchema
>;
export type PublishBuilderDesignSystemInput = z.infer<
  typeof publishBuilderDesignSystemSchema
>;
export type StartDesignSystemAuthoringInput = z.infer<
  typeof startDesignSystemAuthoringSchema
>;
export type UpdateDesignSystemWorkspaceInput = z.infer<
  typeof updateDesignSystemWorkspaceSchema
>;
export type WriteDesignSystemArtifactInput = z.infer<
  typeof writeDesignSystemArtifactSchema
>;
export type DesignSystemWorkspaceSnapshot = {
  id: string;
  title: string;
  canEdit: boolean;
  workspace: DesignSystemWorkspace | null;
  /** Live provider response only; messages and file bodies are not stored in SQL. */
  builderSession?: BuilderDsiSession;
  canUse?: boolean;
  canPublish?: boolean;
};
export type DesignSystemArtifactWriteResult = DesignSystemWorkspaceSnapshot & {
  receipt: {
    persisted: true;
    operationId: string;
    targetId: string;
    revision: number;
    kind: DesignSystemArtifact["kind"];
    tokenCount: number;
    contentHash: string | null;
  };
};
export type DesignSystemTargetContext = {
  ownerApp: "design" | "slides";
  systemId: string;
  targetId: string;
  expectedRevision: number;
};
export const designSystemReferenceSchema = z.object({
  id: identifier,
  ownerApp: z.enum(["design", "slides"]),
  consumedRevision: revision,
});
export type DesignSystemReference = z.infer<typeof designSystemReferenceSchema>;
