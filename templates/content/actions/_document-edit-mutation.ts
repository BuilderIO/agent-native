import { createHash } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  documentVersionChatContextFromAction,
  serializeDocumentVersionChatContext,
} from "../server/lib/document-version-context.js";
import {
  resolveDocumentTextEdits,
  type DocumentTextEdit,
} from "../shared/document-text-edits.js";
import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "./_blocks-field-identity.js";

type Db = ReturnType<typeof getDb>;

export function documentContentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function documentRevisionToken(
  revision: number,
  content: string,
): string {
  return `body:${revision}:${documentContentHash(content)}`;
}

function parseRevisionToken(
  value: string,
): { revision: number; contentHash: string } | null {
  const match = /^body:(0|[1-9]\d*):(sha256:[a-f0-9]{64})$/.exec(value);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision)
    ? { revision, contentHash: match[2]! }
    : null;
}

function digest(value: unknown): string {
  return documentContentHash(JSON.stringify(value));
}

function conflict(
  errorCode: string,
  message: string,
  details: Record<string, unknown>,
): never {
  throw new ActionContractError(message, {
    errorCode,
    details,
    statusCode: 409,
  });
}

function callerScope(ctx: ActionRunContext): string {
  const authority = ctx.orgId
    ? `org:${ctx.orgId}`
    : ctx.userEmail
      ? `user:${ctx.userEmail}`
      : null;
  if (!authority) {
    throw new ActionContractError(
      "External document edits require an authenticated caller scope.",
      { errorCode: "CALLER_SCOPE_REQUIRED", statusCode: 401 },
    );
  }
  // The surface and authenticated authority are durable retry identity.
  // Network request/run/peer IDs describe one delivery attempt and therefore
  // must not split identical retries into separate receipt scopes.
  return `${ctx.caller}:${authority}`;
}

function replayResult(stored: typeof schema.documentEditReceipts.$inferSelect) {
  const parsed = JSON.parse(stored.resultJson) as DocumentEditMutationResult;
  if (
    parsed.receipt.receiptId !== stored.id ||
    parsed.receipt.revisions.after !==
      `body:${stored.resultRevision}:${stored.afterHash}` ||
    parsed.receipt.hashes.after !== stored.afterHash
  ) {
    conflict(
      "RECEIPT_MISMATCH",
      "The stored document edit receipt is inconsistent.",
      {
        receiptId: stored.id,
      },
    );
  }
  return {
    ...parsed,
    receipt: {
      ...parsed.receipt,
      idempotency: {
        ...parsed.receipt.idempotency,
        result: "replayed" as const,
      },
    },
  };
}

export interface DocumentEditMutationResult {
  applied: number;
  total: number;
  receipt: {
    receiptId: string;
    outcome: "applied" | "unchanged";
    documentId: string;
    revisions: { before: string; after: string };
    bodyRevision: { before: number; after: number };
    hashes: { before: string; after: string };
    ranges: Array<{ editIndex: number; start: number; end: number }>;
    idempotency: {
      key: string;
      result: "applied" | "replayed";
      payloadDigest: string;
    };
    readback: { verified: true };
  };
}

