import { createHash } from "node:crypto";

import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  getRequestRunContext,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveCommentBlocksField } from "../server/lib/comment-blocks-field.js";
import {
  assertMentionsInText,
  submittedCommentMentions,
} from "../server/lib/comment-mention-input.js";
import { notifyDocumentComment } from "../server/lib/comment-notifications.js";
import { commentSubmissionSource } from "../server/lib/comment-submission-source.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import {
  COMMENT_ANCHOR_BLOCK_TYPES,
  nfmCommentAnchorBlocks,
  type CommentAnchorBlockType,
} from "../shared/comment-block-anchor.js";
import {
  personMentions,
  readStoredCommentMentions,
  serializeStoredCommentMentions,
} from "../shared/comment-mentions.js";
import { commentPropertyTarget } from "../shared/comment-property-target.js";
import { nfmQuoteAnchor } from "../shared/comment-quote-anchor.js";
import { nfmToDoc, type PMNode } from "../shared/nfm.js";
import {
  enqueueCommentWebhooks,
  scheduleContentWebhookDelivery,
} from "./_content-webhooks.js";
import {
  listPropertiesForAllDocumentDatabases,
  listPropertiesForDocument,
} from "./_property-utils.js";

function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const words = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ");
}

const commentSchema = z.object({
  documentId: z.string().describe("Document ID"),
  content: z.string().min(1).describe("Comment text"),
  clientOperationId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Optional UUID identifying this submission; reuse unchanged on retries. Becomes the comment ID.",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Stable key for retrying the same comment without duplication"),
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe("Thread ID; provide with parentId when replying"),
  parentId: z
    .string()
    .min(1)
    .optional()
    .describe("Parent comment ID; provide with threadId when replying"),
  quotedText: z
    .string()
    .optional()
    .describe(
      "Quoted text for the thread, exactly as the page reads: from one block, without Markdown syntax such as ** or link URLs. A quote the saved page doesn't have is refused. Without the anchor fields, they are read from the saved page around the quote's first copy; send them to comment on a later copy.",
    ),
  anchorPrefix: z
    .string()
    .optional()
    .describe("Text immediately before the quote, for robust anchoring"),
  anchorSuffix: z
    .string()
    .optional()
    .describe("Text immediately after the quote, for robust anchoring"),
  anchorStartOffset: z.coerce
    .number()
    .optional()
    .describe("Character offset of the quote start within the document"),
  propertyId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Property ID, to start a thread on one Property value (such as Status) instead of body text. The Property's name and current value are recorded with the thread; relation, rollup, and formula values aren't, because they depend on who reads them. Not used with quotedText or on replies.",
    ),
  databaseId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Collection ID that owns propertyId; omit to use the Page's Collection",
    ),
  fieldId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Blocks field ID, to start a thread in that field's tab; quotedText, which is then required, and the anchor fields come from that field's text. Omit for the page body (the primary Blocks field's ID also means the body). Field IDs are the Blocks-type properties get-document returns. Replies stay in their thread's tab, so omit it when replying. Not used with propertyId.",
    ),
  blockId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Block ID, to start a thread on a whole block, such as a video, instead of on text. A video's ID is the id attribute of its <video> tag in get-document's content; give a video without one an id with edit-document first. In a Blocks field tab, pass fieldId too. Not used with quotedText, the anchor fields, propertyId, or on replies.",
    ),
  blockType: z
    .enum(COMMENT_ANCHOR_BLOCK_TYPES)
    .optional()
    .describe("The block's type; omit to read it from the page"),
  mentions: z
    .union([z.string(), z.array(z.unknown())])
    .optional()
    .describe(
      'JSON-encoded mentions, one per @name in text order (one entry covers a person named again). People: {"email":"a@x.com","name":"A"}; agents: {"kind":"agent","model":"<model id>","name":"<label>"}. A malformed list, or an entry no @name in the text reaches, is rejected with a 400.',
    ),
});

