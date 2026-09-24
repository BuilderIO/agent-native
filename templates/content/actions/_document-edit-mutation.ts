import { createHash } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { assertAccess } from "@agent-native/core/sharing";
import { recordGenerationCreativeContext } from "@agent-native/creative-context/server";
import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  documentEditAttribution,
  requireDocumentRequestActor,
} from "../server/lib/document-attribution.js";
import {
  findDocumentBodyBase,
  preserveDocumentBodyIntent,
  readDocumentBodyIntents,
  recordDocumentBodyIntent,
} from "../server/lib/document-body-intents.js";
import { recordDocumentHistoryTransition } from "../server/lib/document-history.js";
import { nextDocumentUpdatedAt } from "../server/lib/document-updated-at.js";
import { mergeDocumentBodyIntents } from "../shared/document-intent-merge.js";
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

export function parseDocumentRevisionToken(
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

function validateDocumentEditSnapshot(
  document: typeof schema.documents.$inferSelect | undefined,
  base: { revision: number; contentHash: string },
  baseRevision: string,
  edits: DocumentTextEdit[] | undefined,
  initializeContent?: string,
  baseContent?: string,
) {
  if (!document) {
    throw new ActionContractError("Document not found.", {
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
  }
  const beforeContent = baseContent ?? document.content ?? "";
  const beforeHash = documentContentHash(beforeContent);
  if (
    (baseContent === undefined && document.bodyRevision !== base.revision) ||
    beforeHash !== base.contentHash
  ) {
    conflict("STALE_BASE_REVISION", "The document changed after it was read.", {
      expectedRevision: baseRevision,
      currentRevision: documentRevisionToken(
        document.bodyRevision,
        beforeContent,
      ),
      currentBodyRevision: document.bodyRevision,
      currentContentHash: beforeHash,
    });
  }
  const resolved = edits
    ? resolveDocumentTextEdits(beforeContent, edits)
    : beforeContent === ""
      ? {
          ok: true as const,
          content: initializeContent as string,
          ranges: [{ start: 0, end: 0 }],
        }
      : conflict(
          "DOCUMENT_BODY_NOT_EMPTY",
          "Document initialization requires a literally empty body.",
          { currentRevision: baseRevision },
        );
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
  return { document, beforeContent, beforeHash, resolved };
}

function callerScope(ctx: ActionRunContext): string {
  if (!ctx.userEmail) {
    throw new ActionContractError(
      "External document edits require an authenticated caller scope.",
      { errorCode: "CALLER_SCOPE_REQUIRED", statusCode: 401 },
    );
  }
  // The surface and authenticated authority are durable retry identity.
  // Network request/run/peer IDs describe one delivery attempt and therefore
  // must not split identical retries into separate receipt scopes.
  const organization = ctx.orgId ? `:org:${ctx.orgId}` : "";
  return `${ctx.caller}:user:${ctx.userEmail.toLowerCase()}${organization}`;
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
  preservationRequired?: {
    reason: "structure" | "provenance";
    checkpointId: string;
  };
  receipt: {
    receiptId: string;
    outcome:
      | "applied"
      | "unchanged"
      | "displaced-preserved"
      | "preservation-required";
    displacedCheckpointId?: string;
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

export interface DocumentEditCreativeContext {
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  reuseLabels: CreativeContextReuseLabel[];
  elementProvenance: Array<{
    elementId: string;
    influence: "reused" | "adapted" | "reference-conditioned" | "generated";
    itemId?: string;
    itemVersionId?: string;
    label?: string;
  }>;
}

type DocumentBodyMutation =
  | { edits: DocumentTextEdit[]; initializeContent?: never }
  | { edits?: never; initializeContent: string };

export async function mutateDocumentBody(
  args: {
    documentId: string;
    baseRevision: string;
    idempotencyKey: string;
    creativeContext?: DocumentEditCreativeContext;
    creativeContextDigest?: unknown;
    resolveCreativeContext?: () => Promise<
      DocumentEditCreativeContext | undefined
    >;
    ctx: ActionRunContext;
    db?: Db;
  } & DocumentBodyMutation,
): Promise<DocumentEditMutationResult> {
  const db = args.db ?? getDb();
  const scope = callerScope(args.ctx);
  const actor = requireDocumentRequestActor(args.ctx);
  const base = parseDocumentRevisionToken(args.baseRevision);
  if (base === null) {
    throw new ActionContractError(
      "baseRevision is not a valid document revision token.",
      {
        errorCode: "INVALID_BASE_REVISION",
        statusCode: 400,
      },
    );
  }
  const normalizedEdits = args.edits?.map(({ find, replace }) => ({
    find,
    replace,
  }));
  const initializationContent = args.initializeContent;
  if (!normalizedEdits && initializationContent === undefined) {
    throw new ActionContractError("A document body mutation is required.", {
      errorCode: "DOCUMENT_EDIT_MODE_REQUIRED",
      statusCode: 400,
    });
  }
  if (
    initializationContent !== undefined &&
    initializationContent.trim().length === 0
  ) {
    throw new ActionContractError(
      "initializeContent must contain non-whitespace content.",
      {
        errorCode: "DOCUMENT_INITIALIZATION_CONTENT_REQUIRED",
        statusCode: 400,
      },
    );
  }
  const payloadDigest = digest(
    normalizedEdits
      ? {
          documentId: args.documentId,
          baseRevision: args.baseRevision,
          edits: normalizedEdits,
          creativeContext:
            args.creativeContextDigest ?? args.creativeContext ?? null,
        }
      : {
          documentId: args.documentId,
          baseRevision: args.baseRevision,
          operation: "initialize",
          initializeContent: initializationContent,
          creativeContext:
            args.creativeContextDigest ?? args.creativeContext ?? null,
        },
  );

  const readReplay = async (client: Db) => {
    const [stored] = await client
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
    return null;
  };

  try {
    await assertAccess("document", args.documentId, "editor", {
      userEmail: args.ctx.userEmail,
      orgId: args.ctx.orgId ?? undefined,
    });
    const previous = await readReplay(db);
    if (previous) return previous;
    const [preflightDocument] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, args.documentId));
    const preflightBaseContent =
      preflightDocument?.bodyRevision === base.revision &&
      documentContentHash(preflightDocument.content ?? "") === base.contentHash
        ? (preflightDocument.content ?? "")
        : preflightDocument
          ? await findDocumentBodyBase({
              db,
              ownerEmail: preflightDocument.ownerEmail,
              documentId: args.documentId,
              contentHash: base.contentHash,
              revision: base.revision,
            })
          : null;
    if (preflightBaseContent === null) {
      conflict("STALE_BASE_REVISION", "The exact edit base is unavailable.", {
        expectedRevision: args.baseRevision,
        currentRevision: preflightDocument
          ? documentRevisionToken(
              preflightDocument.bodyRevision,
              preflightDocument.content,
            )
          : undefined,
      });
    }
    validateDocumentEditSnapshot(
      preflightDocument,
      base,
      args.baseRevision,
      normalizedEdits,
      initializationContent,
      preflightBaseContent,
    );
    const creativeContext = args.resolveCreativeContext
      ? await args.resolveCreativeContext()
      : args.creativeContext;
    return await db.transaction(async (transaction) => {
      const tx = transaction as unknown as Db;
      const concurrent = await readReplay(tx);
      if (concurrent) return concurrent;

      await assertAccess("document", args.documentId, "editor", {
        userEmail: args.ctx.userEmail,
        orgId: args.ctx.orgId ?? undefined,
        transaction: getDbExec(),
      });

      const [document] = await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, args.documentId));
      const baseContent =
        document?.bodyRevision === base.revision &&
        documentContentHash(document.content ?? "") === base.contentHash
          ? (document.content ?? "")
          : document
            ? await findDocumentBodyBase({
                db: tx,
                ownerEmail: document.ownerEmail,
                documentId: args.documentId,
                contentHash: base.contentHash,
                revision: base.revision,
              })
            : null;
      if (baseContent === null) {
        conflict("STALE_BASE_REVISION", "The exact edit base is unavailable.", {
          expectedRevision: args.baseRevision,
        });
      }
      const validated = validateDocumentEditSnapshot(
        document,
        base,
        args.baseRevision,
        normalizedEdits,
        initializationContent,
        baseContent,
      );
      const { resolved } = validated;

      if (
        initializationContent !== undefined &&
        document.bodyRevision !== base.revision
      ) {
        conflict(
          "DOCUMENT_BODY_NOT_EMPTY",
          "Document initialization requires the current body to be empty.",
          {
            currentRevision: documentRevisionToken(
              document.bodyRevision,
              document.content,
            ),
          },
        );
      }

      const intent = {
        writerId: `${scope}:edit-document`,
        operationId: args.idempotencyKey,
        authoredBaseRevision: base.revision,
      };
      const priorIntents = await readDocumentBodyIntents({
        db: tx,
        ownerEmail: document.ownerEmail,
        documentId: document.id,
        afterRevision: base.revision,
        throughRevision: document.bodyRevision,
      });
      const merged = mergeDocumentBodyIntents({
        authoredBaseContent: baseContent,
        authoredCandidateContent: resolved.content,
        currentContent: document.content,
        currentRevision: document.bodyRevision,
        incoming: intent,
        priorIntents,
      });
      const now = nextDocumentUpdatedAt(document.updatedAt);
      const receiptId = crypto.randomUUID();
      if (merged.status === "preservation-required") {
        const checkpointId = await preserveDocumentBodyIntent({
          db: tx,
          ownerEmail: document.ownerEmail,
          documentId: document.id,
          title: document.title,
          candidateContent: resolved.content,
          actorEmail: args.ctx.userEmail ?? null,
          origin: args.ctx.caller,
          operation: "edit-document-preservation",
          now,
        });
        const result: DocumentEditMutationResult = {
          applied: 0,
          total: normalizedEdits?.length ?? 1,
          preservationRequired: { reason: merged.reason, checkpointId },
          receipt: {
            receiptId,
            outcome: "preservation-required",
            documentId: document.id,
            revisions: {
              before: documentRevisionToken(
                document.bodyRevision,
                document.content,
              ),
              after: documentRevisionToken(
                document.bodyRevision,
                document.content,
              ),
            },
            bodyRevision: {
              before: document.bodyRevision,
              after: document.bodyRevision,
            },
            hashes: {
              before: documentContentHash(document.content),
              after: documentContentHash(document.content),
            },
            ranges: [],
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
          baseRevision: base.revision,
          resultRevision: document.bodyRevision,
          beforeHash: documentContentHash(document.content),
          afterHash: documentContentHash(document.content),
          rangesJson: "[]",
          actorJson: JSON.stringify({
            caller: args.ctx.caller,
            userEmail: args.ctx.userEmail,
          }),
          resultJson: JSON.stringify(result),
          createdAt: now,
        });
        return result;
      }

      const changed = merged.content !== document.content;
      const afterRevision = changed
        ? document.bodyRevision + 1
        : document.bodyRevision;
      const afterHash = documentContentHash(merged.content);
      if (changed) {
        const primaryBlocksFields = await lockPrimaryBlocksFields(
          tx,
          args.documentId,
        );
        const updated = await tx
          .update(schema.documents)
          .set({
            content: merged.content,
            bodyRevision: afterRevision,
            ...documentEditAttribution(actor),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.documents.id, document.id),
              eq(schema.documents.bodyRevision, document.bodyRevision),
              eq(schema.documents.content, document.content),
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
            previousMarkdown: document.content,
            markdown: merged.content,
            now,
          });
        }
        await recordDocumentHistoryTransition({
          db: tx,
          ownerEmail: document.ownerEmail,
          documentId: document.id,
          before: { title: document.title, content: document.content },
          after: { title: document.title, content: merged.content },
          beforeBodyRevision: document.bodyRevision,
          afterBodyRevision: afterRevision,
          cause: { ctx: args.ctx, operation: "edit-document" },
          now,
        });
        if (creativeContext) {
          await recordGenerationCreativeContext(
            {
              appId: "content",
              artifactType: "document",
              artifactId: document.id,
              ...creativeContext,
            },
            { db: tx },
          );
        }
      }
      const displacedCheckpointId = merged.displaced
        ? await preserveDocumentBodyIntent({
            db: tx,
            ownerEmail: document.ownerEmail,
            documentId: document.id,
            title: document.title,
            candidateContent: resolved.content,
            actorEmail: args.ctx.userEmail ?? null,
            origin: args.ctx.caller,
            operation: "edit-document-displaced",
            now,
          })
        : undefined;
      await recordDocumentBodyIntent({
        db: tx,
        ownerEmail: document.ownerEmail,
        orgId: document.orgId ?? "",
        documentId: document.id,
        intent,
        candidateHash: documentContentHash(resolved.content),
        committedRevision: afterRevision,
        changedBlockIndexes: merged.changedBlockIndexes,
        canonicalChanged: changed,
        displacedCheckpointId,
        now,
      });
      const ranges = resolved.ranges.map((range, editIndex) => ({
        editIndex,
        start: range.start,
        end: range.end,
      }));
      const result: DocumentEditMutationResult = {
        applied: changed ? resolved.ranges.length : 0,
        total: normalizedEdits?.length ?? 1,
        receipt: {
          receiptId,
          outcome: merged.displaced
            ? "displaced-preserved"
            : changed
              ? "applied"
              : "unchanged",
          ...(displacedCheckpointId ? { displacedCheckpointId } : {}),
          documentId: document.id,
          revisions: {
            before: documentRevisionToken(
              document.bodyRevision,
              document.content,
            ),
            after: documentRevisionToken(afterRevision, merged.content),
          },
          bodyRevision: { before: document.bodyRevision, after: afterRevision },
          hashes: {
            before: documentContentHash(document.content),
            after: afterHash,
          },
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
        baseRevision: base.revision,
        resultRevision: afterRevision,
        beforeHash: documentContentHash(document.content),
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
        readback.content !== merged.content ||
        readback.bodyRevision !== afterRevision ||
        documentContentHash(readback.content) !== afterHash
      ) {
        conflict(
          "STALE_BASE_REVISION",
          "The document changed while the edit was being verified.",
          { expectedRevision: args.baseRevision },
        );
      }
      return result;
    });
  } catch (error) {
    // Concurrent duplicate deliveries may both miss the receipt before one
    // commits. Re-read after rollback so the loser returns the winner's durable
    // outcome instead of surfacing a false stale/unique-key failure.
    const replay = await readReplay(db);
    if (!replay) throw error;
    await assertAccess("document", args.documentId, "editor", {
      userEmail: args.ctx.userEmail,
      orgId: args.ctx.orgId ?? undefined,
    });
    return replay;
  }
}
