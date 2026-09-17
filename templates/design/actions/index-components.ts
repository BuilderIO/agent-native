/**
 * index-components — read action.
 *
 * Scans the design's HTML for `data-agent-native-component` annotations and
 * returns the component list plus detected instances.
 *
 * **Inline / Alpine tier:**  parses the design HTML directly using the
 * code-layer projection.  Writes discovered component definitions into the
 * `component_index` table so subsequent reads (get-component-details) can
 * resolve persisted metadata.
 *
 * **Real-app tier (localhost / fusion):**  `indexComponents` capability is
 * required.  When the source does not yet advertise it, the action returns an
 * empty list with a `ctaRequired: true` flag and a human-readable `ctaMessage`
 * prompting the user to Connect Builder (see DESIGN-STUDIO-PLAN.md §6.1).
 */

import { defineAction } from "@agent-native/core/action";
import { getText, hasCollabState } from "@agent-native/core/collab";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  SourceWorkspaceEditConflictError,
  withSourceFileWriteLock,
} from "../server/source-workspace.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  componentIndexId,
  detectInstances,
  buildDefinitions,
  type ComponentDefinition,
  type ComponentInstance,
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  let hasState: boolean;
  try {
    hasState = await hasCollabState(fileId);
  } catch {
    throw new SourceWorkspaceEditConflictError(
      "Could not verify a source file's live version. Re-read the design and retry.",
    );
  }
  if (!hasState) return storedContent;
  try {
    const live = await getText(fileId, "content");
    if (typeof live === "string") return live;
  } catch {
    throw new SourceWorkspaceEditConflictError(
      "Could not verify a source file's live version. Re-read the design and retry.",
    );
  }
  throw new SourceWorkspaceEditConflictError(
    "Could not verify a source file's live version. Re-read the design and retry.",
  );
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Scan the design's HTML for component annotations " +
    "(`data-agent-native-component`) and return the component list plus " +
    "detected instances. For inline/Alpine designs, parses the HTML directly " +
    "and persists the discovered components into component_index. For real-app " +
    "sources (localhost / fusion), the indexComponents capability must be " +
    "available; if not, returns an empty list with ctaRequired=true and a " +
    "message prompting the user to Connect Builder (free tier available).",
  schema: z.object({
    designId: z.string().describe("Design project ID to index components for"),
    fileId: z
      .string()
      .optional()
      .describe(
        "Specific design file id. Defaults to the primary index.html when omitted.",
      ),
  }),
  readOnly: false,
  http: { method: "POST" },
  run: async ({ designId, fileId }) => {
    const db = getDb();

    // ── Access check ────────────────────────────────────────────────────────
    // This action writes component_index rows — require editor access.
    const access = await assertAccess("design", designId, "editor");

    // ── Source type + capability check ──────────────────────────────────────
    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    const caps = resolveSourceCapabilities(sourceType);

    // Real-app sources gate on `indexComponents`.  For inline designs this
    // capability is `unavailable` by default (the plan marks it as a real-app
    // feature for deep TS/cva parse) but the *annotation scan* still works
    // from the DOM — we always run it.  The flag tells callers whether the
    // full real-app index is live or whether they see only annotations.
    const hasFullIndex = hasCapability(caps, "indexComponents");
    const ctaRequired =
      sourceType !== "inline" && !hasCapability(caps, "indexComponents");

    if (ctaRequired) {
      return {
        designId,
        sourceType,
        ctaRequired: true,
        ctaMessage:
          "Full component indexing (prop types, cva variants, Storybook " +
          "stories, jump-to-source) requires a connected Builder app. " +
          "Connect Builder (free tier available) via the Make it real CTA to unlock this feature.",
        components: [] as ComponentDefinition[],
        instances: [] as ComponentInstance[],
        totalComponents: 0,
        totalInstances: 0,
      };
    }

    // Resolve the lock target without holding a database lock. The source-file
    // lock must be acquired before the transaction so index and write paths
    // enter Yjs and SQL in the same order.
    const conditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designFiles.designId, designId),
      fileId
        ? eq(schema.designFiles.id, fileId)
        : eq(schema.designFiles.filename, "index.html"),
    ];
    const [candidate] = await db
      .select({ id: schema.designFiles.id })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);
    if (!candidate) throw new Error("Design HTML file not found.");

    const result = await withSourceFileWriteLock(candidate.id, async () => {
      const [file] = await db
        .select({
          id: schema.designFiles.id,
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          content: schema.designFiles.content,
        })
        .from(schema.designFiles)
        .innerJoin(
          schema.designs,
          eq(schema.designFiles.designId, schema.designs.id),
        )
        .where(and(...conditions))
        .limit(1);

      if (!file) throw new Error("Design HTML file not found.");
      const html = await liveContent(file.id, file.content ?? "");

      return db.transaction(async (tx) => {
        await (
          tx as unknown as {
            execute: (query: unknown) => Promise<unknown>;
          }
        ).execute(sql`LOCK TABLE design_files IN SHARE ROW EXCLUSIVE MODE`);
        await (
          tx as unknown as {
            execute: (query: unknown) => Promise<unknown>;
          }
        ).execute(sql`LOCK TABLE component_index IN SHARE ROW EXCLUSIVE MODE`);

        // Re-read after the live snapshot so a concurrent SQL write fails
        // closed instead of indexing a stale source.
        const [lockedFile] = await tx
          .select({
            id: schema.designFiles.id,
            designId: schema.designFiles.designId,
            filename: schema.designFiles.filename,
            content: schema.designFiles.content,
          })
          .from(schema.designFiles)
          .innerJoin(
            schema.designs,
            eq(schema.designFiles.designId, schema.designs.id),
          )
          .where(and(...conditions))
          .limit(1);

        if (!lockedFile || lockedFile.content !== file.content) {
          throw new SourceWorkspaceEditConflictError(
            "The source file changed while its live version was being read. Re-read the design and retry.",
          );
        }

        // ── Projection + detection ─────────────────────────────────────────────
        const codeLayerSource: CodeLayerSource = {
          kind: "design-file",
          designId: lockedFile.designId,
          fileId: lockedFile.id,
          filename: lockedFile.filename,
        };

        const projection = buildCodeLayerProjection(html, {
          source: codeLayerSource,
        });

        const instances = detectInstances(projection.nodes);
        const definitions = buildDefinitions(instances);

        // ── Persist discovered components ──────────────────────────────────────
        // Write each distinct component name into component_index so that
        // get-component-details can resolve metadata by node id.
        const now = new Date().toISOString();
        // Derive the owner from the request user, falling back to the design's
        // owner. Never stamp an empty-string owner (an unowned row): require a real
        // owner before writing a new component_index row.
        const designOwner = (access.resource as { ownerEmail?: unknown })
          .ownerEmail;
        const ownerEmail =
          getRequestUserEmail() ??
          (typeof designOwner === "string" && designOwner ? designOwner : null);
        if (!ownerEmail) throw new Error("no authenticated user");

        for (const def of definitions) {
          const id = componentIndexId(designId, def.name);
          const existing = await tx
            .select({ id: schema.componentIndex.id })
            .from(schema.componentIndex)
            .where(eq(schema.componentIndex.id, id))
            .limit(1);

          if (existing.length === 0) {
            await tx.insert(schema.componentIndex).values({
              id,
              designId,
              name: def.name,
              runtimeSelectors: JSON.stringify(
                def.instanceNodeIds.map(
                  (nodeId) => `[data-agent-native-node-id="${nodeId}"]`,
                ),
              ),
              ownerEmail,
              createdAt: now,
              updatedAt: now,
            });
          } else {
            await tx
              .update(schema.componentIndex)
              .set({
                runtimeSelectors: JSON.stringify(
                  def.instanceNodeIds.map(
                    (nodeId) => `[data-agent-native-node-id="${nodeId}"]`,
                  ),
                ),
                updatedAt: now,
              })
              .where(eq(schema.componentIndex.id, id));
          }
        }

        // Annotate instances with their component_index id.
        const indexMap = new Map(
          definitions.map((def) => [
            def.name,
            componentIndexId(designId, def.name),
          ]),
        );
        const annotatedInstances = instances.map((inst) => ({
          ...inst,
          componentIndexId: indexMap.get(inst.name),
        }));

        return {
          designId,
          sourceType,
          ctaRequired: false,
          hasFullIndex,
          components: definitions,
          instances: annotatedInstances,
          totalComponents: definitions.length,
          totalInstances: instances.length,
          note:
            sourceType === "inline"
              ? "Showing annotated Alpine components from data-agent-native-component attributes. Connect Builder (free tier available) for full TS prop types and cva variants."
              : undefined,
        };
      });
    });

    return result;
  },
});