export function commentIdForIdempotency(
  email: string,
  documentId: string,
  idempotencyKey: string,
) {
  const digest = createHash("sha256")
    .update(`${email}\0${documentId}\0${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20)}`;
}

/**
 * A retried submission may arrive from another run, or after its Property
 * changed; these may differ.
 */
const RETRY_VARIABLE_KEYS = new Set([
  "authorName",
  "submissionSource",
  "submissionRunId",
  "submissionThreadId",
  "authorModel",
  "authorEffort",
  "propertyName",
  "propertyValue",
  "fieldName",
]);

// Context read from the page around a quote that came without any; a retry
// after the page changed reads different context.
const READ_QUOTE_ANCHOR_KEYS = new Set([
  "anchorPrefix",
  "anchorSuffix",
  "anchorStartOffset",
]);

/** The saved text a new thread is in: the page body, or a Blocks field tab's. */
async function commentTargetDoc(
  document: Parameters<typeof listPropertiesForAllDocumentDatabases>[0],
  fieldId: string | null,
) {
  let markdown = document.content as string | null | undefined;
  if (fieldId) {
    const properties = await listPropertiesForAllDocumentDatabases(document, {
      requireDatabaseAccess: false,
    });
    const field = properties.find(
      (property) => property.definition.id === fieldId,
    );
    markdown = typeof field?.value === "string" ? field.value : null;
  }
  return nfmToDoc(markdown ?? "");
}

/**
 * The type of the block a new thread is on. An id more than one video goes
 * by names none of them, so no caller starts a thread on it. A caller without
 * a live editor names a block it read from the saved page, so a block that
 * isn't there is a mistake to report, as is a video known only by its derived
 * id: that id passes to another video when videos with its source are added
 * or reordered outside an editor. A person's editor can be ahead of the save,
 * so their thread is kept as they started it, and shows as unanchored if the
 * block never arrives.
 */
async function resolveCommentBlockType(args: {
  target: PMNode;
  blockId: string;
  blockType: CommentAnchorBlockType | undefined;
  strict: boolean;
}): Promise<CommentAnchorBlockType> {
  const found = nfmCommentAnchorBlocks(args.target).get(args.blockId);
  if (found?.shared) {
    fail(
      "More than one video on this Page has that id, so a thread on it would show on none of them; give the video you mean a new unique id with edit-document, then comment with that id",
      { statusCode: 400, errorCode: "comment_block_id_shared" },
    );
  }
  const named = found?.blockType ?? args.blockType;
  if (!args.strict && named) return named;
  if (found && !found.saved) {
    fail(
      "That video has no id saved in the page yet; give its <video> tag a new unique id with edit-document, then comment with that id",
      { statusCode: 400, errorCode: "comment_block_id_unsaved" },
    );
  }
  if (found) return found.blockType;
  fail(
    "No block with that ID is on this Page; read its id from get-document's content",
    { statusCode: 400, errorCode: "comment_block_not_found" },
  );
}

type CommentTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

async function resolveCommentPropertyTarget(
  document: Parameters<typeof listPropertiesForDocument>[0],
  propertyId: string,
  databaseId: string | undefined,
) {
  const properties = await listPropertiesForDocument(document, databaseId);
  const property = properties.find(
    (candidate) => candidate.definition.id === propertyId,
  );
  if (!property) {
    fail("That Property isn't on this Page", {
      statusCode: 400,
      errorCode: "comment_property_not_found",
    });
  }
  return commentPropertyTarget(property);
}

/**
 * A reply sits in its thread's tab. A `fieldId` that names another tab is
 * refused rather than moving the reply away from the thread it answers.
 */
async function replyBlocksField(
  documentId: string,
  threadId: string,
  fieldId: string | undefined,
) {
  const [root] = await getDb()
    .select({
      fieldId: schema.documentComments.fieldId,
      fieldName: schema.documentComments.fieldName,
    })
    .from(schema.documentComments)
    .where(
      and(
        eq(schema.documentComments.id, threadId),
        eq(schema.documentComments.documentId, documentId),
      ),
    )
    .limit(1);
  const inherited = {
    fieldId: root?.fieldId ?? null,
    fieldName: root?.fieldName ?? null,
  };
  if (!fieldId || fieldId === inherited.fieldId) return inherited;
  const requested = await resolveCommentBlocksField(documentId, fieldId);
  if (requested.fieldId !== inherited.fieldId) {
    fail("A reply stays in its thread's tab; omit fieldId when replying", {
      statusCode: 400,
      errorCode: "comment_field_reply_mismatch",
    });
  }
  return inherited;
}

export async function addCommentWithGuard(
  args: z.infer<typeof commentSchema>,
  ctx?: ActionRunContext,
  beforeInsert?: (tx: CommentTransaction) => Promise<void>,
) {
  const documentId = args.documentId;
  const content = args.content;

  if (Boolean(args.threadId) !== Boolean(args.parentId)) {
    throw new Error("Replies require both threadId and parentId");
  }
  if (args.propertyId && (args.threadId || args.quotedText)) {
    fail(
      "A Property comment starts its own thread and has no quoted text; omit threadId, parentId, and quotedText",
      { statusCode: 400, errorCode: "comment_property_target_conflict" },
    );
  }
  if (
    (args.blockId || args.blockType) &&
    (!args.blockId ||
      args.threadId ||
      args.quotedText ||
      args.anchorPrefix ||
      args.anchorSuffix ||
      args.anchorStartOffset !== undefined ||
      args.propertyId)
  ) {
    fail(
      "A comment on a block starts its own thread and quotes no text; pass blockId, and omit threadId, parentId, quotedText, the anchor fields, and propertyId",
      { statusCode: 400, errorCode: "comment_block_target_conflict" },
    );
  }
  if (args.propertyId && args.fieldId) {
    fail(
      "A comment targets either a Property value or a Blocks field tab; pass propertyId or fieldId, not both",
      { statusCode: 400, errorCode: "comment_field_property_conflict" },
    );
  }

  const access = await assertAccess("document", documentId, "commenter");
  const ownerEmail = access.resource.ownerEmail as string;
  const db = getDb();
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  const id =
    args.clientOperationId ??
    (args.idempotencyKey
      ? commentIdForIdempotency(email, documentId, args.idempotencyKey)
      : crypto.randomUUID());
  const threadId = args.threadId ?? id;
  const parentId = args.parentId ?? null;

  const actorKind =
    getRequestRunContext()?.runId ||
    ctx?.caller === "tool" ||
    ctx?.caller === "mcp" ||
    ctx?.caller === "webmcp" ||
    ctx?.caller === "a2a"
      ? "agent"
      : "human";
  const runContext = getRequestRunContext();
  const runModel = runContext?.model?.trim();
  const authorModel = actorKind === "agent" && runModel ? runModel : null;
  const authorEffort = authorModel
    ? (runContext?.reasoningEffort ?? null)
    : null;
  const requestName =
    actorKind === "agent" ? undefined : getRequestUserName()?.trim();
  let name: string;
  if (requestName) {
    name = requestName;
  } else {
    const derived = displayNameFromEmail(email).trim();
    name = derived || "AI Agent";
  }

  const mentions = submittedCommentMentions(args.mentions ?? []);
  assertMentionsInText(content, mentions);
  const mentionsJson = serializeStoredCommentMentions(mentions);
  const submissionSource = commentSubmissionSource(ctx?.caller);
  const submissionRunId = ctx?.runId ?? null;
  const submissionThreadId =
    actorKind === "agent"
      ? (ctx?.threadId ?? runContext?.threadId ?? null)
      : null;
  // A retry of a submission that was saved replays it, even after the
  // Property or tab it targets was deleted or left the Page.
  const savedSubmission = async () => {
    if (!args.clientOperationId && !args.idempotencyKey) return undefined;
    const [saved] = await db
      .select({
        propertyId: schema.documentComments.propertyId,
        propertyName: schema.documentComments.propertyName,
        propertyValue: schema.documentComments.propertyValue,
        fieldId: schema.documentComments.fieldId,
        fieldName: schema.documentComments.fieldName,
        blockId: schema.documentComments.blockId,
        blockType: schema.documentComments.blockType,
      })
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.id, id),
          eq(schema.documentComments.documentId, documentId),
          eq(schema.documentComments.authorEmail, email),
        ),
      )
      .limit(1);
    return saved;
  };
  const propertyId = args.propertyId;
  const propertyTarget = propertyId
    ? await resolveCommentPropertyTarget(
        access.resource as Parameters<typeof listPropertiesForDocument>[0],
        propertyId,
        args.databaseId,
      ).catch(async (error: unknown) => {
        const saved = await savedSubmission();
        if (saved?.propertyId === propertyId) {
          return {
            propertyId,
            propertyName: saved.propertyName,
            propertyValue: saved.propertyValue,
          };
        }
        throw error;
      })
    : null;
  const fieldTarget = await (
    args.threadId && args.parentId
      ? replyBlocksField(documentId, args.threadId, args.fieldId)
      : resolveCommentBlocksField(documentId, args.fieldId)
  ).catch(async (error: unknown) => {
    // The primary field is saved as the body (null), so a retry naming it
    // matches a body comment.
    const saved = await savedSubmission();
    if (
      saved &&
      (saved.fieldId === null || saved.fieldId === (args.fieldId ?? null))
    ) {
      return { fieldId: saved.fieldId, fieldName: saved.fieldName };
    }
    throw error;
  });
  const blockId = args.blockId;
  // A new thread on text the page has always carries context, as one started
  // in the editor does, so it can't be taken for a comment on a video from
  // before videos had ids, which quoted the video's label with none. Only the
  // live editor can name a quote or block its save doesn't have yet. Every
  // other caller reads the saved page, so a target the page lacks is refused
  // rather than saved with no anchor. Keyed on the caller, not actorKind: a
  // person can run the CLI too.
  const strict = ctx?.caller !== "frontend";
  const quotedText = args.threadId ? undefined : args.quotedText;
  const quotesText = !!quotedText;
  const readsQuoteAnchor =
    quotesText &&
    args.anchorPrefix === undefined &&
    args.anchorSuffix === undefined &&
    args.anchorStartOffset === undefined;
  const target =
    blockId || readsQuoteAnchor || (strict && quotesText)
      ? await commentTargetDoc(
          access.resource as Parameters<
            typeof listPropertiesForAllDocumentDatabases
          >[0],
          fieldTarget.fieldId,
        )
      : null;
  const quoteOnPage =
    quotedText && target ? nfmQuoteAnchor(target, quotedText) : null;
  const quoteAnchor = readsQuoteAnchor ? quoteOnPage : null;
  const blockType =
    blockId && target
      ? await resolveCommentBlockType({
          target,
          blockId,
          blockType: args.blockType,
          strict,
        }).catch(async (error: unknown) => {
          const saved = await savedSubmission();
          if (saved?.blockId === blockId && saved.blockType) {
            return saved.blockType as CommentAnchorBlockType;
          }
          throw error;
        })
      : null;

  const values = {
    id,
    ownerEmail,
    documentId,
    threadId,
    parentId,
    content,
    quotedText: args.quotedText ?? null,
    anchorPrefix: args.anchorPrefix ?? quoteAnchor?.prefix ?? null,
    anchorSuffix: args.anchorSuffix ?? quoteAnchor?.suffix ?? null,
    anchorStartOffset:
      args.anchorStartOffset ?? quoteAnchor?.startOffset ?? null,
    propertyId: propertyTarget?.propertyId ?? null,
    propertyName: propertyTarget?.propertyName ?? null,
    propertyValue: propertyTarget?.propertyValue ?? null,
    fieldId: fieldTarget.fieldId,
    fieldName: fieldTarget.fieldName,
    blockId: blockId ?? null,
    blockType,
    mentionsJson,
    authorEmail: email,
    authorName: name,
    submissionSource,
    submissionRunId,
    submissionThreadId,
    actorKind,
    authorModel,
    authorEffort,
  };

  let webhookEvents = 0;
  const inserted = await db.transaction(async (tx) => {
    const existingReceipt = async () => {
      const [existing] = await tx
        .select()
        .from(schema.documentComments)
        .where(
          and(
            eq(schema.documentComments.id, id),
            eq(schema.documentComments.documentId, documentId),
            eq(schema.documentComments.authorEmail, email),
          ),
        )
        .limit(1);
      if (!existing) return false;
      if (
        Object.entries(values).some(([key, value]) => {
          if (
            RETRY_VARIABLE_KEYS.has(key) ||
            (readsQuoteAnchor && READ_QUOTE_ANCHOR_KEYS.has(key))
          )
            return false;
          if (key === "mentionsJson") {
            return (
              serializeStoredCommentMentions(
                readStoredCommentMentions(existing.mentionsJson),
              ) !== value
            );
          }
          return existing[key as keyof typeof existing] !== value;
        })
      ) {
        fail("Comment submission ID conflicts with another submission", {
          statusCode: 409,
          errorCode: "comment_submission_conflict",
        });
      }
      return true;
    };
    if (
      (args.clientOperationId || args.idempotencyKey) &&
      (await existingReceipt())
    )
      return false;
    // A new thread that quotes nothing is a comment on the whole page, which
    // belongs to no tab. Checked after the receipt, so a retry of one saved
    // before this rule still replays.
    if (
      !args.threadId &&
      fieldTarget.fieldId &&
      !args.quotedText?.trim() &&
      !blockId
    ) {
      fail(
        "A thread in a Blocks field tab quotes text from that tab; pass quotedText, or omit fieldId to comment on the whole page",
        { statusCode: 400, errorCode: "comment_field_quote_required" },
      );
    }
    if (strict && quotesText && !quoteOnPage) {
      fail(
        "That quotedText isn't in the text this thread would be on (the Page, or the fieldId tab), so it would have no highlight; quote the text exactly as the Page reads, from one block and without Markdown syntax such as ** or link URLs",
        { statusCode: 400, errorCode: "comment_quote_not_found" },
      );
    }
    await assertAccess("document", documentId, "commenter", {
      userEmail: email,
      orgId: ctx?.orgId ?? undefined,
      transaction: getDbExec(),
    });
    if (args.threadId && args.parentId) {
      const [root] = await tx
        .select()
        .from(schema.documentComments)
        .where(
          and(
            eq(schema.documentComments.id, args.threadId),
            eq(schema.documentComments.documentId, documentId),
          ),
        )
        .limit(1)
        .for("update");
      if (
        (args.clientOperationId || args.idempotencyKey) &&
        (await existingReceipt())
      )
        return false;
      const [parent] = await tx
        .select()
        .from(schema.documentComments)
        .where(
          and(
            eq(schema.documentComments.id, args.parentId),
            eq(schema.documentComments.documentId, documentId),
          ),
        )
        .limit(1);
      if (
        !root ||
        root.threadId !== args.threadId ||
        !parent ||
        parent.threadId !== args.threadId
      ) {
        fail("Reply parent does not belong to the selected thread", {
          statusCode: 409,
        });
      }
      if (root.resolved) {
        fail("Reopen the thread before replying", {
          statusCode: 409,
          errorCode: "comment_thread_resolved",
        });
      }
    }
    await beforeInsert?.(tx);
    const created = await tx
      .insert(schema.documentComments)
      .values(values)
      .onConflictDoNothing({ target: schema.documentComments.id })
      .returning({ id: schema.documentComments.id });
    if (!created.length) {
      if (await existingReceipt()) return false;
      fail("Comment submission ID conflicts with another submission", {
        statusCode: 409,
        errorCode: "comment_submission_conflict",
      });
    }
    webhookEvents = await enqueueCommentWebhooks(
      tx as unknown as ReturnType<typeof getDb>,
      {
        type: "comment.created",
        comment: {
          id,
          documentId,
          threadId,
          parentId,
          authorEmail: email,
          content,
          resolved: false,
        },
        actor: { kind: actorKind, email: email.trim().toLowerCase() },
      },
    );
    return true;
  });
  if (!inserted) return { id, threadId, notified: null, replayed: true };
  if (webhookEvents) scheduleContentWebhookDelivery();

  const notified = await notifyDocumentComment({
    documentId,
    documentTitle: (access.resource.title as string | null) ?? "",
    orgId: (access.resource.orgId as string | null) ?? null,
    threadId,
    ownerEmail,
    authorEmail: email,
    authorName: name,
    submissionSource,
    content,
    mentions: personMentions(mentions),
    isReply: Boolean(parentId ?? args.threadId),
  });

  return { id, threadId, notified };
}

export default defineAction({
  description:
    "Add a comment to a document. Comment text supports inline Markdown for emphasis, inline code, links, and line breaks; headings are flattened. To reply, provide both threadId and parentId; omit both to start a thread. A new thread with no quotedText, propertyId, or blockId is a comment on the whole page; it shows in the page's Discussion. Pass blockId to start a thread on a whole video. Pass fieldId to start a thread in a Blocks field tab other than the page body.",
  deferLoading: false,
  mcpTool: true,
  schema: commentSchema,
  changeResource: (input) => documentChangeResource(input.documentId),
  run: (args, ctx) => addCommentWithGuard(args, ctx),
});
