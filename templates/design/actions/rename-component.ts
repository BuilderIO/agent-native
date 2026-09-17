import { defineAction } from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  resolveSourceWorkspace,
  writeInlineSourceFilesBatch,
} from "../server/source-workspace.js";
import {
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
} from "../shared/code-layer.js";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_NAME_ATTR,
  COMPONENT_REF_ATTR,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

export class ComponentRenameAmbiguousError extends Error {
  constructor(
    message = "The component is a legacy same-name-only component and cannot be renamed safely.",
  ) {
    super(message);
    this.name = "ComponentRenameAmbiguousError";
  }
}

export function renameLinkedComponentHtml(
  html: string,
  componentId: string,
  newName: string,
): { content: string; changed: boolean } {
  const projection = buildCodeLayerProjection(html);
  const updates = projection.nodes
    .filter(
      (node) =>
        node.dataAttributes[COMPONENT_ID_ATTR]?.trim() === componentId ||
        node.dataAttributes[COMPONENT_REF_ATTR]?.trim() === componentId,
    )
    .map((node) => ({
      node,
      attributes: { [COMPONENT_NAME_ATTR]: newName },
    }));
  const content =
    updates.length > 0
      ? (patchCodeLayerNodeAttributes(html, updates) ?? html)
      : html;
  return { content, changed: content !== html };
}

export default defineAction({
  description:
    "Rename a canonical linked Design component across every inline HTML file.",
  schema: z.object({
    designId: z.string().trim().min(1),
    componentId: z
      .string()
      .trim()
      .min(1)
      .describe("Persisted canonical component id"),
    newName: z.string().trim().min(1).max(255),
  }),
  run: async ({ designId, componentId, newName }, context) => {
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");
    if (
      designSourceTypeFromData((access.resource as { data?: unknown }).data) !==
      "inline"
    ) {
      return { designId, componentId, renamed: false, ctaRequired: true };
    }
    await assertAccess("design", designId, "editor");
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: true,
      includeBoard: true,
    });
    const htmlFiles = workspace.files.filter(
      (file) => file.fileType === "html",
    );
    const liveFiles = await Promise.all(
      htmlFiles.map(async (file) => ({
        file,
        live: await readLiveSourceFile(file),
      })),
    );
    const hasCanonical = liveFiles.some(({ live }) =>
      buildCodeLayerProjection(live.content).nodes.some(
        (node) =>
          node.dataAttributes[COMPONENT_ID_ATTR]?.trim() === componentId,
      ),
    );
    if (!hasCanonical) {
      throw new ComponentRenameAmbiguousError();
    }
    const batches = liveFiles.map(({ file, live }) => ({
      file: { ...file, content: live.content },
      content: renameLinkedComponentHtml(live.content, componentId, newName)
        .content,
      expectedVersionHash: live.versionHash,
    }));
    const changed = batches.filter(
      ({ file, content }) => file.content !== content,
    );
    if (changed.length === 0) return { designId, componentId, renamed: false };

    await snapshotDesignBeforeAgentEdit(designId, context);
    const entered = htmlFiles.map((file) => file.id).sort();
    entered.forEach((id) => agentEnterDocument(id));
    try {
      const result = await writeInlineSourceFilesBatch({
        designId,
        files: batches,
        expectedHtmlFileIds: htmlFiles.map((file) => file.id),
      });
      return {
        designId,
        componentId,
        newName,
        renamed: true,
        files: result.files,
      };
    } finally {
      entered.forEach((id) => agentLeaveDocument(id));
    }
  },
});
