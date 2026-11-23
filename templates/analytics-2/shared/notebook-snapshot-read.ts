import { z } from "zod";

import { notebookSnapshotSchema } from "./notebook-operations.js";
import { pendingSchema, revisionSchema } from "./notebook-snapshot-contract.js";

export const notebookSnapshotActionReadSchema = z.discriminatedUnion("status", [
  notebookSnapshotSchema.extend({
    slug: z.string().min(1),
    metadataRevision: revisionSchema,
  }),
  pendingSchema,
]);

export function projectTitleSlug(title: string) {
  return (
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}
