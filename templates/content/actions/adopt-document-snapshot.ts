import { defineAction } from "@agent-native/core/action";
import {
  adoptSnapshotOnce,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from "@agent-native/core/collab";
import { z } from "zod";

import { documentRevisionToken } from "../server/lib/document-revision.js";
import { isLiveBodyWriterPage } from "../server/lib/live-body-writer.js";
import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import { resolveDocumentAccess } from "./_document-access.js";

export default defineAction({
  description:
    "Take a Content page's newer saved body into its live editor exactly once, however many editors have it open.",
  agentTool: false,
  deferLoading: false,
  schema: z.object({
    id: z.string().min(1),
    revision: z.string().min(1).max(200),
    adoptionUpdateBase64: z.string().min(1).max(16_000_000),
  }),
  run: async ({ id, revision, adoptionUpdateBase64 }, ctx) => {
    if (ctx?.caller !== "frontend") {
      throw Object.assign(
        new Error("This operation belongs to the browser editor."),
        { statusCode: 403 },
      );
    }
    const access = await resolveDocumentAccess(id);
    if (
      !access ||
      access.resource.trashedAt ||
      (await isSoftDeletedDatabaseDocument(id)) ||
      !["owner", "admin", "editor"].includes(access.role)
    ) {
      throw Object.assign(new Error("Document not found or not editable."), {
        statusCode: 403,
      });
    }
    // A live-copy page's saved body is written through its live doc, so
    // there is never an outside snapshot to take in.
    if (await isLiveBodyWriterPage(id)) {
      throw Object.assign(
        new Error("This page's body is already its live document."),
        { statusCode: 409 },
      );
    }
    const savedBody = access.resource.content ?? "";
    const result = await adoptSnapshotOnce(
      id,
      base64ToUint8Array(adoptionUpdateBase64),
      revision,
      {
        // Checked under the doc lock: a body saved since the editor read this
        // revision would be reverted by adopting it.
        isCurrent: async () => {
          const current = await resolveDocumentAccess(id);
          return (
            !!current &&
            documentRevisionToken(
              current.resource.bodyRevision,
              current.resource.content ?? "",
            ) === revision
          );
        },
        // Read before the lock; `isCurrent` refuses the adoption unless the
        // saved body is still this one.
        body:
          documentRevisionToken(access.resource.bodyRevision, savedBody) ===
          revision
            ? savedBody
            : undefined,
      },
    );
    return {
      status: result.status,
      adoptedRevision: result.adoptedRevision,
      adoptedBody: result.adoptedBody,
      stateBase64: uint8ArrayToBase64(result.state),
    };
  },
});
