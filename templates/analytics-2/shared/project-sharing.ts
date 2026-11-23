import { z } from "zod";

import { revisionSchema } from "./notebook-snapshot-contract.js";

const id = z.string().min(1).max(128);
const href = z.string().startsWith("/");
const appViewer = z.literal("app_viewer");
const role = z.enum([
  "app_viewer",
  "explorer",
  "editor",
  "manager",
  "legacy_reader",
]);
const person = z.strictObject({ id, displayName: z.string().max(200) });
const grant = z.strictObject({ id, person, role, createdAt: z.iso.datetime() });

export const listPublishedAppAccessInput = z.strictObject({
  projectId: id,
  cursor: id.optional(),
  limit: z.int().min(1).max(50).default(25),
});
export const listPublishedAppAccessOutput = z.strictObject({
  projectId: id,
  revision: revisionSchema,
  owner: person,
  generalAccess: z.enum(["private", "org"]),
  supportedRoles: z.array(role),
  grants: z.array(grant).max(50),
  nextCursor: id.nullable(),
  appHref: href.nullable(),
});
export const findPublishedAppColleaguesInput = z.strictObject({
  projectId: id,
  query: z.string().trim().max(100),
  cursor: id.optional(),
});
export const findPublishedAppColleaguesOutput = z.strictObject({
  people: z.array(person).max(20),
  nextCursor: id.nullable(),
});
export const setPublishedAppAccessInput = z.strictObject({
  projectId: id,
  opId: z.uuid(),
  expectedRevision: revisionSchema,
  change: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("grant"), memberId: id, role: appViewer }),
    z.strictObject({ kind: z.literal("revoke"), grantId: id }),
  ]),
});
export const setPublishedAppAccessOutput = z.strictObject({
  opId: z.uuid(),
  revision: revisionSchema,
  effect: z.enum(["added", "removed", "no_change"]),
  grant,
  appHref: href,
  committedAt: z.iso.datetime(),
});

export type PublishedAppAccess = z.infer<typeof listPublishedAppAccessOutput>;
export type PublishedAppColleagues = z.infer<
  typeof findPublishedAppColleaguesOutput
>;
export type PublishedAppAccessReceipt = z.infer<
  typeof setPublishedAppAccessOutput
>;
export type PublishedAppAccessChange = z.infer<
  typeof setPublishedAppAccessInput
>;
export type PublishedAppGrant = z.infer<typeof grant>;
export type PublishedAppSharePerson = z.infer<typeof person>;
