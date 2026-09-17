import { defineAction } from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  lockDesignSourceMutation,
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
  componentIndexId,
  componentNameFor,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

export class ComponentRenameAmbiguousError extends Error {
  readonly statusCode = 409;

  constructor(
    message = "The component is a legacy same-name-only component and cannot be renamed safely.",
  ) {
    super(message);
    this.name = "ComponentRenameAmbiguousError";
  }
}

export class ComponentRenameConflictError extends Error {
  readonly statusCode = 409;

  constructor(message = "A component with this name already exists.") {
    super(message);
    this.name = "ComponentRenameConflictError";
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
    const projectedNodes = liveFiles.flatMap(
      ({ live }) => buildCodeLayerProjection(live.content).nodes,
    );
    const canonical = projectedNodes.find(
      (node) => node.dataAttributes[COMPONENT_ID_ATTR]?.trim() === componentId,
    );
    const oldName = canonical ? componentNameFor(canonical) : null;
    if (!oldName) {
      throw new ComponentRenameAmbiguousError();
    }
    if (newName === oldName) {
      return { designId, componentId, renamed: false };
    }
    const oldIndexId = componentIndexId(designId, oldName);
    const newIndexId = componentIndexId(designId, newName);
    if (newIndexId !== oldIndexId) {
      const [existing] = await getDb()
        .select({ id: schema.componentIndex.id })
        .from(schema.componentIndex)
        .where(
          and(
            eq(schema.componentIndex.id, newIndexId),
            eq(schema.componentIndex.designId, designId),
          ),
        )
        .limit(1);
      if (existing) throw new ComponentRenameConflictError();
    }
    const conflictingMarkup = projectedNodes.some((node) => {
      const name = componentNameFor(node);
      if (!name || componentIndexId(designId, name) !== newIndexId) {
        return false;
      }
      return (
        node.dataAttributes[COMPONENT_ID_ATTR]?.trim() !== componentId &&
        node.dataAttributes[COMPONENT_REF_ATTR]?.trim() !== componentId
      );
    });
    if (conflictingMarkup) throw new ComponentRenameConflictError();

    const linkedNodes = projectedNodes.filter(
      (node) =>
        node.dataAttributes[COMPONENT_ID_ATTR]?.trim() === componentId ||
        node.dataAttributes[COMPONENT_REF_ATTR]?.trim() === componentId,
    );
    const componentSelectors = Array.from(
      new Set(
        linkedNodes.map(
          (node) =>
            `[data-agent-native-node-id="${node.dataAttributes["data-agent-native-node-id"] ?? node.id}"]`,
        ),
      ),
    );
    const legacySelectors = Array.from(
      new Set(
        projectedNodes
          .filter(
            (node) =>
              componentNameFor(node) === oldName &&
              !node.dataAttributes[COMPONENT_ID_ATTR]?.trim() &&
              !node.dataAttributes[COMPONENT_REF_ATTR]?.trim(),
          )
          .map(
            (node) =>
              `[data-agent-native-node-id="${node.dataAttributes["data-agent-native-node-id"] ?? node.id}"]`,
          ),
      ),
    );
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
        afterFilesPersist: async (tx, updatedAt) => {
          await lockDesignSourceMutation(tx, designId);
          if (newIndexId !== oldIndexId) {
            const destination = await tx.execute({
              sql: "SELECT id FROM component_index WHERE id = ? AND design_id = ? FOR UPDATE",
              args: [newIndexId, designId],
            });
            if (destination.rows.length > 0) {
              throw new ComponentRenameConflictError();
            }
          }
          const moved = await tx.execute({
            sql: "UPDATE component_index SET id = ?, name = ?, runtime_selectors = ?, updated_at = ? WHERE id = ? AND design_id = ? RETURNING id",
            args: [
              newIndexId,
              newName,
              JSON.stringify(componentSelectors),
              updatedAt,
              oldIndexId,
              designId,
            ],
          });
          if (moved.rows.length === 1) {
            if (legacySelectors.length > 0 && newIndexId !== oldIndexId) {
              await tx.execute({
                sql: `INSERT INTO component_index (
                  id, design_id, source_ref, name, file_path, export_name,
                  props, variants, stories, runtime_selectors, created_at,
                  updated_at, owner_email, org_id, visibility
                )
                SELECT ?, design_id, source_ref, ?, file_path, export_name,
                  props, variants, stories, ?, created_at, ?, owner_email,
                  org_id, visibility
                FROM component_index WHERE id = ? AND design_id = ?`,
                args: [
                  oldIndexId,
                  oldName,
                  JSON.stringify(legacySelectors),
                  updatedAt,
                  newIndexId,
                  designId,
                ],
              });
            }
          } else {
            const designOwner = (access.resource as { ownerEmail?: unknown })
              .ownerEmail;
            const ownerEmail =
              getRequestUserEmail() ??
              (typeof designOwner === "string" && designOwner
                ? designOwner
                : null);
            if (!ownerEmail) throw new Error("no authenticated user");
            await tx.execute({
              sql: `INSERT INTO component_index
                (id, design_id, name, runtime_selectors, owner_email, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
              args: [
                newIndexId,
                designId,
                newName,
                JSON.stringify(componentSelectors),
                ownerEmail,
                updatedAt,
                updatedAt,
              ],
            });
            if (legacySelectors.length > 0 && newIndexId !== oldIndexId) {
              await tx.execute({
                sql: `INSERT INTO component_index
                  (id, design_id, name, runtime_selectors, owner_email, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [
                  oldIndexId,
                  designId,
                  oldName,
                  JSON.stringify(legacySelectors),
                  ownerEmail,
                  updatedAt,
                  updatedAt,
                ],
              });
            }
          }
        },
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
