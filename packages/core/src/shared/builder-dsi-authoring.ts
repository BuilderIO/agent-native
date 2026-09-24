import { z } from "zod";

const id = z.string().trim().min(1).max(1024);
const error = z.object({ code: id, message: z.string().max(2000) });

export const builderDsiArtifactSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  kind: z.enum(["html", "css", "markdown", "json"]),
  hash: id,
});

export const builderDsiWorkspaceSchema = z.object({
  sessionId: id,
  revision: id,
  status: z.enum(["idle", "working", "failed"]),
  artifacts: z.array(builderDsiArtifactSchema).max(200),
  messages: z
    .array(
      z.object({
        id,
        role: z.enum(["user", "assistant"]),
        text: z.string().max(100_000),
      }),
    )
    .max(100),
  error: error.optional(),
});

export const builderDsiSessionSchema = z
  .object({
    sessionId: id,
    designSystemId: id.nullable(),
    projectId: id.nullable(),
    branchName: id.nullable(),
    status: z.enum(["preparing", "ready", "failed"]),
    error: error.optional(),
    workspace: builderDsiWorkspaceSchema.optional(),
    publication: z
      .object({
        requestId: id,
        revision: id,
        published: z.number().int().positive(),
      })
      .optional(),
    latestTurn: z
      .object({
        requestId: id,
        status: z.enum([
          "submitted",
          "working",
          "completed",
          "failed",
          "unknown",
        ]),
        error: error.optional(),
      })
      .optional(),
  })
  .superRefine((session, context) => {
    if (
      session.status === "ready" &&
      (!session.designSystemId ||
        !session.projectId ||
        !session.branchName ||
        !session.workspace)
    )
      context.addIssue({
        code: "custom",
        message:
          "A ready session requires a canonical binding and live workspace",
      });
    if (session.status === "failed" && !session.error)
      context.addIssue({
        code: "custom",
        message: "A failed session requires an error",
      });
  });

export const builderDsiArtifactBodySchema = z.object({
  id,
  hash: id,
  contentType: z.enum([
    "text/html",
    "text/css",
    "text/markdown",
    "application/json",
  ]),
  body: z.string().max(2_000_000),
});

export const builderDsiPublicationSchema = z.object({
  sessionId: id,
  revision: id,
  published: z.number().int().min(1),
});

const sourceSchema = z.object({
  kind: z.literal("file"),
  uploadToken: z.string().min(1).max(16_000),
  instructions: z.string().max(32_000).optional(),
});

export const builderDsiStartSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  intent: z.enum(["fresh", "references"]),
  prompt: z.string().trim().min(1).max(32_000),
  sources: z.array(sourceSchema).max(50).default([]),
});

export const builderDsiMessageSchema = z.object({
  sessionId: id,
  requestId: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(32_000),
  expectedRevision: id.optional(),
  targetId: id.optional(),
  sources: z.array(sourceSchema).max(50).optional(),
});

export type BuilderDsiSession = z.infer<typeof builderDsiSessionSchema>;
export type BuilderDsiWorkspace = z.infer<typeof builderDsiWorkspaceSchema>;
export type BuilderDsiArtifact = z.infer<typeof builderDsiArtifactSchema>;
export type BuilderDsiArtifactBody = z.infer<
  typeof builderDsiArtifactBodySchema
>;
export type BuilderDsiPublication = z.infer<typeof builderDsiPublicationSchema>;
export type BuilderDsiStart = z.infer<typeof builderDsiStartSchema>;
export type BuilderDsiMessage = z.infer<typeof builderDsiMessageSchema>;
