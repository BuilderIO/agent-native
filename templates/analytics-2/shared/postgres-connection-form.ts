import { z } from "zod";

import { workspaceWarehouseEditFormSchema } from "./workspace-warehouse-edit-form.js";

const id = z.string().trim().min(1).max(200);
const requestId = z.string().uuid();

export const postgresEndpointSchema = z.strictObject({
  host: id,
  port: z.number().int().min(1).max(65535).default(5432),
  database: id,
  username: id,
});

const replace = z.strictObject({
  kind: z.literal("replace"),
  value: z.string().min(1).max(65536),
});
const credential = z.discriminatedUnion("kind", [
  replace,
  z.strictObject({ kind: z.literal("keep") }),
]);
const form = postgresEndpointSchema.extend({
  tls: z.literal("verify-full"),
  credential,
  caCertificate: z.string().trim().min(1).max(65_536).optional(),
});
const connection = z.strictObject({
  type: z.literal("postgres"),
  requestId,
  scope: z.strictObject({ kind: z.literal("workspace") }),
  name: id,
  description: z.string().max(4000).optional(),
  includeForAI: z.boolean().optional(),
  form,
});

export const postgresConnectionCreateSchema = connection.extend({
  form: form.extend({ credential: replace }),
});
export const postgresConnectionUpdateSchema = connection.extend({
  connectionId: id,
  revision: id,
  canonicalDescription:
    workspaceWarehouseEditFormSchema.shape.canonicalDescription,
  canonicalAiPolicy: workspaceWarehouseEditFormSchema.shape.canonicalAiPolicy,
});
export const postgresConnectionTestSchema = connection
  .pick({ type: true, scope: true, form: true })
  .extend({
    testId: requestId,
    connectionId: id.optional(),
  });
