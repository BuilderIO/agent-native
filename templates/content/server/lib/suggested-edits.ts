import { fail } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  withPreparedYDocMutation,
  type PreparedYDocMutationLease,
} from "@agent-native/core/collab";
import { getDbExec, type DbExec } from "@agent-native/core/db";
import type {
  ResourceSuggestion,
  SuggestionAdapter,
  SuggestionContext,
  SuggestionOperation,
} from "@agent-native/core/review";
import {
  prepareTransactionalChange,
  type TransactionalChange,
} from "@agent-native/core/server";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";

import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "../../actions/_blocks-field-identity.js";
import { accessibleDocumentIds } from "../../actions/_document-access.js";
import {
  documentContentHash,
  documentRevisionToken,
} from "../../actions/_document-edit-mutation.js";
import { hasSuggestionBodyTarget } from "../../actions/_suggestion-eligibility.js";
import { commentIdForIdempotency } from "../../actions/add-comment.js";
import {
  commentAnchorHoldsOn,
  commentAnchorText,
  reanchoredCommentQuote,
} from "../../shared/comment-reanchor.js";
import { mergeDocumentBodyIntents } from "../../shared/document-intent-merge.js";
import { canonicalizeNfm } from "../../shared/nfm.js";
import {
  applyMarkdownSuggestionOperation,
  applyMarkdownSuggestionWithSiblings,
  markdownPayload,
  parseSuggestionMarkdown,
  suggestionEditorSchema,
  supportedSuggestionStructure,
} from "../../shared/suggestion-apply.js";
import { contentSuggestionPath } from "../../shared/suggestion-link.js";
import { rebaselineSuggestions } from "../../shared/suggestion-rebaseline.js";
import { schema } from "../db/index.js";
import type { ApplySuggestionRefusalReason } from "../live-copy/apply-suggestion-edit.js";
import { contentLiveCopy } from "../live-copy/binding.js";
import {
  lockLiveCopyPage,
  persistedContentBodyCommit,
} from "../live-copy/persist.js";
import { withContentBodyWriteCause } from "../live-copy/write-cause.js";
import { commitCanonicalDocumentBodyMutation } from "./canonical-document-body-mutation.js";
import { commentThreadDigest } from "./comment-ai.js";
import { recordDocumentBodyIntent } from "./document-body-intents.js";
import { recordDocumentHistoryTransition } from "./document-history.js";
import {
  liveBodyWriterGate,
  liveBodyWriterGateForRow,
  liveBodyWriterPageColumns,
} from "./live-body-writer.js";
import { syncPrivateCalloutReferences } from "./private-icon-references.js";
import {
  acceptedRangesOnSameText,
  acceptOnLiveCopy,
  isLiveCopyDecision,
  LiveCopyAcceptUnavailable,
  type LiveCopyAccept,
  type LiveCopyDecision,
} from "./suggestion-live-accept.js";

export { applyMarkdownSuggestionOperation } from "../../shared/suggestion-apply.js";

export const CONTENT_DOCUMENT_SUGGESTION_ADAPTER = "content.document-markdown";

const contentLiveCopyAccept: LiveCopyAccept = {
  binding: contentLiveCopy,
  bodyCommit: persistedContentBodyCommit,
  lockPage: lockLiveCopyPage,
  withWriteCause: withContentBodyWriteCause,
};

function validateOperations(
  operations: SuggestionOperation[],
): SuggestionOperation[] {
  if (operations.length !== 1) {
    throw new Error(
      "Content v1 accepts one independently reviewable edit per suggestion",
    );
  }
  const operation = operations[0]!;
  if (
    ![
      "insert_text",
      "delete_text",
      "replace_text",
      "add_text_block",
      "set_inline_mark",
    ].includes(operation.kind)
  ) {
    throw new Error(
      `Unsupported Content suggestion operation: ${operation.kind}`,
    );
  }
  if (operation.schemaVersion !== 1 || operation.targetId !== "body") {
    throw new Error(
      "Content suggestions must target the version 1 Page body grammar",
    );
  }
  const before = markdownPayload(operation.before, "before");
  const after = markdownPayload(operation.after, "after");
  if (before.markdown === after.markdown) {
    throw new Error("A suggestion must change the Page body");
  }
  return operations;
}

