/**
 * open-component-source — navigate / deep-link action.
 *
 * For a selected component instance, resolves the source file path (via
 * `resolveNodeToFile` bridge op when the capability is available) and writes
 * a navigation command to application state so the editor opens the correct
 * file and highlights the component.
 *
 * **Inline / Alpine tier:**  the "source file" is the design HTML file itself.
 * The action navigates the editor to the file and selects the component node —
 * there is no external source file to open.  The response includes a
 * `ctaRequired` flag pointing to the real-app CTA for full jump-to-source.
 *
 * **Real-app tier (localhost / fusion):**  uses the persisted `component_index`
 * row's `filePath` / `exportName` as the target (populated by `index-components`
 * after a bridge handshake or AST parse).  The `resolveNodeToFile` capability
 * gate is checked and the response includes the external file path for the IDE
 * to open.
 *
 * Navigation is written via `writeAppState("navigate", ...)` — the same
 * mechanism used by the `navigate` action. Because this writes transient
 * application state, the action uses the default POST mutation transport.
 *
 * See DESIGN-STUDIO-PLAN.md §6.1 (jump-to-source) and §7 (action surface).
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getText, hasCollabState } from "@agent-native/core/collab";
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
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  try {
    if (await hasCollabState(fileId)) {
      const live = await getText(fileId, "content");
      if (typeof live === "string") return live;
    }
  } catch {
    // Collab reads are best-effort; SQL content is the fallback.
  }
  return storedContent;
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Navigate to a component's source: for inline/Alpine designs, selects " +
    "the component root in the editor and returns the design file as the " +
    "source location. For real-app sources (localhost / fusion), resolves the " +
    "external source file path + export name via the component_index and the " +
    "resolveNodeToFile bridge capability, and emits a navigation command so the " +
    "IDE can open the file at the correct line.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe("data-agent-native-node-id of the component instance root"),
    fileId: z
      .string()
      .optional()
      .describe("Design file id; defaults to index.html"),
  }),
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

    const html = await liveContent(file.id, file.content ?? "");

    // ── Resolve node ─────────────────────────────────────────────────────────
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
        `Node "${nodeId}" not found. Run get-code-layer-projection to list current ids.`,
      );
    }

    const componentName = componentNameFor(node);
    if (!componentName) {
      throw new Error(
        `Node "${nodeId}" is not a component root (no data-agent-native-component attribute).`,
      );
    }

    // ── Lookup persisted component_index for real-app source location ────────
    const [indexRow] = await db
      .select({
        id: schema.componentIndex.id,
        filePath: schema.componentIndex.filePath,
        exportName: schema.componentIndex.exportName,
      })
      .from(schema.componentIndex)
      .where(
        and(
          eq(schema.componentIndex.designId, designId),
          eq(schema.componentIndex.name, componentName),
        ),
      )
      .limit(1);

    // ── Build source location ─────────────────────────────────────────────────
    // For inline designs: the design file is the "source".
    // For real-app designs: the external file path from component_index.
    const isRealApp = sourceType !== "inline";
    const externalFilePath =
      isRealApp && canResolveToFile ? (indexRow?.filePath ?? null) : null;
    const exportName =
      isRealApp && canResolveToFile ? (indexRow?.exportName ?? null) : null;

    const sourceLocation = {
      /** The design file that contains this component instance. */
      designFileId: file.id,
      designFilename: file.filename,
      /** Node id within the design file. */
      nodeId,
      /** CSS selector for the component root in the rendered HTML. */
      selector: node.selector,
      /** External source file for real-app components (null on inline). */
      externalFilePath,
      exportName,
    };

    // ── Emit navigation command ──────────────────────────────────────────────
    // Use the same application state key as the `navigate` action so the UI
    // client picks it up and selects the element in the editor.
    await writeAppState("navigate", {
      view: "editor",
      designId,
      editorView: "single",
      fileId: file.id,
      filename: file.filename,
      selectedNodeId: nodeId,
      inspectorTab: "design",
      inspectorSection: "component",
    });

    return {
      designId,
      nodeId,
      componentName,
      sourceType,
      sourceLocation,
      capabilities: {
        canResolveToFile,
        hasExternalSource: Boolean(externalFilePath),
        ctaRequired: isRealApp && !canResolveToFile,
        ctaMessage:
          isRealApp && !canResolveToFile
            ? "Jump to external source file requires the resolveNodeToFile bridge capability. Connect Builder and run index-components to enable full jump-to-source."
            : isRealApp && !externalFilePath
              ? "Component source file not yet indexed. Run index-components to populate file paths."
              : undefined,
      },
      navigated: true,
    };
  },
});
