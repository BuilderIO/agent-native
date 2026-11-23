import { z } from "zod";

import { projectVersionSchema } from "../app/lib/model/project-version-contracts.js";
import { notebookProjectInputSchema } from "./notebook-operations.js";
import {
  draftHeadSchema,
  notebookEventCursorSchema,
} from "./notebook-snapshot-contract.js";

const historyFilterSchema = z.enum(["all", "versions"]);

export const notebookHistoryInputSchema = notebookProjectInputSchema.extend({
  filter: historyFilterSchema
    .default("all")
    .describe("Choose all history or saved versions only. Defaults to all."),
  cursor: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe("Next page cursor from the previous response"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Page size from 1 to 100. Defaults to 50."),
});

const historyEffectSchema = z.strictObject({
  type: z.enum(["insert", "delete", "move", "edit", "restore"]),
  field: z.string(),
  count: z.number().int().positive(),
  value: z.string().nullable(),
});

const historyGroupSchema = z.strictObject({
  kind: z.enum(["cell", "app", "project"]),
  id: z.string(),
  label: z.string().nullable(),
  cellKind: z.string().nullable(),
  effects: z.array(historyEffectSchema),
});

const historyItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("version"),
    id: z.string(),
    version: projectVersionSchema,
  }),
  z.strictObject({
    kind: z.literal("edits"),
    id: z.string(),
    actor: z.string(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    changeCount: z.number().int().positive(),
    lowerBound: z.boolean(),
    groups: z.array(historyGroupSchema),
  }),
]);

export const notebookHistoryReadSchema = z.strictObject({
  items: z.array(historyItemSchema),
  nextCursor: z.string().nullable(),
  editsTruncated: z.boolean(),
  canManageVersions: z.boolean(),
});

const versionMutationSchema = notebookProjectInputSchema.extend({
  observedHead: draftHeadSchema.describe("Accepted draft head for this intent"),
  opId: z.string().min(1).max(128).describe("Unique ID, reused only on retry"),
});

export const saveProjectVersionInputSchema = versionMutationSchema.extend({
  name: z.string().trim().min(1).max(200).describe("Name of the saved version"),
});

export const restoreProjectVersionInputSchema = versionMutationSchema.extend({
  versionId: z.string().min(1).describe("Version to restore into a new draft"),
});

export const savedProjectVersionSchema = z.strictObject({
  version: projectVersionSchema,
  head: draftHeadSchema,
  eventSeq: notebookEventCursorSchema,
});

export type NotebookHistoryInput = z.infer<typeof notebookHistoryInputSchema>;
export type NotebookHistoryItem = z.infer<typeof historyItemSchema>;
export type NotebookHistoryGroup = z.infer<typeof historyGroupSchema>;
export type NotebookHistoryEffect = z.infer<typeof historyEffectSchema>;
export type SaveProjectVersionInput = z.infer<
  typeof saveProjectVersionInputSchema
>;
export type RestoreProjectVersionInput = z.infer<
  typeof restoreProjectVersionInputSchema
>;