function documentFromContext(ctx: Record<string, unknown> | undefined) {
  const access = ctx?.suggestionAccess as
    | { resource?: Record<string, unknown> }
    | undefined;
  return access?.resource;
}

function matchesDocumentRevision(
  baseRevision: string,
  document: {
    bodyRevision?: unknown;
    content?: unknown;
    updatedAt?: unknown;
  },
) {
  const canonicalRevision =
    typeof document.bodyRevision === "number" &&
    Number.isSafeInteger(document.bodyRevision) &&
    typeof document.content === "string"
      ? documentRevisionToken(document.bodyRevision, document.content)
      : null;
  return (
    baseRevision === canonicalRevision || baseRevision === document.updatedAt
  );
}

type ContentDecisionCoordination = {
  ydoc: PreparedYDocMutationLease;
  sync: TransactionalChange;
  deferPersistence?: boolean;
  finalContent?: string;
};

export function publishPersistedAcceptedSuggestion(
  sync: TransactionalChange,
  result: unknown,
): void {
  if (
    sync.isPersisted() &&
    ((result as { decision?: { outcome?: string } }).decision?.outcome ===
      "accepted" ||
      (result as { suggestions?: { status?: string }[] }).suggestions?.some(
        (suggestion) => suggestion.status === "accepted",
      ))
  ) {
    sync.publish();
  }
}

export function acceptedSuggestionRequestSource(
  requestSource: unknown,
): "agent" | undefined {
  return requestSource === "agent" ? "agent" : undefined;
}

function validateSuggestionStructure(
  beforeMarkdown: string,
  afterMarkdown: string,
  refusal: string,
) {
  const after = supportedSuggestionStructure(beforeMarkdown, afterMarkdown);
  if (!after) {
    fail(refusal, {
      statusCode: 422,
      errorCode: "suggestion_structure_unsupported",
    });
  }
  return after;
}

function drizzleTransactionForExec(transaction: DbExec) {
  return drizzle(
    async (sql, args, method) => {
      const result = await transaction.execute({ sql, args });
      return {
        rows:
          method === "all"
            ? result.rows.map((row) =>
                Array.isArray(row) ? row : Object.values(row),
              )
            : result.rows,
      };
    },
    { schema },
  );
}

async function assertSuggestionBodyTarget(
  transaction: DbExec,
  documentId: string,
) {
  const row = (
    await transaction.execute({
      sql: `SELECT
              EXISTS (SELECT 1 FROM content_databases d WHERE d.document_id = ?) AS is_database,
              EXISTS (SELECT 1 FROM content_database_items i INNER JOIN content_databases d ON d.id = i.database_id WHERE i.document_id = ? AND d.deleted_at IS NULL) AS has_membership`,
      args: [documentId, documentId],
    })
  ).rows[0];
  if (row?.is_database) {
    fail("Collection Pages cannot receive body suggestions.", {
      statusCode: 409,
      errorCode: "suggestion_body_unavailable",
    });
  }
  const memberships = (
    await transaction.execute({
      sql: `SELECT d.document_id AS database_document_id, d.system_role, p.id AS primary_id
            FROM content_database_items i
            INNER JOIN content_databases d ON d.id = i.database_id
            LEFT JOIN document_property_definitions p ON p.id = d.primary_blocks_property_id AND p.database_id = d.id AND p.type = 'blocks'
            WHERE i.document_id = ? AND d.deleted_at IS NULL
            ORDER BY d.id`,
      args: [documentId],
    })
  ).rows;
  const ordinaryMemberships = memberships.filter(
    (membership) => membership.system_role === null,
  );
  const eligibleDocumentIds = ordinaryMemberships
    .filter((membership) => membership.primary_id)
    .map((membership) => String(membership.database_document_id));
  const identityDb = drizzleTransactionForExec(transaction);
  const accessibleIds = await accessibleDocumentIds(
    eligibleDocumentIds,
    undefined,
    identityDb,
    transaction,
  );
  let hasAccessiblePrimary = accessibleIds.size > 0;
  if (!hasAccessiblePrimary && !ordinaryMemberships.length) {
    hasAccessiblePrimary = memberships.some(
      (membership) =>
        membership.system_role === "files" && membership.primary_id,
    );
  }
  if (
    !hasSuggestionBodyTarget({
      hasDatabaseMembership: Boolean(row?.has_membership),
      hasPrimaryBlocksField: hasAccessiblePrimary,
    })
  ) {
    fail(
      "This database item has no primary Blocks field for body suggestions.",
      {
        statusCode: 409,
        errorCode: "suggestion_body_unavailable",
      },
    );
  }
  return memberships
    .filter(
      (membership) =>
        membership.primary_id &&
        ((membership.system_role === null &&
          accessibleIds.has(String(membership.database_document_id))) ||
          (membership.system_role === "files" && !ordinaryMemberships.length)),
    )
    .map((membership) => String(membership.primary_id));
}

