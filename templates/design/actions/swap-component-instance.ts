/**
 * swap-component-instance — Figma's "Swap instance".
 *
 * DESIGN NOTE — mapping onto this codebase's data model: there is no
 * separate component "definition"/template anywhere here (see
 * `shared/component-model.ts`) — every instance is an independently
 * duplicated copy of HTML matched purely by its
 * `data-agent-native-component="Name"` annotation. "Swap to component B"
 * therefore means: find an existing instance of B somewhere in the design
 * (any screen), copy ITS current markup in as a replacement for the selected
 * instance of A, and carry over whichever `data-agent-native-prop-*`
 * overrides the selected instance had that B's own instances also declare
 * (Figma's "preserve same-named overrides").
 *
 * Scope decisions, deliberately conservative:
 * - Requires at least one existing instance of the target component
 *   somewhere in the design (any file) to copy markup from. There is no
 *   component library/definition to fall back to — this is a hard
 *   requirement, not a data-model gap to route around.
 * - Only `data-agent-native-prop-*` attribute overrides are carried over.
 *   The `x-data` Alpine expression is intentionally NOT merged: Alpine state
 *   can hold arbitrary JS (methods, nested objects, expressions) and this
 *   codebase already treats blind x-data rewrites as unsafe (see
 *   `component-section.tsx`'s `canRebuildAlpineDataLosslessly` bail-out) — the
 *   swapped-in instance keeps ITS OWN component's default `x-data` as-is.
 *   Prop names present on the old instance but not declared by the new
 *   component are dropped (`droppedProps`); prop names the new component
 *   declares that the old instance didn't override keep the new component's
 *   default (`defaultedProps`). Both are reported so the caller/UI can tell
 *   the user what changed.
 * - The selected instance's own `data-agent-native-node-id` is preserved on
 *   the swapped-in markup (rather than keeping whatever id the copied
 *   instance had) so selection, undo, and any other node-id-keyed state keep
 *   addressing the same slot on the canvas.
 *
 * Persists through the same deterministic HTML-patch + collab seam as
 * `apply-component-prop-edit` (`writeInlineSourceFile` + `expectedVersionHash`
 * CAS guard) — same undo/collab posture as every other HTML-mutating action.
 *
 * Inline/Alpine designs only; real-app sources fail closed.
 */

