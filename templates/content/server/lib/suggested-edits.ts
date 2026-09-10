import { fail } from "@agent-native/core/action";
import {
  withPreparedYDocMutation,
  type PreparedYDocMutationLease,
} from "@agent-native/core/collab";
import { getDbExec, type DbExec } from "@agent-native/core/db";
import type {
  SuggestionAdapter,
  SuggestionOperation,
} from "@agent-native/core/review";
import {
  prepareTransactionalChange,
  type TransactionalChange,
} from "@agent-native/core/server";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { drizzle } from "drizzle-orm/pg-proxy";

import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "../../actions/_blocks-field-identity.js";
import {
  SUPPORTED_SUGGESTION_BLOCKS,
  SUPPORTED_SUGGESTION_MARKS,
} from "../../app/components/editor/suggestions/model.js";
import { createVisualEditorExtensions } from "../../app/components/editor/VisualEditor.js";
import { nfmToDoc } from "../../shared/nfm.js";
import { contentSuggestionPath } from "../../shared/suggestion-link.js";
import { resolveMarkdownSuggestionRange } from "../../shared/suggestion-rebase.js";
import { schema } from "../db/index.js";
import { commitCanonicalDocumentBodyMutation } from "./canonical-document-body-mutation.js";

export const CONTENT_DOCUMENT_SUGGESTION_ADAPTER = "content.document-markdown";

type MarkdownOperationPayload = {
  markdown: string;
  changedText?: string;
};

type MarkdownOperationAnchor = {
  from: number;
  to: number;
  prefix: string;
  suffix: string;
};

function markdownPayload(
  value: unknown,
  label: "before" | "after",
): MarkdownOperationPayload {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { markdown?: unknown }).markdown !== "string"
  ) {
    throw new Error(`Content suggestions require ${label}.markdown`);
  }
  const payload = value as MarkdownOperationPayload;
  if (payload.markdown.length > 1_000_000) {
    throw new Error("Content suggestion payload is too large");
  }
  return payload;
}

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

function operationAnchor(operation: SuggestionOperation) {
  const anchor = operation.anchor as Partial<MarkdownOperationAnchor> | null;
  if (
    !anchor ||
    !Number.isInteger(anchor.from) ||
    !Number.isInteger(anchor.to) ||
    typeof anchor.prefix !== "string" ||
    typeof anchor.suffix !== "string"
  ) {
    throw new Error("Content suggestions require a contextual body anchor");
  }
  return anchor as MarkdownOperationAnchor;
}

export function applyMarkdownSuggestionOperation(
  currentMarkdown: string,
  operation: SuggestionOperation,
) {
  const before = markdownPayload(operation.before, "before");
  const after = markdownPayload(operation.after, "after");
  if (currentMarkdown === before.markdown) return after.markdown;
  if (
    typeof before.changedText !== "string" ||
    typeof after.changedText !== "string"
  ) {
    return null;
  }
  operationAnchor(operation);
  const range = resolveMarkdownSuggestionRange(currentMarkdown, operation);
  if (!range) return null;
  const { from, to } = range;
  return `${currentMarkdown.slice(0, from)}${after.changedText}${currentMarkdown.slice(to)}`;
}

function documentFromContext(ctx: Record<string, unknown> | undefined) {
  const access = ctx?.suggestionAccess as
    | { resource?: Record<string, unknown> }
    | undefined;
  return access?.resource;
}

function decisionChatContext(ctx: Record<string, unknown> | undefined) {
  const context = Object.fromEntries(
    (["threadId", "runId", "turnId"] as const).flatMap((key) =>
      typeof ctx?.[key] === "string" && ctx[key].trim()
        ? [[key, ctx[key]]]
        : [],
    ),
  );
  return Object.keys(context).length ? JSON.stringify(context) : null;
}

type ContentDecisionCoordination = {
  ydoc: PreparedYDocMutationLease;
  sync: TransactionalChange;
};