function replacePreparedCollabContent(
  lease: PreparedYDocMutationLease,
  proseMirrorDoc: ReturnType<typeof parseSuggestionMarkdown>,
): void {
  prosemirrorJSONToYXmlFragment(
    suggestionEditorSchema(),
    proseMirrorDoc.toJSON(),
    lease.doc.getXmlFragment("default"),
  );
}

const STALE_ACCEPT_MESSAGE =
  "The text around this suggestion changed, so it can't be placed on the current Page. It's still pending: reject it, or suggest the edit again.";
const UNSUPPORTED_ACCEPT_MESSAGE =
  "This suggestion changes a table's rows or cells, a callout's icon, a toggle's title, a column layout, an image, or other content or formatting that suggestions do not support yet, so it cannot be accepted.";
const INLINE_DATABASE_ACCEPT_MESSAGE =
  "Pages containing inline databases cannot accept suggestions yet.";

/** Core turns this into a 409 `suggestion_stale` and keeps it pending. */
function suggestionStaleError(message: string) {
  const error = new Error(message);
  error.name = "SuggestionStaleError";
  return error;
}

function failBeforeStateConflict(): never {
  fail(
    "The suggestion before-state does not match the Page; refresh before saving this suggestion",
    {
      statusCode: 409,
      errorCode: "suggestion_conflict",
    },
  );
}

/**
 * A Page written through its live copy stores its body in canonical form, so
 * an agent can propose against the same body written another way, such as
 * `$60` for the stored `\$60`. That proposal is moved onto the stored text.
 * Any other Page keeps the exact before-state comparison.
 */
async function proposalOnStoredBody(
  transaction: DbExec | undefined,
  documentId: string,
  content: unknown,
  operation: SuggestionOperation,
): Promise<SuggestionOperation> {
  if (!transaction || typeof content !== "string") failBeforeStateConflict();
  // guard:allow-unscoped — core's propose action asserted comment access to this Page before validating the proposal.
  const [page] = await drizzleTransactionForExec(transaction)
    .select(liveBodyWriterPageColumns)
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  const gate = await liveBodyWriterGateForRow(page, { transaction });
  const before = markdownPayload(operation.before, "before").markdown;
  if (gate.writePath !== "live_copy" || canonicalizeNfm(before) !== content)
    failBeforeStateConflict();
  const outcome = rebaselineSuggestions(
    [{ id: "proposal", group: "proposal", operation }],
    before,
    content,
  ).get("proposal");
  if (outcome?.kind === "rebased") return outcome.operation;
  if (outcome?.kind === "blocked" && outcome.reason === "change_vanishes")
    fail("This suggestion changes nothing once written in the Page's form.", {
      statusCode: 422,
      errorCode: "suggestion_no_change",
    });
  if (outcome?.kind === "blocked")
    fail(
      "This suggestion changes content or formatting that suggestions do not support yet once written in the Page's form. Suggest a change to the text instead.",
      {
        statusCode: 422,
        errorCode: "suggestion_structure_unsupported",
      },
    );
  failBeforeStateConflict();
}

/**
 * Accepting an AI suggestion leaves the comment that asked for it open, so its
 * quote follows the rewritten text instead of losing its highlight.
 * `followedOnto` is the body a live-copy commit already moved the anchors of
 * intact quotes onto; such an anchor no longer describes `before`.
 */
