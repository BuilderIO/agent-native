import { z } from "zod";

const id = z.string().min(1).max(128);
const href = z.string().startsWith("/");

export const embedUserAttributeValueSchema = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const embedUserAttributesSchema = z
  .record(z.string().min(1).max(128), embedUserAttributeValueSchema)
  .refine((attrs) => Object.keys(attrs).length <= 50, {
    message: "Too many user attributes",
  });

export type EmbedUserAttributes = z.infer<typeof embedUserAttributesSchema>;

export const getProjectEmbeddingInput = z.strictObject({
  projectId: id,
});

export const projectEmbeddingSettingsSchema = z.strictObject({
  projectId: id,
  published: z.boolean(),
  allowEmbedding: z.boolean(),
  canManageEmbedding: z.boolean(),
  appHref: href.nullable(),
  signedEmbedActionPath: href,
});

export type ProjectEmbeddingSettings = z.infer<
  typeof projectEmbeddingSettingsSchema
>;

export const setProjectEmbeddingInput = z.strictObject({
  projectId: id,
  allowEmbedding: z.boolean(),
});

export const setProjectEmbeddingOutput = projectEmbeddingSettingsSchema;

export const createPresignedEmbedUrlInput = z.strictObject({
  projectId: id,
  expiresInSeconds: z.coerce.number().int().min(60).max(86400).default(3600),
  userAttributes: embedUserAttributesSchema.default({}),
});

export const createPresignedEmbedUrlOutput = z.strictObject({
  id,
  projectId: id,
  embedPath: href,
  token: z.string().min(16).max(512),
  expiresAt: z.iso.datetime(),
  userAttributes: embedUserAttributesSchema,
});

export type PresignedEmbedUrl = z.infer<typeof createPresignedEmbedUrlOutput>;

export const verifyPresignedEmbedTokenInput = z.strictObject({
  projectId: id,
  token: z.string().min(16).max(512),
});

export const verifyPresignedEmbedTokenReasonSchema = z.enum([
  "ok",
  "invalid",
  "expired",
  "revoked",
  "disabled",
  "unpublished",
]);

export const verifyPresignedEmbedTokenOutput = z.strictObject({
  valid: z.boolean(),
  projectId: id,
  expiresAt: z.iso.datetime().nullable(),
  userAttributes: embedUserAttributesSchema,
  reason: verifyPresignedEmbedTokenReasonSchema,
});

export type PresignedEmbedTokenVerification = z.infer<
  typeof verifyPresignedEmbedTokenOutput
>;