export function publishPersistedAcceptedSuggestion(
  sync: TransactionalChange,
  result: unknown,
): void {
  if (
    sync.isPersisted() &&
    (result as { decision?: { outcome?: string } }).decision?.outcome ===
      "accepted"
  ) {
    sync.publish();
  }
}

let contentEditorSchema: ReturnType<typeof getSchema> | undefined;

type SuggestionDocumentJson = {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: SuggestionDocumentJson[];
};

function parseSuggestionMarkdown(markdown: string) {
  contentEditorSchema ??= getSchema(createVisualEditorExtensions());
  return contentEditorSchema.nodeFromJSON(nfmToDoc(markdown));
}

function unsupportedSuggestionStructure(
  node: SuggestionDocumentJson,
  path: number[] = [],
  result: unknown[] = [],
): unknown[] {
  if (node.type === "text") {
    for (const mark of node.marks ?? []) {
      if (
        !SUPPORTED_SUGGESTION_MARKS.has(
          mark.type as Parameters<typeof SUPPORTED_SUGGESTION_MARKS.has>[0],
        )
      ) {
        result.push({ path, mark: { type: mark.type, attrs: mark.attrs } });
      }
    }
    return result;
  }
  if (
    node.type !== "doc" &&
    !SUPPORTED_SUGGESTION_BLOCKS.has(node.type ?? "")
  ) {
    result.push({ path, node });
    return result;
  }
  for (const [index, child] of (node.content ?? []).entries()) {
    unsupportedSuggestionStructure(child, [...path, index], result);
  }
  return result;
}