async function reanchorSourceComment(
  tx: DbExec,
  documentId: string,
  suggestion: ResourceSuggestion,
  before: string,
  after: string,
  now: string,
  followedOnto?: string,
) {
  const threadId = suggestion.metadata?.sourceThreadId;
  // Only a request-bound thread was checked against the request on create.
  if (
    typeof threadId !== "string" ||
    typeof suggestion.metadata?.commentAiRequestId !== "string"
  )
    return;
  const root = (
    await tx.execute({
      sql: "SELECT id,quoted_text,anchor_prefix,anchor_suffix,anchor_start_offset FROM document_comments WHERE document_id = ? AND thread_id = ? AND parent_id IS NULL ORDER BY created_at ASC LIMIT 1",
      args: [documentId, threadId],
    })
  ).rows[0];
  if (!root || root.quoted_text == null) return;
  const quote = {
    quotedText: String(root.quoted_text),
    prefix: root.anchor_prefix == null ? null : String(root.anchor_prefix),
    suffix: root.anchor_suffix == null ? null : String(root.anchor_suffix),
    startOffset:
      root.anchor_start_offset == null
        ? null
        : Number(root.anchor_start_offset),
  };
  if (
    followedOnto !== undefined &&
    commentAnchorHoldsOn(quote, commentAnchorText(followedOnto))
  )
    return;
  const next = reanchoredCommentQuote(quote, before, after);
  if (!next) return;
  await tx.execute({
    sql: "UPDATE document_comments SET quoted_text = ?, anchor_prefix = ?, anchor_suffix = ?, anchor_start_offset = ?, updated_at = ? WHERE id = ?",
    args: [
      next.quotedText,
      next.prefix,
      next.suffix,
      next.startOffset,
      now,
      String(root.id),
    ],
  });
}

function failLiveCopyRefusal(reason: ApplySuggestionRefusalReason): never {
  switch (reason) {
    case "suggestion_stale":
      throw suggestionStaleError(STALE_ACCEPT_MESSAGE);
    case "suggestion_structure_unsupported":
      fail(UNSUPPORTED_ACCEPT_MESSAGE, { statusCode: 422, errorCode: reason });
    case "suggestion_body_unavailable":
      fail(INLINE_DATABASE_ACCEPT_MESSAGE, {
        statusCode: 409,
        errorCode: reason,
      });
    case "suggestion_unmappable":
      fail(
        "This suggestion can't be placed without changing other parts of the Page, so it was not accepted. It's still pending: reject it, or suggest the edit again.",
        { statusCode: 409, errorCode: reason },
      );
  }
}

function failDecisionMoved(): never {
  fail(
    "The suggestion changed while it was being accepted; refresh before deciding",
    { statusCode: 409, errorCode: "suggestion_conflict" },
  );
}

/**
 * Accepts one suggestion inside the commit of the live-copy edit that placed
 * it. The body persist has already written the Page. This checks that the
 * decided suggestion is the one the edit placed and that the Page may take it,
 * then re-anchors the comment that asked for it.
 */
async function applyOnLiveCopy(
  context: SuggestionContext,
  coordination: LiveCopyDecision,
) {
  if (coordination.liveCopy === "replaying") failDecisionMoved();
  if (coordination.liveCopy === "refused")
    failLiveCopyRefusal(coordination.reason);
  validateOperations(context.operations);
  const step = coordination.steps.get(context.suggestion.id);
  if (
    !step ||
    JSON.stringify(step.operation) !== JSON.stringify(context.operations[0])
  )
    failDecisionMoved();
  const tx = context.transaction as DbExec;
  // guard:allow-unscoped — core's decide action asserted edit access to this Page before applying.
  const current = (
    await tx.execute({
      sql: "SELECT content,body_revision,updated_at,source_mode,source_kind,source_path,trashed_at FROM documents WHERE id = ? FOR UPDATE",
      args: [context.resourceId],
    })
  ).rows[0];
  if (!current) throw new Error("Document not found");
  if (
    current.source_mode ||
    current.source_kind ||
    current.source_path ||
    current.trashed_at
  ) {
    throw new Error("This Page can no longer accept suggestions");
  }
  const sourceLink = await tx.execute({
    sql: "SELECT state FROM document_sync_links WHERE document_id = ? AND state != 'unlinked' LIMIT 1",
    args: [context.resourceId],
  });
  if (sourceLink.rows.length) {
    throw new Error("Externally linked Pages cannot accept suggestions yet");
  }
  await assertSuggestionBodyTarget(tx, context.resourceId);

  const content = String(current.content);
  const { commit } = coordination;
  if (commit && content !== commit.after)
    throw new Error("The Page's body is not the one its live copy committed");
  const before = coordination.text ?? commit?.before ?? content;
  const placed = applyMarkdownSuggestionWithSiblings(
    before,
    step.operation,
    step.acceptedSiblingRanges,
  );
  if (placed === null) {
    if (commit)
      throw new Error(
        "The live copy placed a suggestion its committed body cannot hold",
      );
    throw suggestionStaleError(
      "The Page changed while accepting this suggestion",
    );
  }
  coordination.text = placed;
  coordination.applied.push(context.suggestion.id);

  if (!commit) {
    // The edit changed nothing because the live copy already read as the
    // result, so the Page's body must too.
    if (
      coordination.applied.length === coordination.steps.size &&
      canonicalizeNfm(placed) !== content
    )
      throw suggestionStaleError(
        "The Page changed while accepting this suggestion",
      );
    const bodyRevision = Number(current.body_revision);
    const revision = documentRevisionToken(bodyRevision, content);
    return {
      resourceId: context.resourceId,
      updatedAt: String(current.updated_at),
      revision,
      baseRevision: revision,
      bodyRevision,
    };
  }
  await reanchorSourceComment(
    tx,
    context.resourceId,
    context.suggestion,
    before,
    placed,
    commit.updatedAt,
    commit.after,
  );
  const revision = documentRevisionToken(commit.bodyRevision, commit.after);
  return {
    resourceId: context.resourceId,
    updatedAt: commit.updatedAt,
    revision,
    baseRevision: revision,
    bodyRevision: commit.bodyRevision,
  };
}

