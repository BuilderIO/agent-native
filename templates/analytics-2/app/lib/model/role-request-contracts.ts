import { z } from "zod";

/** The roles a member may ask an administrator for. */
export const REQUESTABLE_ROLES = ["admin"] as const;
export type RequestableRole = (typeof REQUESTABLE_ROLES)[number];

export const roleRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "declined",
]);

export const roleRequestSchema = z.object({
  id: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedRole: z.enum(REQUESTABLE_ROLES),
  status: roleRequestStatusSchema,
  requestedAt: z.string().min(1),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
});

export type RoleRequest = z.infer<typeof roleRequestSchema>;

export const roleRequestsSchema = z.object({
  requests: z.array(roleRequestSchema),
});

export const requestRoleSchema = z
  .object({ requestedRole: z.enum(REQUESTABLE_ROLES) })
  .strict();

export const requestRoleOutputSchema = z.object({ request: roleRequestSchema });

export const resolveRoleRequestSchema = z
  .object({
    id: z.string().min(1),
    decision: z.enum(["approved", "declined"]),
  })
  .strict();

export const resolveRoleRequestOutputSchema = z.object({
  request: roleRequestSchema,
});

export const listRoleRequestsSchema = z.object({}).strict();