import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import {
  componentNameFor,
  componentNodeIdMatches,
  extractProps,
  propNameToDataAttribute,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import { sourceContentHash } from "../shared/source-workspace.js";
import { applyRootAttributeEdit } from "./apply-component-prop-edit.js";

// ─── Pure markup helpers ────────────────────────────────────────────────────

/**
 * Find the end offset (exclusive) of the opening tag at the start of
 * `markup`, respecting quoted attribute values that may themselves contain
 * `>`. Returns `markup.length` if no unquoted `>` is found. Pure.
 */
export function findOpenTagEnd(markup: string): number {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < markup.length; i++) {
    const ch = markup[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i + 1;
  }
  return markup.length;
}

/**
 * Set (or replace) a single attribute on a standalone markup string's opening
 * tag — the same splice `applyRootAttributeEdit` performs against a full
 * document, but for an already-extracted outerHTML fragment (e.g. copied from
 * another instance elsewhere in the design). Pure — exported for tests.
 */
export function setAttributeOnMarkup(
  markup: string,
  attrName: string,
  attrValue: string,
): string {
  const openEnd = findOpenTagEnd(markup);
  const result = applyRootAttributeEdit(
    markup,
    { openStart: 0, openEnd },
    attrName,
    attrValue,
  );
  return result.content;
}

export interface SwapOverrideResult {
  markup: string;
  overriddenProps: string[];
  droppedProps: string[];
  defaultedProps: string[];
}

/**
 * Re-key every descendant in markup copied from another component instance.
 * Keeping the copied `data-agent-native-node-id` values would create duplicate
 * stable layer identities, so selection and the aggregate layer-owner map
 * could jump back to the source instance after a swap. The root keeps the
 * selected instance's id later in `mergeComponentSwapOverrides`; descendants
 * receive fresh ids here.
 *
 * `createNodeId` is injectable so the pure behavior stays deterministic in
 * tests while production uses cryptographically unique ids.
 */
export function reassignCopiedDescendantNodeIds(
  markup: string,
  createNodeId: () => string = () => `an-${randomUUID()}`,
): string {
  const projection = buildCodeLayerProjection(markup);
  const rootIds = new Set(projection.rootNodeIds);
  const descendants = projection.nodes
    .filter((node) => !rootIds.has(node.id) && node.source)
    .sort(
      (a, b) =>
        (b.source?.openStart ?? Number.NEGATIVE_INFINITY) -
        (a.source?.openStart ?? Number.NEGATIVE_INFINITY),
    );

  let content = markup;
  for (const descendant of descendants) {
    content = applyRootAttributeEdit(
      content,
      descendant.source,
      "data-agent-native-node-id",
      createNodeId(),
    ).content;
  }
  return content;
}

/**
 * Apply the selected instance's `data-agent-native-prop-*` overrides onto a
 * copy of the target component's markup, carrying over only prop names the
 * target component ALSO declares, then stamp the selected instance's stable
 * node id onto the result. Pure — exported for tests.
 */
export function mergeComponentSwapOverrides(
  targetMarkup: string,
  currentProps: Array<{ name: string; value: string }>,
  targetDefaultProps: Array<{ name: string; value: string }>,
  nodeId: string,
): SwapOverrideResult {
  const targetNames = new Set(targetDefaultProps.map((p) => p.name));
  const currentNames = new Set(currentProps.map((p) => p.name));

  const overriddenProps: string[] = [];
  const droppedProps: string[] = [];
  const defaultedProps: string[] = [];

  let markup = reassignCopiedDescendantNodeIds(targetMarkup);

  for (const prop of currentProps) {
    if (targetNames.has(prop.name)) {
      markup = setAttributeOnMarkup(
        markup,
        propNameToDataAttribute(prop.name),
        prop.value,
      );
      overriddenProps.push(prop.name);
    } else {
      droppedProps.push(prop.name);
    }
  }

  for (const prop of targetDefaultProps) {
    if (!currentNames.has(prop.name)) defaultedProps.push(prop.name);
  }

  markup = setAttributeOnMarkup(markup, "data-agent-native-node-id", nodeId);

  return { markup, overriddenProps, droppedProps, defaultedProps };
}

// ─── Persistence ────────────────────────────────────────────────────────────

async function persistEdit(file: {
  id: string;
  designId: string;
  filename: string;
  content: string;
  expectedVersionHash: string;
}): Promise<string> {
  await assertAccess("design", file.designId, "editor");

  agentEnterDocument(file.id);
  try {
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename,
      fileType: "html",
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };

    const result = await writeInlineSourceFile({
      designId: file.designId,
      file: workspaceFile,
      content: file.content,
      expectedVersionHash: file.expectedVersionHash,
    });

    return result.updatedAt;
  } finally {
    agentLeaveDocument(file.id);
  }
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Swap a component instance for a different component from elsewhere in " +
    "the design (Figma's Swap instance). Replaces the selected instance's " +
    "markup with a copy of another existing instance of targetComponentName, " +
    "carrying over data-agent-native-prop-* overrides whose prop name exists " +
    "on both components. x-data (Alpine state) is not merged — the swapped-in " +
    "instance keeps the target component's own x-data. Requires at least one " +
    "existing instance of targetComponentName somewhere in the design. " +
    "Inline/Alpine designs only.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe("data-agent-native-node-id of the component instance to swap"),
    fileId: z
      .string()
      .optional()
      .describe(
        "Design file id the instance currently lives in; defaults to index.html",
      ),
    targetComponentName: z
      .string()
      .min(1)
      .describe(
        "Name of the component to swap in, from list-design-components",
      ),
    source: z
      .object({
        currentContent: z
          .string()
          .optional()
          .describe("Latest editor HTML snapshot, when available."),
        revision: z
          .string()
          .optional()
          .describe(
            "design_files.updatedAt value the currentContent is based on.",
          ),
      })
      .optional(),
  }),
  run: async ({ designId, nodeId, fileId, targetComponentName, source }) => {
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);

    if (sourceType !== "inline") {
      return {
        designId,
        nodeId,
        sourceType,
        swapped: false,
        ctaRequired: true,
        ctaMessage:
          "Swap instance requires a dedicated consented, version-guarded " +
          "compiled-source transform for real-app sources. Not yet available.",
      };
    }

    await assertAccess("design", designId, "editor");
    const db = getDb();

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
        updatedAt: schema.designFiles.updatedAt,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);

    if (!file) throw new Error("Design HTML file not found.");

    if (
      source?.currentContent &&
      source.revision &&
      file.updatedAt &&
      source.revision !== file.updatedAt
    ) {
      return {
        designId,
        nodeId,
        swapped: false,
        conflict: true,
        fileId: file.id,
        filename: file.filename,
        error:
          "This file changed since this swap was prepared. Refresh the editor and try again.",
      };
    }

    const html =
      typeof source?.currentContent === "string"
        ? source.currentContent
        : (file.content ?? "");
    const baseVersionHash = sourceContentHash(html);

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
        `Node "${nodeId}" is not a component root (no data-agent-native-component attribute) — nothing to swap.`,
      );
    }

    if (componentName === targetComponentName) {
      return {
        designId,
        nodeId,
        componentName,
        swapped: false,
        note: `Already an instance of "${targetComponentName}".`,
      };
    }

    if (!node.source) {
      throw new Error(
        `Node "${nodeId}" has no resolvable source span; cannot swap.`,
      );
    }

    // ── Find a markup source for the target component ──────────────────────
    const allFiles = await db
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
      .where(
        and(
          accessFilter(schema.designs, schema.designShares),
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.fileType, "html"),
        ),
      )
      .orderBy(schema.designFiles.createdAt);

    let targetNode: CodeLayerNode | undefined;
    let targetHtml = "";

    for (const row of allFiles) {
      const rowHtml = row.id === file.id ? html : (row.content ?? "");
      if (!rowHtml) continue;
      const rowProjection =
        row.id === file.id
          ? projection
          : buildCodeLayerProjection(rowHtml, {
              source: {
                kind: "design-file",
                designId: row.designId,
                fileId: row.id,
                filename: row.filename,
              },
            });

      const match = rowProjection.nodes.find((n) => {
        if (row.id === file.id && n.id === node.id) return false;
        return componentNameFor(n) === targetComponentName;
      });

      if (match) {
        targetNode = match;
        targetHtml = rowHtml;
        break;
      }
    }

    if (!targetNode) {
      throw new Error(
        `No existing instance of component "${targetComponentName}" found ` +
          "anywhere in this design. Swap needs at least one existing " +
          "instance to copy markup from — run list-design-components to see " +
          "what's available.",
      );
    }
    if (!targetNode.source) {
      throw new Error(
        `The matched "${targetComponentName}" instance has no resolvable source span; cannot swap.`,
      );
    }

    const targetMarkup = targetHtml.slice(
      targetNode.source.start,
      targetNode.source.end,
    );

    const currentProps = extractProps(node);
    const targetDefaultProps = extractProps(targetNode);

    const {
      markup: mergedMarkup,
      overriddenProps,
      droppedProps,
      defaultedProps,
    } = mergeComponentSwapOverrides(
      targetMarkup,
      currentProps,
      targetDefaultProps,
      nodeId,
    );

    const patchedContent =
      html.slice(0, node.source.start) +
      mergedMarkup +
      html.slice(node.source.end);

    if (patchedContent === html) {
      return {
        designId,
        nodeId,
        componentName,
        swapped: false,
        note: "Swap produced no change.",
      };
    }

    const updatedAt = await persistEdit({
      id: file.id,
      designId: file.designId,
      filename: file.filename,
      content: patchedContent,
      expectedVersionHash: baseVersionHash,
    });

    agentUpdateSelection(file.id, {
      selection: agentSelectionDescriptor(
        { nodeId, selector: node.selector },
        "Swapping instance",
      ),
      nodeId,
      editingFile: file.filename,
      designId: file.designId,
    });

    return {
      designId,
      nodeId,
      fromComponent: componentName,
      toComponent: targetComponentName,
      swapped: true,
      overriddenProps,
      droppedProps,
      defaultedProps,
      fileId: file.id,
      filename: file.filename,
      updatedAt,
      content: patchedContent,
      note: `Swapped "${componentName}" for "${targetComponentName}".`,
    };
  },
});