export const contentDocumentSuggestionAdapter: SuggestionAdapter = {
  kind: CONTENT_DOCUMENT_SUGGESTION_ADAPTER,
  version: 1,
  async validateProposal(input) {
    if (input.resourceType !== "document") {
      throw new Error("Content suggestions are only available for Pages");
    }
    let document = documentFromContext(input.ctx);
    const transaction = input.ctx?.transaction as DbExec | undefined;
    if (transaction) {
      const row = (
        await transaction.execute({
          sql: "SELECT content,body_revision,updated_at,trashed_at,source_mode,source_kind,source_path FROM documents WHERE id = ?",
          args: [input.resourceId],
        })
      ).rows[0];
      document = row
        ? {
            content: row.content,
            bodyRevision: Number(row.body_revision),
            updatedAt: row.updated_at,
            trashedAt: row.trashed_at,
            sourceMode: row.source_mode,
            sourceKind: row.source_kind,
            sourcePath: row.source_path,
          }
        : undefined;
      const commentAiRequestId = input.metadata?.commentAiRequestId;
      if (typeof commentAiRequestId === "string") {
        const request = (
          await transaction.execute({
            sql: `SELECT id,document_id,thread_id,requester_email,thread_digest
                  FROM comment_ai_requests
                  WHERE id = ? AND document_id = ? AND requester_email = ? AND intent = 'suggest'
                  FOR UPDATE`,
            args: [
              commentAiRequestId,
              input.resourceId,
              typeof input.ctx?.userEmail === "string"
                ? input.ctx.userEmail
                : "",
            ],
          })
        ).rows[0];
        if (!request)
          throw new Error("The bound comment AI request is unavailable");
        // The UI reviews the suggestion in this thread and accepting re-anchors
        // its root comment, so the claimed thread must be the request's own.
        if (input.metadata?.sourceThreadId !== String(request.thread_id)) {
          fail("The source thread does not match the comment AI request", {
            statusCode: 409,
            errorCode: "comment_ai_thread_conflict",
          });
        }
        const comments = (
          await transaction.execute({
            sql: `SELECT id,parent_id,content,resolved,quoted_text,anchor_prefix,anchor_suffix,anchor_start_offset
                  FROM document_comments
                  WHERE document_id = ? AND thread_id = ?
                  FOR UPDATE`,
            args: [request.document_id, request.thread_id],
          })
        ).rows.map((comment) => ({
          id: String(comment.id),
          parentId:
            comment.parent_id == null ? null : String(comment.parent_id),
          content: String(comment.content),
          resolved: Number(comment.resolved),
          quotedText:
            comment.quoted_text == null ? null : String(comment.quoted_text),
          anchorPrefix:
            comment.anchor_prefix == null
              ? null
              : String(comment.anchor_prefix),
          anchorSuffix:
            comment.anchor_suffix == null
              ? null
              : String(comment.anchor_suffix),
          anchorStartOffset:
            comment.anchor_start_offset == null
              ? null
              : Number(comment.anchor_start_offset),
        }));
        const receiptId = commentIdForIdempotency(
          String(request.requester_email),
          String(request.document_id),
          `comment-ai:${commentAiRequestId}:receipt`,
        );
        if (
          commentThreadDigest(
            comments.filter((comment) => comment.id !== receiptId),
          ) !== request.thread_digest
        ) {
          fail("The comment changed before this suggestion was committed.", {
            statusCode: 409,
            errorCode: "suggestion_conflict",
          });
        }
      }
    }
    if (!document) throw new Error("Document access context is unavailable");
    if (document.trashedAt)
      throw new Error("Trashed Pages cannot receive suggestions");
    if (document.sourceMode || document.sourceKind || document.sourcePath) {
      throw new Error("Source-owned Pages cannot receive suggestions");
    }
    if (!matchesDocumentRevision(input.baseRevision, document)) {
      fail("The Page changed; refresh before saving this suggestion", {
        statusCode: 409,
        errorCode: "suggestion_conflict",
      });
    }
    const exclusions = await (transaction ?? getDbExec()).execute({
      sql: "SELECT state FROM document_sync_links WHERE document_id = ? AND state != 'unlinked' LIMIT 1",
      args: [input.resourceId],
    });
    if (exclusions.rows.length) {
      throw new Error("Externally linked Pages cannot receive suggestions yet");
    }
    await assertSuggestionBodyTarget(
      transaction ?? getDbExec(),
      input.resourceId,
    );
    let operations = validateOperations(input.operations);
    if (
      document.content !==
      markdownPayload(operations[0]!.before, "before").markdown
    ) {
      operations = [
        await proposalOnStoredBody(
          transaction,
          input.resourceId,
          document.content,
          operations[0]!,
        ),
      ];
    }
    const before = markdownPayload(operations[0]!.before, "before");
    const after = markdownPayload(operations[0]!.after, "after");
    if (before.markdown.includes("<InlineDatabase")) {
      fail("Pages with inline databases cannot receive suggestions yet.", {
        statusCode: 409,
        errorCode: "suggestion_body_unavailable",
      });
    }
    validateSuggestionStructure(
      before.markdown,
      after.markdown,
      "Suggestions can change text inside tables, callouts, toggles, and columns, but not a table's rows or cells, a callout's icon, a toggle's title, the columns themselves, images, or other content or formatting they do not support yet. Suggest a change to the text instead.",
    );
    return operations;
  },
  async coordinateDecision(context, run) {
    if (
      (await liveBodyWriterGate(context.resourceId)).writePath === "live_copy"
    ) {
      try {
        return await acceptOnLiveCopy(
          context,
          run,
          contentLiveCopyAccept,
          acceptedSuggestionRequestSource(context.ctx?.requestSource),
        );
      } catch (error) {
        if (!(error instanceof LiveCopyAcceptUnavailable)) throw error;
      }
    }
    const sync = await prepareTransactionalChange({
      source: "action",
      type: "change",
      key: "decide-resource-suggestion",
      owner: context.suggestion.ownerEmail ?? undefined,
      orgId: context.suggestion.orgId ?? undefined,
      resourceType: context.resourceType,
      resourceId: context.resourceId,
    });
    const result = await withPreparedYDocMutation(
      context.resourceId,
      acceptedSuggestionRequestSource(context.ctx?.requestSource),
      (ydoc) =>
        run({
          ydoc,
          sync,
          deferPersistence: context.proposalDecision === true,
        } satisfies ContentDecisionCoordination),
    );
    publishPersistedAcceptedSuggestion(sync, result);
    return result;
  },
  async finalizeProposalDecision(context) {
    // The live-copy edit's commit has written the body already.
    if (isLiveCopyDecision(context.coordination)) return;
    const coordination = context.coordination as
      | ContentDecisionCoordination
      | undefined;
    if (
      !coordination?.deferPersistence ||
      coordination.finalContent === undefined
    ) {
      throw new Error("Content proposal decision coordination is incomplete");
    }
    const tx = context.transaction as DbExec;
    await coordination.ydoc.persist(tx, coordination.finalContent);
    await coordination.sync.persist(tx);
  },
  async apply(context) {
    if (isLiveCopyDecision(context.coordination))
      return applyOnLiveCopy(context, context.coordination);
    const operations = validateOperations(context.operations);
    const operation = operations[0]!;
    const tx = context.transaction as DbExec;
    const coordination = context.coordination as
      | ContentDecisionCoordination
      | undefined;
    if (!coordination) {
      throw new Error("Content suggestion decision coordination is missing");
    }
    const current = (
      await tx.execute({
        sql: "SELECT id,title,content,body_revision,owner_email,org_id,updated_at,source_mode,source_kind,source_path,trashed_at FROM documents WHERE id = ?",
        args: [context.resourceId],
      })
    ).rows[0];
    if (!current) throw new Error("Document not found");
    const currentDocument = {
      bodyRevision: Number(current.body_revision),
      content: String(current.content),
    };
    if (
      current.source_mode ||
      current.source_kind ||
      current.source_path ||
      current.trashed_at
    ) {
      throw new Error("This Page can no longer accept suggestions");
    }
    const sourceLink = await tx.execute({
      sql: "SELECT state FROM document_sync_links WHERE document_id = ? AND state != 'unlinked' LIMIT 1",
      args: [context.resourceId],
    });
    if (sourceLink.rows.length) {
      throw new Error("Externally linked Pages cannot accept suggestions yet");
    }
    const currentContent = String(current.content);
    const nextContent =
      applyMarkdownSuggestionOperation(currentContent, operation) ??
      applyMarkdownSuggestionWithSiblings(
        currentContent,
        operation,
        await acceptedRangesOnSameText(
          tx,
          context.suggestion,
          markdownPayload(operation.before, "before").markdown,
        ),
      );
    if (nextContent === null) throw suggestionStaleError(STALE_ACCEPT_MESSAGE);
    const nextDocument = validateSuggestionStructure(
      currentContent,
      nextContent,
      UNSUPPORTED_ACCEPT_MESSAGE,
    );
    if (currentContent.includes("<InlineDatabase")) {
      fail(INLINE_DATABASE_ACCEPT_MESSAGE, {
        statusCode: 409,
        errorCode: "suggestion_body_unavailable",
      });
    }
    const eligiblePrimaryIds = await assertSuggestionBodyTarget(
      tx,
      context.resourceId,
    );
    const identityTx = drizzleTransactionForExec(tx);
    await tx.execute({
      sql: "SELECT id FROM documents WHERE id = ? FOR UPDATE",
      args: [context.resourceId],
    });
    // Memberships have no document foreign key. Never wait for the table after
    // locking the Page: other editors lock memberships before the Page.
    try {
      await tx.execute(
        "LOCK TABLE content_database_items IN SHARE ROW EXCLUSIVE MODE NOWAIT",
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "55P03"
      ) {
        fail("The Page is busy. Try accepting the suggestion again.", {
          statusCode: 409,
          errorCode: "suggestion_conflict",
        });
      }
      throw error;
    }
    const primaryBlocksFields = await lockPrimaryBlocksFields(
      identityTx,
      context.resourceId,
    );
    const currentTargets = await tx.execute({
      sql: `SELECT d.system_role, p.id FROM content_database_items i
            INNER JOIN content_databases d ON d.id = i.database_id AND d.deleted_at IS NULL
            LEFT JOIN document_property_definitions p ON p.id = d.primary_blocks_property_id AND p.database_id = d.id AND p.type = 'blocks'
            WHERE i.document_id = ?`,
      args: [context.resourceId],
    });
    const hasOrdinaryMembership = currentTargets.rows.some(
      (row) => row.system_role === null,
    );
    const hasEligibleTarget = currentTargets.rows.some(
      (row) =>
        (row.system_role === null ||
          (row.system_role === "files" && !hasOrdinaryMembership)) &&
        eligiblePrimaryIds.includes(String(row.id)) &&
        primaryBlocksFields.some((field) => field.propertyId === row.id),
    );
    if (
      !hasEligibleTarget &&
      (eligiblePrimaryIds.length > 0 || currentTargets.rows.length > 0)
    ) {
      fail(
        "This database item has no primary Blocks field for body suggestions.",
        {
          statusCode: 409,
          errorCode: "suggestion_body_unavailable",
        },
      );
    }
    replacePreparedCollabContent(coordination.ydoc, nextDocument);
    const now = new Date().toISOString();
    const nextBodyRevision = currentDocument.bodyRevision + 1;
    const nextRevision = documentRevisionToken(nextBodyRevision, nextContent);
    const intent = {
      writerId: `suggestion:${String(current.owner_email)}`,
      operationId: context.suggestion.id,
      authoredBaseRevision: currentDocument.bodyRevision,
    };
    const planned = mergeDocumentBodyIntents({
      authoredBaseContent: currentContent,
      authoredCandidateContent: nextContent,
      currentContent,
      currentRevision: currentDocument.bodyRevision,
      incoming: intent,
      priorIntents: [],
    });
    if (planned.status !== "resolved") {
      throw new Error(
        "The accepted suggestion cannot preserve document structure",
      );
    }
    const applied = await commitCanonicalDocumentBodyMutation({
      write: async () => {
        const updated = await tx.execute({
          sql: "UPDATE documents SET content = ?, body_revision = ?, collab_body_revision = ?, updated_at = ? WHERE id = ? AND body_revision = ? AND updated_at = ? AND content = ?",
          args: [
            nextContent,
            nextBodyRevision,
            nextBodyRevision,
            now,
            context.resourceId,
            currentDocument.bodyRevision,
            current.updated_at,
            currentContent,
          ],
        });
        return updated.rowsAffected === 1;
      },
      afterWrite: async () => {
        if (
          currentContent.includes("<callout") ||
          nextContent.includes("<callout")
        ) {
          const actorEmail = context.ctx?.userEmail;
          if (typeof actorEmail !== "string" || !actorEmail) {
            throw new Error(
              "Authentication is required to accept a suggestion",
            );
          }
          await syncPrivateCalloutReferences(identityTx, {
            documentId: context.resourceId,
            before: currentContent,
            after: nextContent,
            userEmail: actorEmail,
            ownerEmail: String(current.owner_email),
            orgId: current.org_id === null ? null : String(current.org_id),
          });
        }
        for (const field of primaryBlocksFields) {
          await persistBlocksFieldIdentity({
            db: identityTx,
            ownerEmail: field.ownerEmail,
            documentId: context.resourceId,
            propertyId: field.propertyId,
            previousMarkdown: currentContent,
            markdown: nextContent,
            now,
          });
        }
        await recordDocumentHistoryTransition({
          db: identityTx,
          ownerEmail: String(current.owner_email),
          documentId: context.resourceId,
          before: { title: String(current.title), content: currentContent },
          after: { title: String(current.title), content: nextContent },
          beforeBodyRevision: currentDocument.bodyRevision,
          afterBodyRevision: nextBodyRevision,
          cause: {
            ctx: context.ctx as ActionRunContext | undefined,
            operation: "accept-suggestion",
            origin: "suggestion",
          },
          now,
        });
        await recordDocumentBodyIntent({
          db: identityTx,
          ownerEmail: String(current.owner_email),
          orgId: context.suggestion.orgId ?? "",
          documentId: context.resourceId,
          intent,
          candidateHash: documentContentHash(nextContent),
          committedRevision: nextBodyRevision,
          changedBlockIndexes: planned.changedBlockIndexes,
          canonicalChanged: true,
          now,
        });
        await reanchorSourceComment(
          tx,
          context.resourceId,
          context.suggestion,
          currentContent,
          nextContent,
          now,
        );
        if (coordination.deferPersistence) {
          coordination.finalContent = nextContent;
        } else {
          await coordination.ydoc.persist(tx, nextContent);
          await coordination.sync.persist(tx);
        }
      },
    });
    if (!applied)
      throw suggestionStaleError(
        "The Page changed while accepting this suggestion",
      );
    return {
      resourceId: context.resourceId,
      updatedAt: now,
      revision: nextRevision,
      baseRevision: nextRevision,
      bodyRevision: nextBodyRevision,
    };
  },
  describeOperation(operation) {
    return operation.kind.split("_").join(" ");
  },
  buildUrl(resourceId, suggestionId) {
    return contentSuggestionPath(resourceId, suggestionId);
  },
};
