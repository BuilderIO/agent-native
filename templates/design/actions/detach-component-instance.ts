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
import "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
} from "../shared/code-layer.js";
import type { CodeLayerNode, CodeLayerSource } from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import {
  componentNameFor,
  componentNodeIdMatches,
  COMPONENT_ID_ATTR,
  COMPONENT_NAME_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_PROP_PREFIX,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
  isComponentInstanceForInstanceActions,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import { sourceContentHash } from "../shared/source-workspace.js";

export function stripComponentAnnotations(
  html: string,
  root: CodeLayerNode | null | undefined,
  projectionNodes: readonly CodeLayerNode[] = root ? [root] : [],
): { content: string; changed: boolean; removedAttributes: string[] } {
  if (!root?.source) {
    return { content: html, changed: false, removedAttributes: [] };
  }
  const nodesById = new Map(projectionNodes.map((node) => [node.id, node]));
  const updates: Array<{
    node: CodeLayerNode;
    attributes: Record<string, string | null>;
  }> = [];
  const removed = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: CodeLayerNode, isRoot: boolean): boolean => {
    if (visited.has(node.id)) return false;
    visited.add(node.id);
    const isNestedComponentRoot =
      !isRoot &&
      (Object.prototype.hasOwnProperty.call(
        node.dataAttributes,
        COMPONENT_ID_ATTR,
      ) ||
        Object.prototype.hasOwnProperty.call(
          node.dataAttributes,
          COMPONENT_REF_ATTR,
        ));
    const attributes: Record<string, string | null> = {};
    for (const attribute of Object.keys(node.dataAttributes)) {
      const remove =
        (isRoot &&
          (attribute === COMPONENT_NAME_ATTR ||
            attribute === COMPONENT_ID_ATTR ||
            attribute === COMPONENT_REF_ATTR ||
            attribute === COMPONENT_OVERRIDES_ATTR ||
            attribute === COMPONENT_SOURCE_NODE_ID_ATTR ||
            attribute.startsWith(COMPONENT_PROP_PREFIX))) ||
        (!isRoot &&
          (attribute === COMPONENT_SOURCE_NODE_ID_ATTR ||
            (!isNestedComponentRoot &&
              attribute === COMPONENT_OVERRIDES_ATTR)));
      if (!remove) continue;
      attributes[attribute] = null;
      removed.add(attribute);
    }
    if (Object.keys(attributes).length > 0) {
      updates.push({ node, attributes });
    }
    if (isNestedComponentRoot) {
      return true;
    }
    for (const childId of node.children) {
      const child = nodesById.get(childId);
      if (!child || !visit(child, false)) return false;
    }
    return true;
  };
  if (!visit(root, true)) {
    return { content: html, changed: false, removedAttributes: [] };
  }
  if (updates.length === 0) {
    return { content: html, changed: false, removedAttributes: [] };
  }
  const content = patchCodeLayerNodeAttributes(html, updates);
  if (content === null) {
    return { content: html, changed: false, removedAttributes: [] };
  }
  return {
    content,
    changed: content !== html,
    removedAttributes: [...removed],
  };
}

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
  run: async ({ designId, nodeId, fileId, source }, context) => {
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
    await snapshotDesignBeforeAgentEdit(designId, context);
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
    if (!isComponentInstanceForInstanceActions(node)) {
      throw new Error(
        `Node "${nodeId}" is the canonical component main; detach an instance reference instead.`,
      );
    }

    const {
      content: patchedContent,
      changed,
      removedAttributes,
    } = stripComponentAnnotations(html, node, projection.nodes);

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