function validateSuggestionStructure(
  beforeMarkdown: string,
  afterMarkdown: string,
) {
  const before = parseSuggestionMarkdown(beforeMarkdown);
  const after = parseSuggestionMarkdown(afterMarkdown);
  if (
    JSON.stringify(unsupportedSuggestionStructure(before.toJSON())) !==
    JSON.stringify(unsupportedSuggestionStructure(after.toJSON()))
  ) {
    throw new Error(
      "Content v1 suggestions cannot add or change unsupported structures",
    );
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

function replacePreparedCollabContent(
  lease: PreparedYDocMutationLease,
  proseMirrorDoc: ReturnType<typeof parseSuggestionMarkdown>,
): void {
  prosemirrorJSONToYXmlFragment(
    contentEditorSchema!,
    proseMirrorDoc.toJSON(),
    lease.doc.getXmlFragment("default"),
  );
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
          sql: "SELECT content,updated_at,trashed_at,source_mode,source_kind,source_path FROM documents WHERE id = ?",
          args: [input.resourceId],
        })
      ).rows[0];
      document = row
        ? {
            content: row.content,
            updatedAt: row.updated_at,
            trashedAt: row.trashed_at,
            sourceMode: row.source_mode,
            sourceKind: row.source_kind,
            sourcePath: row.source_path,
          }
        : undefined;
    }
    if (!document) throw new Error("Document access context is unavailable");
    if (document.trashedAt)
      throw new Error("Trashed Pages cannot receive suggestions");
    if (document.sourceMode || document.sourceKind || document.sourcePath) {
      throw new Error("Source-owned Pages cannot receive suggestions");
    }
    if (document.updatedAt !== input.baseRevision) {
      fail("The Page changed; refresh before saving this suggestion", {
        statusCode: 409,
        errorCode: "suggestion_conflict",
      });
    }
    const exclusions = await (transaction ?? getDbExec()).execute({
      sql: `SELECT 'database' AS kind
            FROM content_database_items i
            INNER JOIN content_databases d ON d.id = i.database_id
            WHERE i.document_id = ? AND d.system_role IS NULL
            UNION ALL
            SELECT 'external' AS kind FROM document_sync_links WHERE document_id = ? AND state != 'unlinked'
            LIMIT 1`,
      args: [input.resourceId, input.resourceId],
    });
    if (exclusions.rows.length) {
      throw new Error(
        "Database item and externally linked Pages cannot receive suggestions yet",
      );
    }
    const operations = validateOperations(input.operations);
    const before = markdownPayload(operations[0]!.before, "before");
    const after = markdownPayload(operations[0]!.after, "after");
    if (document.content !== before.markdown) {
      fail(
        "The suggestion before-state does not match the Page; refresh before saving this suggestion",
        {
          statusCode: 409,
          errorCode: "suggestion_conflict",
        },
      );
    }
    if (before.markdown.includes("<InlineDatabase")) {
      throw new Error(
        "Pages with inline databases cannot receive suggestions yet",
      );
    }
    validateSuggestionStructure(before.markdown, after.markdown);
    return operations;
  },
  async coordinateDecision(context, run) {
    if (context.decision === "rejected") return run();
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
      typeof context.ctx?.requestSource === "string"
        ? context.ctx.requestSource
        : undefined,
      (ydoc) => run({ ydoc, sync } satisfies ContentDecisionCoordination),
    );
    publishPersistedAcceptedSuggestion(sync, result);
    return result;
  },
  async apply(context) {
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
        sql: "SELECT id,title,content,owner_email,updated_at,source_mode,source_kind,source_path,trashed_at FROM documents WHERE id = ?",
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
    const currentContent = String(current.content);
    const nextContent = applyMarkdownSuggestionOperation(
      currentContent,
      operation,
    );
    if (nextContent === null) {
      const error = new Error(
        "The Page changed after this suggestion was created",
      );
      error.name = "SuggestionStaleError";
      throw error;
    }
    const nextDocument = validateSuggestionStructure(
      currentContent,
      nextContent,
    );
    const membership = await tx.execute({
      sql: `SELECT i.id
            FROM content_database_items i
            INNER JOIN content_databases d ON d.id = i.database_id
            WHERE i.document_id = ? AND d.system_role IS NULL
            LIMIT 1`,
      args: [context.resourceId],
    });
    if (membership.rows.length) {
      throw new Error(
        "Database item Pages cannot receive body suggestions yet",
      );
    }
    if (currentContent.includes("<InlineDatabase")) {
      throw new Error(
        "Pages containing inline databases cannot accept suggestions yet",
      );
    }
    const identityTx = drizzleTransactionForExec(tx);
    const primaryBlocksFields = await lockPrimaryBlocksFields(
      identityTx,
      context.resourceId,
    );
    replacePreparedCollabContent(coordination.ydoc, nextDocument);
    const now = new Date().toISOString();
    const applied = await commitCanonicalDocumentBodyMutation({
      write: async () => {
        const updated = await tx.execute({
          sql: "UPDATE documents SET content = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND content = ?",
          args: [
            nextContent,
            now,
            context.resourceId,
            current.updated_at,
            currentContent,
          ],
        });
        return updated.rowsAffected === 1;
      },
      afterWrite: async () => {
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
        await tx.execute({
          sql: "INSERT INTO document_versions (id,owner_email,document_id,title,content,chat_context,created_at) VALUES (?,?,?,?,?,?,?)",
          args: [
            globalThis.crypto.randomUUID(),
            current.owner_email,
            context.resourceId,
            current.title,
            current.content,
            decisionChatContext(context.ctx),
            now,
          ],
        });
        await coordination.ydoc.persist(tx, nextContent);
        await coordination.sync.persist(tx);
      },
    });
    if (!applied) {
      const error = new Error(
        "The Page changed while accepting this suggestion",
      );
      error.name = "SuggestionStaleError";
      throw error;
    }
    return { resourceId: context.resourceId, updatedAt: now };
  },
  describeOperation(operation) {
    return operation.kind.split("_").join(" ");
  },
  buildUrl(resourceId, suggestionId) {
    return contentSuggestionPath(resourceId, suggestionId);
  },
};
