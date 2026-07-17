import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import {
  agentTouchDocument,
  hasCollabState,
  searchAndReplace,
} from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import {
  getGenerationCreativeContext,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  appendContentWorkflowEvent,
  contentWorkflowFingerprint,
  wakeContentWorkflowEvent,
} from "./_content-workflow.js";

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

export default defineAction({
  description:
    "Surgically edit document content using search-and-replace. Preferred over update-document for modifications.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
    find: z.string().optional().describe("Text to find (single edit mode)"),
    replace: z
      .string()
      .optional()
      .describe('Replacement text (single edit mode, default: "")'),
    edits: z
      .string()
      .optional()
      .describe("JSON array of {find, replace} objects (batch mode)"),
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
  }),
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

    // ─── Apply edits to the document markdown ───────────────────────────────
    //
    // The agent edits the canonical `documents.content` (markdown is the source
    // of truth). The change is delivered live to any open editor through the
    // framework's normal change-sync: the action bump refetches `get-document`,
    // and the editor reconciles the newer content into the live Y.Doc — parsing
    // the markdown through the real editor pipeline so new block structure
    // (lists, headings, tables) renders correctly and merges with any
    // concurrent human edits via the Yjs CRDT. See the `real-time-collab` skill.
    //
    // (The old approach POSTed a Yjs search-replace to a localhost collab origin,
    // which silently no-oped on serverless — different process, no localhost —
    // and could only patch text inside existing nodes, never create structure.)
    let content: string = existing.content ?? "";
    const results: string[] = [];
    let changeCount = 0;
    const appliedEdits: TextEdit[] = [];

    for (const edit of edits) {
      const idx = content.indexOf(edit.find);
      if (idx === -1) {
        results.push(
          `NOT FOUND: "${edit.find.slice(0, 60)}${edit.find.length > 60 ? "..." : ""}"`,
        );
        continue;
      }
      content =
        content.slice(0, idx) +
        edit.replace +
        content.slice(idx + edit.find.length);
      changeCount++;
      appliedEdits.push(edit);
      const action = edit.replace === "" ? "deleted" : "replaced";
      results.push(
        `${action}: "${edit.find.slice(0, 40)}${edit.find.length > 40 ? "..." : ""}"`,
      );
    }

    if (changeCount === 0) {
      return { applied: 0, total: edits.length, results };
    }

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

    // Persist. The fresh updatedAt is the signal the open editor uses to tell an
    // intentional external edit apart from a stale autosave echo.
    const db = getDb();
    const now = new Date().toISOString();
    let workflowEventId = "";
    await db.transaction(async (tx: any) => {
      await tx
        .update(schema.documents)
        .set({ content, updatedAt: now })
        .where(eq(schema.documents.id, id));
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
      workflowEventId = await appendContentWorkflowEvent(tx, {
        topic: "content.document.changed",
        subjectType: "document",
        subjectId: id,
        documentId: id,
        ownerEmail: existing.ownerEmail as string,
        orgId: (existing.orgId as string | null | undefined) ?? null,
        occurredAt: now,
        actionContext: ctx,
        payload: {
          changeKind: "surgical_edit",
          changedFields: ["content"],
          before: { contentHash: contentWorkflowFingerprint(existing.content) },
          after: { contentHash: contentWorkflowFingerprint(content) },
          editCount: changeCount,
        },
      });
    });
    wakeContentWorkflowEvent(workflowEventId);

    // Make the agent edit VISIBLE as a live collaborator. Content's collab doc
    // binds the TipTap Y.XmlFragment("default"), so a live editing session is
    // patched surgically through `searchAndReplace` (which also auto-publishes
    // agent presence + a lingering recent-edit highlight on the changed text).
    // When no collab session exists (no editor open, XmlFragment unseeded) the
    // SQL write above is authoritative and reconciles on next open; we still
    // touch agent presence best-effort so a viewer who opens the doc mid-linger
    // sees the AI flag. All of this is wrapped so presence never fails the edit.
    if (isAgentCaller) {
      try {
        if (await hasCollabState(id)) {
          for (const edit of appliedEdits) {
            await searchAndReplace(id, edit.find, edit.replace, "agent");
          }
        } else {
          const firstChange = appliedEdits.find((e) => e.replace)?.replace;
          agentTouchDocument(id, {
            edit: {
              descriptor: {
                kind: "text",
                quote: (firstChange ?? appliedEdits[0]?.find ?? "").slice(
                  0,
                  80,
                ),
              },
              label: existing.title || undefined,
            },
          });
        }
      } catch (error) {
        console.error("edit-document: agent presence publish failed", error);
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      applied: changeCount,
      total: edits.length,
      results,
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
