import { fail } from "@agent-native/core/action";
import { getDbExec, type DbExec } from "@agent-native/core/db";
import type {
  SuggestionAdapter,
  SuggestionOperation,
} from "@agent-native/core/review";
import { and, eq } from "drizzle-orm";

import { lockPrimaryBlocksFields } from "../../actions/_blocks-field-identity.js";
import {
  assertPropertyWritableByRowMutation,
  readStoredBlocksField,
  writeStoredBlocksField,
} from "../../actions/_blocks-field-write.js";
import { lockContentDatabaseMutation } from "../../actions/_content-database-mutation-lock.js";
import { assertEditableDocument } from "../../actions/_document-edit-mutation.js";
import { lockDocumentRows } from "../../actions/_row-lock-order.js";
import { blocksFieldId } from "../../shared/blocks-field-identity.js";
import {
  blocksFieldSuggestionRevision,
  CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
  parseBlocksFieldSuggestionRevision,
} from "../../shared/blocks-field-suggestions.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  parsePropertyOptions,
  type DocumentPropertyType,
} from "../../shared/properties.js";
import {
  applyMarkdownSuggestionOperation,
  applyMarkdownSuggestionWithSiblings,
  markdownPayload,
  placeMarkdownSuggestion,
} from "../../shared/suggestion-apply.js";
import { contentSuggestionPath } from "../../shared/suggestion-link.js";
import { schema } from "../db/index.js";
import {
  CONTENT_SUGGESTION_OPERATION_KINDS,
  drizzleTransactionForExec,
  suggestionStaleError,
  validateSuggestionStructure,
} from "./suggested-edits.js";
import { acceptedRangesOnSameText } from "./suggestion-live-accept.js";

const ANCHOR_CONTEXT = 32;
const STALE_ACCEPT_MESSAGE =
  "The text around this suggestion changed, so it can't be placed in the tab's current text. It's still pending: reject it, or suggest the edit again.";
const UNSUPPORTED_MESSAGE =
  "Suggestions can change text inside tables, callouts, toggles, and columns, but not a table's rows or cells, a callout's icon, a toggle's title, the columns themselves, images, or other content or formatting they do not support yet. Suggest a change to the text instead.";
const UNSUPPORTED_ACCEPT_MESSAGE =
  "This suggestion changes a table's rows or cells, a callout's icon, a toggle's title, a column layout, an image, or other content or formatting that suggestions do not support yet, so it cannot be accepted.";
const INLINE_DATABASE_MESSAGE =
  "Tabs containing inline databases cannot receive suggestions yet.";

function fieldOperation(operations: SuggestionOperation[]) {
  if (operations.length !== 1) {
    throw new Error(
      "Content v1 accepts one independently reviewable edit per suggestion",
    );
  }
  const operation = operations[0]!;
  if (!CONTENT_SUGGESTION_OPERATION_KINDS.includes(operation.kind)) {
    throw new Error(
      `Unsupported Content suggestion operation: ${operation.kind}`,
    );
  }
  if (
    operation.schemaVersion !== 1 ||
    typeof operation.targetId !== "string" ||
    !operation.targetId ||
    operation.targetId === "body"
  ) {
    throw new Error(
      "A tab suggestion must name its Blocks field in targetId and use the version 1 grammar",
    );
  }
  const before = markdownPayload(operation.before, "before").markdown;
  const after = markdownPayload(operation.after, "after").markdown;
  if (before === after) throw new Error("A suggestion must change the tab");
  return { operation, fieldId: operation.targetId, before, after };
}

function fieldUnavailable(): never {
  fail("That tab isn't on this Page.", {
    statusCode: 409,
    errorCode: "suggestion_field_unavailable",
  });
}

/**
 * The Blocks field a tab suggestion edits, which must be a field of a
 * Collection the Page is a row of and stored apart from the Page body: the
 * body's own field takes body suggestions.
 */
async function readSuggestionField(
  tx: DbExec,
  documentId: string,
  fieldId: string,
) {
  const field = (
    await tx.execute({
      sql: `SELECT p.id, p.type, p.options_json, d.id AS database_id
            FROM document_property_definitions p
            INNER JOIN content_databases d ON d.id = p.database_id AND d.deleted_at IS NULL
            INNER JOIN content_database_items i ON i.database_id = d.id AND i.document_id = ?
            WHERE p.id = ?
            LIMIT 1`,
      args: [documentId, fieldId],
    })
  ).rows[0];
  if (
    !field ||
    !isBlocksPropertyType(String(field.type) as DocumentPropertyType) ||
    blocksStorageTarget(parsePropertyOptions(field.options_json as string)) !==
      "block_field_store"
  )
    fieldUnavailable();
  return { databaseId: String(field.database_id) };
}

async function storedFieldRevision(
  tx: DbExec,
  documentId: string,
  fieldId: string,
) {
  const row = (
    await tx.execute({
      sql: "SELECT revision FROM document_block_fields WHERE id = ?",
      args: [blocksFieldId(documentId, fieldId)],
    })
  ).rows[0];
  return row ? Number(row.revision) : 0;
}

/**
 * The edit placed on the tab's current text, with the same words changed,
 * or null when they can't be found there.
 */
function operationOnCurrentField(
  operation: SuggestionOperation,
  current: string,
) {
  const placed = placeMarkdownSuggestion(current, operation);
  if (!placed) return null;
  const after = `${current.slice(0, placed.from)}${placed.changedText}${current.slice(placed.to)}`;
  if (after === current) return null;
  return {
    ...operation,
    before: {
      markdown: current,
      changedText: current.slice(placed.from, placed.to),
    },
    after: { markdown: after, changedText: placed.changedText },
    anchor: {
      from: placed.from,
      to: placed.to,
      prefix: current.slice(
        Math.max(0, placed.from - ANCHOR_CONTEXT),
        placed.from,
      ),
      suffix: current.slice(placed.to, placed.to + ANCHOR_CONTEXT),
    },
  };
}

