import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  loadCommentAiRequest,
  readCommentAiSource,
  serializeCommentAiRequest,
} from "../server/lib/comment-ai.js";
import { resolveDocumentTextEdits } from "../shared/document-text-edits.js";
import {
  documentRevisionToken,
  type DocumentEditMutationResult,
} from "./_document-edit-mutation.js";
import editDocument from "./edit-document.js";

const retainedEditsSchema = z.object({
  edits: z
    .array(z.object({ find: z.string().min(1), replace: z.string() }))
    .min(1),
});

export default defineAction({
  description:
    "Undo a change that Ask AI applied from a comment: reverse the exact edits Apply changes and resolve saved, then reopen the source thread. Only the person who asked can undo it. Changes nothing when the changed text was edited since.",
  schema: z.object({
    requestId: z.string().min(1).describe("The comment AI request to undo"),
  }),
  run: async ({ requestId }, ctx) => {
    const request = await loadCommentAiRequest(requestId);
    const serialized = serializeCommentAiRequest(request);
    const result = serialized.result ?? {};
    if (
      request.intent !== "apply-resolve" ||
      request.status !== "resolved" ||
      !result.editApplied
    ) {
      fail("Only a change AI applied and resolved can be undone", {
        statusCode: 409,
        errorCode: "not_undoable",
      });
    }
    if (result.undone) return serialized;

    const [attempt] = request.activeAttemptId
      ? await getDb()
          .select()
          .from(schema.commentAiAttempts)
          .where(eq(schema.commentAiAttempts.id, request.activeAttemptId))
      : [];
    const retained = retainedEditsSchema.safeParse(
      attempt?.payloadJson ? JSON.parse(attempt.payloadJson) : null,
    );
    if (!retained.success) {
      fail("The applied change is no longer available to undo", {
        statusCode: 409,
        errorCode: "not_undoable",
      });
    }
    if (retained.data.edits.some((edit) => edit.replace.length === 0)) {
      fail("This change removed text, so it can't be undone automatically", {
        statusCode: 409,
        errorCode: "not_undoable",
      });
    }
    const reverse = retained.data.edits.map(({ find, replace }) => ({
      find: replace,
      replace: find,
    }));

    const source = await readCommentAiSource(request);
    const resolved = resolveDocumentTextEdits(source.document.content, reverse);
    if (!resolved.ok) {
      fail(
        "The changed text was edited after AI applied it, so it can't be undone automatically",
        { statusCode: 409, errorCode: "undo_target_changed" },
      );
    }
    const edit = (await editDocument.run(
      {
        id: request.documentId,
        edits: reverse,
        baseRevision: documentRevisionToken(
          source.document.bodyRevision,
          source.document.content,
        ),
        idempotencyKey: `comment-ai:${request.id}:undo`,
      },
      ctx,
    )) as DocumentEditMutationResult;
    if (edit.receipt.outcome !== "applied" || !edit.receipt.readback.verified) {
      fail("The undo could not be verified; the Page was left as it was", {
        statusCode: 409,
        errorCode: "undo_unverified",
      });
    }

    const now = new Date().toISOString();
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.documentComments)
        .set({ resolved: 0, updatedAt: now })
        .where(
          and(
            eq(schema.documentComments.documentId, request.documentId),
            eq(schema.documentComments.threadId, request.threadId),
            eq(schema.documentComments.ownerEmail, request.ownerEmail),
          ),
        );
      await tx
        .update(schema.commentAiRequests)
        .set({
          resultJson: JSON.stringify({ ...result, undone: true }),
          updatedAt: now,
        })
        .where(eq(schema.commentAiRequests.id, request.id));
    });
    await writeAppState("refresh-signal", { ts: Date.now() });

    const [current] = await getDb()
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, request.id));
    return serializeCommentAiRequest(current ?? request);
  },
});
