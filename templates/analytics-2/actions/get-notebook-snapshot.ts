import { defineAction } from "@agent-native/core/action";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { readNotebookSnapshot } from "../server/model/notebook-operations/store.js";
import { notebookProjectInputSchema } from "../shared/notebook-operations.js";
import {
  notebookSnapshotActionReadSchema,
  projectTitleSlug,
} from "../shared/notebook-snapshot-read.js";

export default defineAction({
  description: "Read the accepted notebook draft and its journal cursor.",
  schema: notebookProjectInputSchema,
  outputSchema: notebookSnapshotActionReadSchema,
  outputErrorStrategy: "strict",
  readOnly: true,
  http: { method: "GET" },
  run: async ({ projectId }) => {
    const read = await readNotebookSnapshot(
      await requireCurrentWorkspace(),
      projectId,
    );
    if (read.status === "pending") return read;
    return {
      ...read,
      slug: projectTitleSlug(read.metadata.title),
      metadataRevision: read.resources.metadataRevision,
    };
  },
});
