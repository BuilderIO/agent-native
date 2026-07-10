/**
 * get-component-details — read action.
 *
 * For a selected component instance, returns the component name, source file
 * (via resolveNodeToFile when the capability is available), props / variants,
 * and the persistent component_index row when one exists.
 *
 * Works across both tiers:
 * - **Alpine / inline** — returns name + observed props from attributes, plus
 *   a CTA flag for features that require a real-app source.
 * - **Real app (localhost / fusion)** — returns the full component_index row
 *   including parsed TS prop types, cva variants, Storybook stories, and the
 *   source file path.  The `resolveNodeToFile` capability unlocks the source
 *   deep-link returned in `sourceLocation`.
 */

import { defineAction } from "@agent-native/core";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  componentNameFor,
  componentNodeIdMatches,
  extractProps,
  type ComponentInstance,
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Return details for a selected component instance: component name, " +
    "source file (when resolveNodeToFile capability is available), props, " +
    "variants, and the persisted component_index row. " +
    "Provide the design id and node id (data-agent-native-node-id) of the " +
    "selected component root. For Alpine designs the response includes " +
    "lightweight attribute-based props and a CTA flag for full prop controls.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe(
        "The data-agent-native-node-id of the selected component instance root element.",
      ),
    fileId: z
      .string()
      .optional()
      .describe("Design file id. Defaults to index.html."),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, nodeId, fileId }) => {
    const db = getDb();

    // ── Access check ────────────────────────────────────────────────────────
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    // ── Source type + capabilities ───────────────────────────────────────────
    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    const caps = resolveSourceCapabilities(sourceType);
    const canResolveToFile = hasCapability(caps, "resolveNodeToFile");
    const hasFullIndex = hasCapability(caps, "indexComponents");
    const canEditProps =
      sourceType === "inline" || hasCapability(caps, "applyEdit");
    const ctaRequired = !hasFullIndex || !canEditProps;
    const ctaMessage = !hasFullIndex
      ? "Full prop controls (TypeScript prop types, cva variants, Storybook stories) require a connected Builder app. Connect Builder to unlock."
      : !canEditProps
        ? "Prop write-back requires the bridge applyEdit capability. Preview controls remain available until source write hardening is enabled."
        : undefined;

    // ── Fetch design file ────────────────────────────────────────────────────
    const conditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designFiles.designId, designId),
      fileId
        ? eq(schema.designFiles.id, fileId)
        : eq(schema.designFiles.filename, "index.html"),
    ];

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

    // Use the durable SQL source for component prop reads. A connected editor
    // can briefly hold an older Yjs text snapshot while server-side prop writes
    // have already updated SQL; preferring collab here makes the inspector
    // rehydrate stale props even though the canvas renders the saved source.
    const html = file.content ?? "";

    // ── Projection lookup ────────────────────────────────────────────────────
    const codeLayerSource: CodeLayerSource = {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };

    const projection = buildCodeLayerProjection(html, {
      source: codeLayerSource,
    });

    const node = projection.nodes.find((n) =>
      componentNodeIdMatches(n, nodeId),
    );
    if (!node) {
      throw new Error(
        `Node "${nodeId}" not found in projection. Run get-code-layer-projection to list current node ids.`,
      );
    }

    const name = componentNameFor(node);
    if (!name) {
      throw new Error(
        `Node "${nodeId}" does not carry a data-agent-native-component attribute and is not a component root.`,
      );
    }

    // ── Simple props from attributes ─────────────────────────────────────────
    const observedProps = extractProps(node);
    const alpineData =
      typeof node.attributes["x-data"] === "string"
        ? node.attributes["x-data"]
        : undefined;

    const instance: ComponentInstance = {
      instanceId: node.id,
      name,
      props: observedProps,
      alpineData,
      selector: node.selector,
      nodeId,
    };

    // ── Lookup persisted component_index row ─────────────────────────────────
    const [indexRow] = await db
      .select()
      .from(schema.componentIndex)
      .where(
        and(
          eq(schema.componentIndex.designId, designId),
          eq(schema.componentIndex.name, name),
        ),
      )
      .limit(1);

    const persistedProps = parseJson<unknown[]>(indexRow?.props, []);
    const persistedVariants = parseJson<Record<string, string[]>>(
      indexRow?.variants,
      {},
    );
    const persistedStories = parseJson<unknown[]>(indexRow?.stories, []);

    // ── Source location (real-app only) ──────────────────────────────────────
    // The bridge `resolveNodeToFile` op maps a node id to a source file + span.
    // For inline designs the capability is `available` but resolves to the
    // design file itself (no external source file).  We surface whatever we
    // have from the index row.
    const sourceLocation =
      canResolveToFile && indexRow?.filePath
        ? {
            filePath: indexRow.filePath,
            exportName: indexRow.exportName ?? undefined,
          }
        : undefined;

    return {
      designId,
      nodeId,
      sourceType,
      instance,
      name,
      // Props: merge observed attribute props with richer persisted prop types
      // when available.  Real-app callers get the full TS/cva prop table.
      observedProps,
      persistedProps,
      persistedVariants,
      persistedStories,
      sourceLocation,
      capabilities: {
        canResolveToFile,
        hasFullIndex,
        canEditProps,
        ctaRequired,
        ctaMessage,
      },
    };
  },
});
