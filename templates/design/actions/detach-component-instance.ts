/**
 * detach-component-instance — Figma's "Detach instance" (⌥⌘B).
 *
 * There is no separate component "definition"/template markup anywhere in
 * this codebase (see `shared/component-model.ts`): a component instance is
 * just an ordinary element carrying a `data-agent-native-component="Name"`
 * annotation (plus optional `data-agent-native-prop-*` overrides), and every
 * instance of the same name is an independently-duplicated copy of HTML —
 * `component_index` only stores metadata (props/variants/runtime selectors),
 * never markup. Detaching an instance therefore doesn't need to "inline a
 * template" the way a real component-instantiation system would: the node's
 * current rendered markup already IS the fully expanded content. Detach
 * severs the *component-instance linkage* by stripping the annotation
 * attributes, so `is-component-instance` checks (`isComponentInstance`,
 * `index-components`, `get-component-details`) stop recognizing this node —
 * exactly Figma's "instance becomes a plain layer" semantics — while leaving
 * position, size, layout, classes, text, and Alpine (`x-data`) behavior
 * completely untouched.
 *
 * Persists through the same deterministic HTML-patch + collab seam as
 * `apply-component-prop-edit` / `apply-visual-edit` (`writeInlineSourceFile`
 * with an `expectedVersionHash` CAS guard), so it participates in the
 * editor's undo/collab machinery exactly like every other HTML-mutating
 * action — there is no separate undo/history log in this codebase to hook
 * into (see those actions' docs).
 *
 * Inline/Alpine designs only; real-app sources fail closed (same posture as
 * `apply-component-prop-edit`).
 */

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
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import {
  componentNameFor,
  componentNodeIdMatches,
  COMPONENT_NAME_ATTR,
  COMPONENT_PROP_PREFIX,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import { sourceContentHash } from "../shared/source-workspace.js";

// ─── Pure transform ────────────────────────────────────────────────────────

/**
 * Strip the `data-agent-native-component` annotation and every
 * `data-agent-native-prop-*` override attribute from a node's opening tag,
 * using its source span. Pure — no DB / IO — so it can be unit tested
 * directly.
 *
 * Leaves everything else (classes, style, text, `x-data`, `id`,
 * `data-agent-native-node-id`, …) untouched: the node keeps its current
 * rendered appearance and behavior, it simply stops being recognized as a
 * component instance.
 */
export function stripComponentAnnotations(
  html: string,
  source: { openStart: number; openEnd: number } | null | undefined,
): { content: string; changed: boolean; removedAttributes: string[] } {
  if (!source) {
    return { content: html, changed: false, removedAttributes: [] };
  }

  const openTag = html.slice(source.openStart, source.openEnd);
  const removed: string[] = [];
  let newOpenTag = openTag;

  const componentAttrRe = new RegExp(
    `\\s+${COMPONENT_NAME_ATTR}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>"']+)`,
    "i",
  );
  if (componentAttrRe.test(newOpenTag)) {
    removed.push(COMPONENT_NAME_ATTR);
    newOpenTag = newOpenTag.replace(componentAttrRe, "");
  }

  const propAttrRe = new RegExp(
    `\\s+${COMPONENT_PROP_PREFIX}[a-z0-9-]+\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>"']+)`,
    "gi",
  );
  newOpenTag = newOpenTag.replace(propAttrRe, (match) => {
    removed.push(match.trim().split("=")[0] ?? match.trim());
    return "";
  });

  if (newOpenTag === openTag) {
    return { content: html, changed: false, removedAttributes: [] };
  }

  return {
    content:
      html.slice(0, source.openStart) + newOpenTag + html.slice(source.openEnd),
    changed: true,
    removedAttributes: removed,
  };
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
    "Detach a component instance (Figma's ⌥⌘B): strip the " +
    "data-agent-native-component annotation and its data-agent-native-prop-* " +
    "overrides from the selected instance root so it becomes a plain, " +
    "unlinked element. Position, size, classes, text, and behavior are " +
    "unchanged — only the component-instance linkage is removed. " +
    "Inline/Alpine designs only.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe("data-agent-native-node-id of the component instance root"),
    fileId: z
      .string()
      .optional()
      .describe("Design file id; defaults to index.html"),
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
  run: async ({ designId, nodeId, fileId, source }) => {
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);

    if (sourceType !== "inline") {
      return {
        designId,
        nodeId,
        sourceType,
        detached: false,
        ctaRequired: true,
        ctaMessage:
          "Detach instance requires a dedicated consented, version-guarded " +
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
        detached: false,
        conflict: true,
        fileId: file.id,
        filename: file.filename,
        error:
          "This file changed since this detach was prepared. Refresh the editor and try again.",
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
        `Node "${nodeId}" is not a component root (no data-agent-native-component attribute) — nothing to detach.`,
      );
    }

    const {
      content: patchedContent,
      changed,
      removedAttributes,
    } = stripComponentAnnotations(html, node.source);

    if (!changed) {
      return {
        designId,
        nodeId,
        componentName,
        detached: false,
        fileId: file.id,
        filename: file.filename,
        note: "No component annotation attributes found on this node's open tag.",
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
        "Detaching instance",
      ),
      nodeId,
      editingFile: file.filename,
      designId: file.designId,
    });

    return {
      designId,
      nodeId,
      componentName,
      detached: true,
      removedAttributes,
      fileId: file.id,
      filename: file.filename,
      updatedAt,
      content: patchedContent,
      note: `Detached from component "${componentName}". This node is now a plain element.`,
    };
  },
});