export async function mutateDocumentBody(args: {
  documentId: string;
  baseRevision: string;
  idempotencyKey: string;
  edits: DocumentTextEdit[];
  ctx: ActionRunContext;
  db?: Db;
}): Promise<DocumentEditMutationResult> {
  const db = args.db ?? getDb();
  const scope = callerScope(args.ctx);
  const base = parseRevisionToken(args.baseRevision);
  if (base === null) {
    throw new ActionContractError(
      "baseRevision is not a valid document revision token.",
      {
        errorCode: "INVALID_BASE_REVISION",
        statusCode: 400,
      },
    );
  }
  const normalizedEdits = args.edits.map(({ find, replace }) => ({
    find,
    replace,
  }));
  const payloadDigest = digest({
    documentId: args.documentId,
    baseRevision: args.baseRevision,
    edits: normalizedEdits,
  });

  try {
    return await db.transaction(async (transaction) => {
      const tx = transaction as unknown as Db;
      const [stored] = await tx
        .select()
        .from(schema.documentEditReceipts)
        .where(
          and(
            eq(schema.documentEditReceipts.documentId, args.documentId),
            eq(schema.documentEditReceipts.callerScope, scope),
            eq(schema.documentEditReceipts.idempotencyKey, args.idempotencyKey),
          ),
        );
      if (stored) {
        if (stored.payloadDigest !== payloadDigest) {
          conflict(
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key was already used for a different document edit.",
            { idempotencyKey: args.idempotencyKey },
          );
        }
        return replayResult(stored);
      }

      const [document] = await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, args.documentId));
      if (!document) {
        throw new ActionContractError("Document not found.", {
          errorCode: "DOCUMENT_NOT_FOUND",
          statusCode: 404,
        });
      }
      const beforeContent = document.content ?? "";
      const beforeHash = documentContentHash(beforeContent);
      if (
        document.bodyRevision !== base.revision ||
        beforeHash !== base.contentHash
      ) {
        conflict(
          "STALE_BASE_REVISION",
          "The document changed after it was read.",
          {
            expectedRevision: args.baseRevision,
            currentRevision: documentRevisionToken(
              document.bodyRevision,
              beforeContent,
            ),
            currentBodyRevision: document.bodyRevision,
            currentContentHash: beforeHash,
          },
        );
      }
      const resolved = resolveDocumentTextEdits(beforeContent, normalizedEdits);
      if (!resolved.ok) {
        conflict(
          resolved.error.kind === "missing"
            ? "EDIT_MATCH_MISSING"
            : resolved.error.kind === "ambiguous"
              ? "EDIT_MATCH_AMBIGUOUS"
              : "EDIT_RANGES_OVERLAP",
          "The complete edit batch could not be resolved against the base document.",
          { validation: resolved.error },
        );
      }

      const changed = resolved.content !== beforeContent;
      const afterRevision = changed
        ? document.bodyRevision + 1
        : document.bodyRevision;
      const afterHash = documentContentHash(resolved.content);
      const now = new Date().toISOString();
      const receiptId = crypto.randomUUID();
      if (changed) {
        const primaryBlocksFields = await lockPrimaryBlocksFields(
          tx,
          args.documentId,
        );
        await tx.insert(schema.documentVersions).values({
          id: crypto.randomUUID(),
          ownerEmail: document.ownerEmail,
          documentId: document.id,
          title: document.title,
          content: beforeContent,
          chatContext: serializeDocumentVersionChatContext(
            documentVersionChatContextFromAction(args.ctx),
          ),
          createdAt: now,
        });
        const updated = await tx
          .update(schema.documents)
          .set({
            content: resolved.content,
            bodyRevision: afterRevision,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.documents.id, document.id),
              eq(schema.documents.bodyRevision, document.bodyRevision),
              eq(schema.documents.content, beforeContent),
            ),
          )
          .returning({ bodyRevision: schema.documents.bodyRevision });
        if (updated.length !== 1) {
          conflict(
            "STALE_BASE_REVISION",
            "The document changed while the edit was committing.",
            {
              expectedRevision: args.baseRevision,
            },
          );
        }
        for (const field of primaryBlocksFields) {
          await persistBlocksFieldIdentity({
            db: tx,
            ownerEmail: field.ownerEmail,
            documentId: document.id,
            propertyId: field.propertyId,
            previousMarkdown: beforeContent,
            markdown: resolved.content,
            now,
          });
        }
      }
      const ranges = resolved.ranges.map((range, editIndex) => ({
        editIndex,
        start: range.start,
        end: range.end,
      }));
      const result: DocumentEditMutationResult = {
        applied: changed ? resolved.ranges.length : 0,
        total: normalizedEdits.length,
        receipt: {
          receiptId,
          outcome: changed ? "applied" : "unchanged",
          documentId: document.id,
          revisions: {
            before: documentRevisionToken(document.bodyRevision, beforeContent),
            after: documentRevisionToken(afterRevision, resolved.content),
          },
          bodyRevision: { before: document.bodyRevision, after: afterRevision },
          hashes: { before: beforeHash, after: afterHash },
          ranges,
          idempotency: {
            key: args.idempotencyKey,
            result: "applied",
            payloadDigest,
          },
          readback: { verified: true },
        },
      };
      await tx.insert(schema.documentEditReceipts).values({
        id: receiptId,
        ownerEmail: document.ownerEmail,
        orgId: document.orgId,
        documentId: document.id,
        callerScope: scope,
        idempotencyKey: args.idempotencyKey,
        payloadDigest,
        baseRevision: document.bodyRevision,
        resultRevision: afterRevision,
        beforeHash,
        afterHash,
        rangesJson: JSON.stringify(ranges),
        actorJson: JSON.stringify({
          caller: args.ctx.caller,
          userEmail: args.ctx.userEmail,
          orgId: args.ctx.orgId,
          networkProtocol: args.ctx.networkProtocol,
          networkId: args.ctx.networkId,
          networkPeer: args.ctx.networkPeer,
          runId: args.ctx.runId,
          threadId: args.ctx.threadId,
        }),
        resultJson: JSON.stringify(result),
        createdAt: now,
      });
      const [readback] = await tx
        .select({
          content: schema.documents.content,
          bodyRevision: schema.documents.bodyRevision,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, document.id));
      if (
        !readback ||
        readback.content !== resolved.content ||
        readback.bodyRevision !== afterRevision ||
        documentContentHash(readback.content) !== afterHash
      ) {
        throw new Error("Document edit readback verification failed.");
      }
      return result;
    });
  } catch (error) {
    // Concurrent duplicate deliveries may both miss the receipt before one
    // commits. Re-read after rollback so the loser returns the winner's durable
    // outcome instead of surfacing a false stale/unique-key failure.
    const [stored] = await db
      .select()
      .from(schema.documentEditReceipts)
      .where(
        and(
          eq(schema.documentEditReceipts.documentId, args.documentId),
          eq(schema.documentEditReceipts.callerScope, scope),
          eq(schema.documentEditReceipts.idempotencyKey, args.idempotencyKey),
        ),
      );
    if (!stored) throw error;
    if (stored.payloadDigest !== payloadDigest) {
      conflict(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for a different document edit.",
        { idempotencyKey: args.idempotencyKey },
      );
    }
    return replayResult(stored);
  }
}