function checkSupportedStructure(before: string, after: string) {
  if (before.includes("<InlineDatabase")) {
    fail(INLINE_DATABASE_MESSAGE, {
      statusCode: 409,
      errorCode: "suggestion_body_unavailable",
    });
  }
  validateSuggestionStructure(before, after, UNSUPPORTED_MESSAGE);
}

/**
 * Suggestions on a Blocks field tab other than the Page body. They're made
 * and reviewed like body suggestions, but accepting one writes its field as
 * a tab's own save does, at the field's next revision, and leaves the body
 * and every other field alone.
 */
export const contentBlocksFieldSuggestionAdapter: SuggestionAdapter = {
  kind: CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
  version: 1,
  async validateProposal(input) {
    if (input.resourceType !== "document") {
      throw new Error("Content suggestions are only available for Pages");
    }
    // Ask AI answers on the body's thread; tabs don't take them yet.
    if (input.metadata?.commentAiRequestId !== undefined) {
      fail("Ask AI can't suggest edits in this tab yet.", {
        statusCode: 409,
        errorCode: "suggestion_field_unavailable",
      });
    }
    const { fieldId, before, after } = fieldOperation(input.operations);
    const base = parseBlocksFieldSuggestionRevision(input.baseRevision);
    if (!base || base.propertyId !== fieldId) {
      throw new Error(
        "A tab suggestion's base revision must name the field it edits",
      );
    }
    const tx = (input.ctx?.transaction as DbExec | undefined) ?? getDbExec();
    const page = (
      await tx.execute({
        sql: "SELECT trashed_at FROM documents WHERE id = ?",
        args: [input.resourceId],
      })
    ).rows[0];
    if (!page) throw new Error("Document not found");
    if (page.trashed_at)
      throw new Error("Trashed Pages cannot receive suggestions");
    await readSuggestionField(tx, input.resourceId, fieldId);
    const revision = await storedFieldRevision(tx, input.resourceId, fieldId);
    const content = String(
      (
        await tx.execute({
          sql: "SELECT content FROM document_block_field_contents WHERE document_id = ? AND property_id = ?",
          args: [input.resourceId, fieldId],
        })
      ).rows[0]?.content ?? "",
    );
    if (
      input.baseRevision === blocksFieldSuggestionRevision(fieldId, revision) &&
      before === content
    ) {
      checkSupportedStructure(before, after);
      return input.operations;
    }
    // Someone saved the tab since the suggester read it. Their edit is moved
    // onto the tab's current text, as accepting it would place it, unless
    // the words it changes are gone.
    const moved =
      base.revision <= revision
        ? operationOnCurrentField(input.operations[0]!, content)
        : null;
    if (!moved) {
      fail("The tab changed; refresh before saving this suggestion", {
        statusCode: 409,
        errorCode: "suggestion_conflict",
      });
    }
    checkSupportedStructure(content, moved.after.markdown);
    return [moved];
  },
  async apply(context) {
    const { operation, fieldId, before } = fieldOperation(context.operations);
    const tx = context.transaction as DbExec;
    const db = drizzleTransactionForExec(tx) as unknown as Parameters<
      typeof lockContentDatabaseMutation
    >[0];
    const documentId = context.resourceId;
    const { databaseId } = await readSuggestionField(tx, documentId, fieldId);
    // The order set-document-property locks in, so the two never deadlock.
    await lockContentDatabaseMutation(db, databaseId);
    await lockPrimaryBlocksFields(db, documentId);
    await lockDocumentRows(db, [documentId]);
    const [page] = await db
      .select({ trashedAt: schema.documents.trashedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    assertEditableDocument(page);
    const [definition] = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.id, fieldId),
          eq(schema.documentPropertyDefinitions.databaseId, databaseId),
        ),
      );
    if (!definition) fieldUnavailable();
    // Checked again under the locks: the field may have changed since.
    await readSuggestionField(tx, documentId, fieldId);
    await assertPropertyWritableByRowMutation(db, databaseId, definition);
    const [database] = await db
      .select({ ownerEmail: schema.contentDatabases.ownerEmail })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    if (!database) fieldUnavailable();

    const current = await readStoredBlocksField(db, documentId, fieldId);
    const next =
      applyMarkdownSuggestionOperation(current, operation) ??
      applyMarkdownSuggestionWithSiblings(
        current,
        operation,
        await acceptedRangesOnSameText(tx, context.suggestion, before, fieldId),
      );
    if (next === null) throw suggestionStaleError(STALE_ACCEPT_MESSAGE);
    if (current.includes("<InlineDatabase")) {
      fail(INLINE_DATABASE_MESSAGE, {
        statusCode: 409,
        errorCode: "suggestion_body_unavailable",
      });
    }
    validateSuggestionStructure(current, next, UNSUPPORTED_ACCEPT_MESSAGE);
    await writeStoredBlocksField(db, {
      ownerEmail: database.ownerEmail,
      documentId,
      propertyId: fieldId,
      content: next,
      expectedRevision: await storedFieldRevision(tx, documentId, fieldId),
      now: new Date().toISOString(),
    });
    return { resourceId: documentId, propertyId: fieldId };
  },
  describeOperation(operation) {
    return operation.kind.split("_").join(" ");
  },
  buildUrl(resourceId, suggestionId) {
    return contentSuggestionPath(resourceId, suggestionId);
  },
};
