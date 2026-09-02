import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { agentTouchDocument } from "@agent-native/core/collab";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import {
  getGenerationCreativeContext,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  documentVersionChatContextFromAction,
  serializeDocumentVersionChatContext,
} from "../server/lib/document-version-context.js";
import { applyDocumentTextEdits } from "../shared/document-text-edits.js";
import { inspectNfmFidelity } from "../shared/nfm.js";
import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "./_blocks-field-identity.js";
import { mutateDocumentBody } from "./_document-edit-mutation.js";
import { editLinkedLocalDocumentThroughBrowser } from "./_linked-local-document-edit.js";

interface TextEdit {
  find: string;
  replace: string;
}

const reuseLabelSchema = z.object({
  itemId: z.string().min(1).optional(),
  itemVersionId: z.string().min(1).optional(),
  kind: z.string().min(1),
  label: z.string().min(1),
  dataRole: z.literal("untrusted-reference").default("untrusted-reference"),
  elementId: z.string().min(1).optional(),
  influence: z
    .enum(["reused", "adapted", "reference-conditioned", "generated"])
    .optional(),
});

const editDocumentSchema = z.object({
  id: z
    .string()
    .optional()
    .describe("Stable ID of the document to edit (required)."),
  baseRevision: z
    .string()
    .optional()
    .describe(
      "Opaque revision returned by get-document for the exact body being edited.",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Caller-generated stable key for one logical document edit."),
  find: z
    .string()
    .optional()
    .describe("Exact non-empty text to replace in single-edit mode."),
  replace: z
    .string()
    .optional()
    .describe(
      'Replacement text in single-edit mode; omit to delete the matched text (default: "").',
    ),
  edits: z
    .string()
    .optional()
    .describe(
      "JSON array of {find, replace} objects for a snapshot-stable batch; use instead of find/replace.",
    ),
  contextPackId: z
    .string()
    .optional()
    .describe("Exact Creative Context pack used for this edit."),
  contextModeOverride: z
    .literal("off")
    .optional()
    .describe(
      "Disable Creative Context for this edit only without changing the saved preference.",
    ),
  reuseLabels: z
    .array(reuseLabelSchema)
    .optional()
    .default([])
    .describe("Exact item versions that influenced this document edit."),
});

const externalEditDocumentSchema = editDocumentSchema.extend({
  id: z.string().min(1).describe("Stable ID of the document to edit."),
  baseRevision: z
    .string()
    .min(1)
    .describe(
      "Opaque revision returned by get-document for the exact body being edited.",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .describe("Caller-generated stable key for one logical document edit."),
});

export default defineAction({
  description:
    "Surgically edit an existing document's Markdown with exact search-and-replace operations. Prefer this over update-document when preserving the rest of the document; every find string must match exactly once in the immutable base. First call get-document, then pass its baseRevision and a caller-generated idempotencyKey.",
  deferLoading: false,
  mcpTool: true,
  agentInputSchema: externalEditDocumentSchema,
  schema: editDocumentSchema,
  http: false,
  run: async (args, ctx) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");

    // Only publish AI presence for genuine agent invocations (in-app tool loop,
    // sub-agents/A2A → "tool"; external MCP agents → "mcp"). A browser or
    // programmatic call must never light the "AI editing" flag.
    const isAgentCaller =
      ctx?.caller === "tool" || ctx?.caller === "mcp" || ctx?.caller === "a2a";

    let edits: TextEdit[];

    if (args.edits) {
      try {
        edits = JSON.parse(args.edits);
        if (!Array.isArray(edits))
          throw new Error("--edits must be a JSON array");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to parse JSON";
        throw new Error(`Invalid --edits JSON: ${message}`);
      }
    } else if (args.find !== undefined) {
      if (!args.find) throw new Error("--find cannot be empty");
      edits = [{ find: args.find, replace: args.replace ?? "" }];
    } else {
      throw new Error("Either --find or --edits is required");
    }

    for (const edit of edits) {
      if (!edit.find)
        throw new Error("Each edit must have a non-empty 'find' field");
      if (edit.replace === undefined) edit.replace = "";
    }

    const access = await assertAccess("document", id, "editor");
    const existing = access.resource;
    const isExternalCaller =
      ctx?.caller === "tool" ||
      ctx?.caller === "mcp" ||
      ctx?.caller === "webmcp" ||
      ctx?.caller === "a2a";
    if (isExternalCaller) {
      if (!args.baseRevision || !args.idempotencyKey) {
        throw new ActionContractError(
          "External document edits require baseRevision and idempotencyKey from get-document.",
          { errorCode: "DOCUMENT_EDIT_PROTOCOL_REQUIRED", statusCode: 400 },
        );
      }
      const isLinkedLocalSource =
        existing.sourceMode === "local-files" &&
        existing.sourceKind !== "folder" &&
        Boolean(existing.sourcePath) &&
        !id.startsWith("local-file:") &&
        !id.startsWith("local-folder:");
      if (isLinkedLocalSource) {
        throw new ActionContractError(
          "Revisioned external edits are unavailable for linked-local documents because the source-file write cannot share the SQL receipt transaction.",
          {
            errorCode: "LINKED_LOCAL_REVISION_PROTOCOL_UNAVAILABLE",
            statusCode: 409,
          },
        );
      }
      const result = await mutateDocumentBody({
        documentId: id,
        baseRevision: args.baseRevision,
        idempotencyKey: args.idempotencyKey,
        edits,
        ctx,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      try {
        agentTouchDocument(id, {
          edit: {
            descriptor: {
              kind: "text",
              quote: edits[0]?.replace.slice(0, 80) ?? "",
            },
            label: existing.title || undefined,
          },
        });
      } catch (error) {
        console.error("edit-document: agent presence publish failed", error);
      }
      return result;
    }

    // ─── Apply edits to the document markdown ───────────────────────────────
    //
    // Native documents edit canonical `documents.content`. A linked local file
    // instead commits through its exact live source bridge before SQL mirrors
    // the accepted bytes. The SQL change is delivered to open editors through
    // normal change-sync and parsed through the real editor pipeline so new
    // block structure renders correctly and merges through Yjs.
    //
    // (The old approach POSTed a Yjs search-replace to a localhost collab origin,
    // which silently no-oped on serverless — different process, no localhost —
    // and could only patch text inside existing nodes, never create structure.)
    const applied = applyDocumentTextEdits(existing.content ?? "", edits);
    let { content } = applied;
    const { results, changeCount } = applied;

    if (changeCount === 0) {
      return { applied: 0, total: edits.length, results };
    }

    let linkedLocalPersistence:
      | {
          status:
            | "persisted"
            | "source-persisted/readback-pending"
            | "source-persisted/history-pending";
          path: string;
          runtime: "browser" | "desktop";
        }
      | undefined;
    let linkedLocalHistoryReconciliation = false;
    let linkedLocalReconciliationDocument:
      | {
          title: string;
          description: string;
          parentId: string | null;
          icon: string | null;
          position: number;
          isFavorite: boolean;
          hideFromSearch: boolean;
          visibility: "private" | "org" | "public";
        }
      | undefined;

    const previousGeneration =
      args.contextModeOverride === "off"
        ? null
        : await getGenerationCreativeContext({
            appId: "content",
            artifactType: "document",
            artifactId: id,
          });
    let creativeContext:
      | {
          contextMode: "off" | "auto" | "pinned";
          contextPackId: string | null;
          reuseLabels: CreativeContextReuseLabel[];
          elementProvenance: Array<{
            elementId: string;
            influence:
              | "reused"
              | "adapted"
              | "reference-conditioned"
              | "generated";
            itemId?: string;
            itemVersionId?: string;
            label?: string;
          }>;
        }
      | undefined;
    if (
      previousGeneration ||
      args.contextPackId ||
      args.contextModeOverride ||
      args.reuseLabels.length
    ) {
      if (
        args.contextPackId !== undefined &&
        previousGeneration?.contextPackId &&
        args.contextPackId !== previousGeneration.contextPackId
      ) {
        throw new Error(
          "The document edit must preserve the document's creative-context pack",
        );
      }
      const requestedLabels: CreativeContextReuseLabel[] = args.reuseLabels
        .length
        ? args.reuseLabels
        : [
            {
              kind: "document",
              label: "Net-new document edit",
              dataRole: "untrusted-reference",
              elementId: id,
              influence: "generated",
            },
          ];
      const validated = await validateGenerationCreativeContext({
        contextPackId: args.contextPackId ?? previousGeneration?.contextPackId,
        contextPackSource:
          args.contextPackId === undefined ? "inherited" : "explicit",
        contextModeOverride: args.contextModeOverride,
        reuseLabels: requestedLabels,
        reuseLabelsSource: args.reuseLabels.length ? "explicit" : "inherited",
      });
      const elementProvenance = validated.reuseLabels.map((label) => ({
        elementId: id,
        influence: label.influence ?? ("reference-conditioned" as const),
        ...(label.itemId ? { itemId: label.itemId } : {}),
        ...(label.itemVersionId ? { itemVersionId: label.itemVersionId } : {}),
        label: label.label,
      }));
      const contextMode =
        validated.contextMode === "off"
          ? "off"
          : (previousGeneration?.contextMode ?? validated.contextMode);
      creativeContext = {
        contextMode,
        contextPackId: validated.contextPackId,
        reuseLabels: validated.reuseLabels,
        elementProvenance:
          contextMode === "off"
            ? elementProvenance
            : replaceCreativeContextElementProvenance(
                previousGeneration?.elementProvenance ?? [],
                elementProvenance,
              ),
      };
    }

    const isLinkedLocalSource =
      existing.sourceMode === "local-files" &&
      existing.sourceKind !== "folder" &&
      Boolean(existing.sourcePath) &&
      !id.startsWith("local-file:") &&
      !id.startsWith("local-folder:");
    if (isLinkedLocalSource) {
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) {
        return {
          applied: 0,
          total: edits.length,
          results,
          persistence: "unavailable",
          error:
            "No authenticated user is available for the local source write.",
        };
      }
      const receipt = await editLinkedLocalDocumentThroughBrowser({
        ownerEmail,
        documentId: id,
        expectedContent: existing.content ?? "",
        expectedTitle: existing.title,
        expectedDescription: existing.description ?? "",
        expectedMetadata: JSON.stringify({
          parentId: existing.parentId,
          icon: existing.icon,
          position: existing.position,
          isFavorite: Boolean(existing.isFavorite),
          hideFromSearch: Boolean(existing.hideFromSearch),
          visibility: existing.visibility,
        }),
        expectedResultContent: applied.content,
        edits,
      });
      if (receipt.status === "source-persisted/history-pending") {
        linkedLocalHistoryReconciliation = true;
        linkedLocalReconciliationDocument = {
          title: receipt.title,
          description: receipt.description,
          ...receipt.metadata,
          visibility: existing.visibility,
        };
      }
      if (
        receipt.status !== "persisted" &&
        receipt.status !== "source-persisted/history-pending" &&
        receipt.status !== "source-persisted/readback-pending"
      ) {
        return {
          applied: 0,
          total: edits.length,
          results,
          persistence: receipt.status,
          error: receipt.error,
        };
      }
      content = receipt.content;
      linkedLocalPersistence = {
        status: receipt.status,
        path: receipt.path,
        runtime: receipt.runtime,
      };
    }

    // Persist. The fresh updatedAt is the signal the open editor uses to tell an
    // intentional external edit apart from a stale autosave echo.
    const db = getDb();
    const now = new Date().toISOString();
    try {
      await db.transaction(async (tx: any) => {
        const primaryBlocksFields = await lockPrimaryBlocksFields(tx, id);
        if (isAgentCaller) {
          await tx.insert(schema.documentVersions).values({
            id: crypto.randomUUID(),
            ownerEmail: existing.ownerEmail as string,
            documentId: id,
            title: existing.title,
            content: existing.content ?? "",
            chatContext: serializeDocumentVersionChatContext(
              documentVersionChatContextFromAction(ctx),
            ),
            createdAt: now,
          });
        }
        const mirrored = await tx
          .update(schema.documents)
          .set({
            content,
            bodyRevision: existing.bodyRevision + 1,
            updatedAt: now,
            ...(linkedLocalReconciliationDocument ?? {}),
          })
          .where(
            and(
              eq(schema.documents.id, id),
              eq(schema.documents.updatedAt, existing.updatedAt),
            ),
          )
          .returning({ id: schema.documents.id });
        if (mirrored.length !== 1) {
          throw new Error(
            "The document changed before Content history could be updated.",
          );
        }
        for (const field of primaryBlocksFields) {
          await persistBlocksFieldIdentity({
            db: tx as unknown as ReturnType<typeof getDb>,
            ownerEmail: field.ownerEmail,
            documentId: id,
            propertyId: field.propertyId,
            previousMarkdown: existing.content ?? "",
            markdown: content,
            now,
          });
        }
        if (creativeContext) {
          await recordGenerationCreativeContext(
            {
              appId: "content",
              artifactType: "document",
              artifactId: id,
              ...creativeContext,
            },
            { db: tx },
          );
        }
      });
    } catch (error) {
      if (!linkedLocalPersistence) throw error;
      return {
        applied: changeCount,
        total: edits.length,
        results,
        persistence: "source-persisted/history-pending",
        path: linkedLocalPersistence.path,
        error:
          error instanceof Error
            ? error.message
            : "The local file changed, but Content history was not updated.",
      };
    }

    if (linkedLocalHistoryReconciliation) {
      return {
        applied: 0,
        total: edits.length,
        results,
        persistence: "source-persisted/history-reconciled",
        path: linkedLocalPersistence?.path,
        error:
          "The source changed during verification. Content history was reconciled to the physical file, but the requested agent edit was not confirmed.",
      };
    }

    // Presence is metadata only. Canonical SQL and change-sync are the sole
    // body-delivery path; this action must never independently mutate Yjs.
    if (isAgentCaller) {
      try {
        const firstChange = edits.find((edit) => edit.replace)?.replace;
        agentTouchDocument(id, {
          edit: {
            descriptor: {
              kind: "text",
              quote: (firstChange ?? edits[0]?.find ?? "").slice(0, 80),
            },
            label: existing.title || undefined,
          },
        });
      } catch (error) {
        console.error("edit-document: agent presence publish failed", error);
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      applied: changeCount,
      total: edits.length,
      results,
      ...(linkedLocalPersistence
        ? {
            persistence: linkedLocalPersistence.status,
            path: linkedLocalPersistence.path,
            runtime: linkedLocalPersistence.runtime,
          }
        : {}),
      contentFidelity: inspectNfmFidelity(content),
      ...(creativeContext
        ? {
            contextMode: creativeContext.contextMode,
            contextPackId: creativeContext.contextPackId,
            reuseLabels: creativeContext.reuseLabels,
          }
        : {}),
    };
  },
});
