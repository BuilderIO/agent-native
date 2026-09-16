/**
 * apply-component-prop-edit — persist a component prop edit.
 *
 * **Tier A (Alpine / inline):**  edits Alpine component annotations directly
 * via the deterministic `apply-visual-edit` path — the same
 * `replace-document-content` + Yjs/collab seam used for all other HTML writes.
 *
 * Supported Alpine edit kinds:
 * - `alpineData`   — replaces the `x-data` expression (class-level state,
 *                    variant selection, disabled flag, etc.).
 * - `attribute`    — sets a `data-agent-native-prop-*` attribute or any other
 *                    HTML attribute on the component root.
 * - `classReplace` — replaces one Tailwind class with another on the root node.
 *
 * **Real-app sources (localhost / fusion):** deliberately fail closed. This
 * action's patcher operates on SQL-backed HTML design files; it must never be
 * reused for compiled JSX/TSX source. Real-app prop persistence needs a
 * dedicated consented, version-guarded bridge transform. Until that exists,
 * callers may preview but this action returns `ctaRequired: true` without
 * reading or modifying a design file.
 *
 * See DESIGN-STUDIO-PLAN.md §6.1, §7 (preview/apply contract), §11 phase 2.
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
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  prepareInlineSourceEdit,
  readLiveSourceFile,
  SourceWorkspaceEditConflictError,
  resolveSourceWorkspace,
  writeInlineSourceFile,
  writeInlineSourceFilesBatch,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
} from "../shared/code-layer.js";
import type {
  ClassEditIntent,
  CodeLayerNode,
  CodeLayerSource,
  DeleteNodeEditIntent,
  MoveNodeEditIntent,
  StyleEditIntent,
  StyleRemoveEditIntent,
  UnwrapEditIntent,
  WrapNodesEditIntent,
} from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import { componentDeletionGeometrySchema } from "../shared/component-archive.js";
import {
  applyComponentStructureEdit,
  applyComponentStructureIntent,
  applyComponentPropertyEdit,
  applyComponentStyleTargetsEdit,
  resetComponentInstanceOverrides,
  type ComponentPropertyEdit,
  type ComponentStructureTransformResult,
  type ComponentSourceDocument,
} from "../shared/component-links.js";
import {
  componentNameFor,
  componentNodeIdMatches,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import { sourceContentHash } from "../shared/source-workspace.js";
import {
  ComponentArchiveMutationError,
  deleteComponentMainFromDesign,
  restoreComponentMainInDesign,
  type ComponentArchiveMutationResult,
} from "./_component-archive.js";

type SupportedStructureIntent =
  | DeleteNodeEditIntent
  | MoveNodeEditIntent
  | WrapNodesEditIntent
  | UnwrapEditIntent
  | StyleEditIntent
  | StyleRemoveEditIntent;

type ComponentStructureEdit =
  | {
      kind: "structure";
      before: string;
      after: string;
      selectionNodeIds?: string[];
    }
  | { kind: "structure"; intents: SupportedStructureIntent[] };

interface LinkedComponentSelection {
  fileId: string;
  nodeIds: string[];
}

const structureTargetSchema = z.object({ nodeId: z.string().min(1) }).strict();

const MAX_STRUCTURE_SIZE_HINT = 1_000_000;
const structureSizeHintCoordinate = z
  .number()
  .finite()
  .min(-MAX_STRUCTURE_SIZE_HINT)
  .max(MAX_STRUCTURE_SIZE_HINT);
const structureSizeHintSchema = z
  .object({
    width: structureSizeHintCoordinate.nonnegative(),
    height: structureSizeHintCoordinate.nonnegative(),
    left: structureSizeHintCoordinate.optional(),
    top: structureSizeHintCoordinate.optional(),
  })
  .strict();

const structureStyleIntentSchema = z
  .object({
    kind: z.literal("style"),
    target: structureTargetSchema,
    property: z.string().min(1),
    operation: z.enum(["set", "remove"]).optional(),
    value: z.string().optional(),
  })
  .strict()
  .superRefine((intent, context) => {
    const operation = intent.operation ?? "set";
    if (operation === "set" && intent.value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "A style set intent requires a value.",
      });
    }
    if (operation === "remove" && intent.value !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "A style remove intent cannot include a value.",
      });
    }
  });

const structureIntentSchema = z.union([
  z
    .object({ kind: z.literal("deleteNode"), target: structureTargetSchema })
    .strict(),
  z
    .object({
      kind: z.literal("moveNode"),
      target: structureTargetSchema,
      anchor: structureTargetSchema,
      placement: z.enum(["before", "after", "inside"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wrapNodes"),
      targetIds: z.array(z.string().min(1)).min(1),
      autoLayout: z.boolean().optional(),
      wrapperKind: z.enum(["group", "frame"]).optional(),
      sizeHints: z.record(z.string(), structureSizeHintSchema).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("unwrap"), targetId: z.string().min(1) }).strict(),
  structureStyleIntentSchema,
]);

const structureEditSchema = z
  .object({
    kind: z.literal("structure"),
    before: z.string().optional(),
    after: z.string().optional(),
    selectionNodeIds: z.array(z.string().min(1)).min(1).optional(),
    intents: z.array(structureIntentSchema).min(1).optional(),
  })
  .strict()
  .superRefine((edit, context) => {
    const hasSnapshot = edit.before !== undefined || edit.after !== undefined;
    const hasIntents = edit.intents !== undefined;
    if (hasSnapshot === hasIntents) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A structure edit must provide either before and after snapshots or semantic intents.",
      });
    }
    if (
      hasSnapshot &&
      (edit.before === undefined || edit.after === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["before", "after"],
        message: "Structure snapshots require both before and after.",
      });
    }
    if (
      edit.selectionNodeIds &&
      new Set(edit.selectionNodeIds).size !== edit.selectionNodeIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectionNodeIds"],
        message: "Snapshot selection node ids must be unique.",
      });
    }
  })
  .describe(
    "Atomic linked structure edit. Use before/after snapshots or semantic deleteNode, wrapNodes, unwrap, moveNode, and style intents. Auto-layout conversion, Boolean operations, responsive edits, and selector targets are outside this bounded path.",
  );

function durableNodeId(node: CodeLayerNode): string | undefined {
  return node.dataAttributes["data-agent-native-node-id"];
}

function directChildDurableIds(
  projection: ReturnType<typeof buildCodeLayerProjection>,
  targetId: string,
): string[] {
  const matches = projection.nodes.filter((node) =>
    componentNodeIdMatches(node, targetId),
  );
  if (matches.length !== 1) return [];
  const target = matches[0];
  if (!target) return [];
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  return target.children.flatMap((childId) => {
    const child = nodesById.get(childId);
    const nodeId = child ? durableNodeId(child) : undefined;
    return nodeId ? [nodeId] : [];
  });
}

function selectionForStructureIntent(
  intent: SupportedStructureIntent,
  projection: ReturnType<typeof buildCodeLayerProjection>,
  wrapperNodeId?: string,
): string[] | undefined {
  switch (intent.kind) {
    case "deleteNode":
      return [];
    case "moveNode":
      if (!intent.target.nodeId) return [];
      return directNodeDurableIds(projection, [intent.target.nodeId]);
    case "wrapNodes":
      return typeof wrapperNodeId === "string" && wrapperNodeId.trim()
        ? [wrapperNodeId]
        : undefined;
    case "unwrap":
      return directChildDurableIds(projection, intent.targetId);
    default:
      return undefined;
  }
}

function directNodeDurableIds(
  projection: ReturnType<typeof buildCodeLayerProjection>,
  nodeIds: string[],
): string[] {
  return nodeIds.flatMap((nodeId) => {
    const matches = projection.nodes.filter((node) =>
      componentNodeIdMatches(node, nodeId),
    );
    if (matches.length !== 1) return [];
    const durable = durableNodeId(matches[0]!);
    return durable ? [durable] : [];
  });
}

function subtreeDurableNodeIds(
  projection: ReturnType<typeof buildCodeLayerProjection>,
  rootId: string,
): Set<string> {
  const root = projection.nodes.find((node) =>
    componentNodeIdMatches(node, rootId),
  );
  if (!root) return new Set();
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const ids = new Set<string>();
  const visit = (node: CodeLayerNode) => {
    const durable = durableNodeId(node);
    if (durable) ids.add(durable);
    for (const childId of node.children) {
      const child = nodesById.get(childId);
      if (child) visit(child);
    }
  };
  visit(root);
  return ids;
}

function componentArchiveReceipt(args: {
  designId: string;
  nodeId: string;
  fileId: string;
  result: ComponentArchiveMutationResult;
}): Record<string, unknown> {
  return {
    designId: args.designId,
    nodeId: args.nodeId,
    componentId: args.result.componentId,
    persisted: true,
    ctaRequired: false,
    fileId: args.fileId,
    changes: args.result.changes,
    sourceBases: args.result.sourceBases,
    selection: args.result.selection,
    archive: args.result.archive,
    checkpointId: args.result.checkpointId,
    referenceNodeIds: args.result.referenceNodeIds,
  };
}

function componentArchiveFailureReceipt(args: {
  designId: string;
  nodeId: string;
  fileId: string;
  error: unknown;
}): Record<string, unknown> {
  if (!(args.error instanceof ComponentArchiveMutationError)) {
    throw args.error;
  }
  return {
    designId: args.designId,
    nodeId: args.nodeId,
    fileId: args.fileId,
    persisted: false,
    conflict: true,
    transformStatus: args.error.reason,
    error: args.error.message,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape an attribute value for safe inclusion inside a double-quoted HTML
 * attribute. Mirrors the escaping used by the deterministic patcher.
 */
export function escapeAttributeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Set (or replace) a single attribute on the *opening tag* of a component
 * root, using the node's source span. Pure — no DB / IO — so it can be unit
 * tested directly.
 *
 * - When the attribute already exists on the open tag its value is replaced.
 * - Otherwise the attribute is inserted just before the closing `>` / `/>`.
 *
 * Returns the rewritten full HTML and a `changed` flag (false when the span is
 * missing or the rewrite produced an identical open tag).
 */
export function applyRootAttributeEdit(
  html: string,
  source: { openStart: number; openEnd: number } | null | undefined,
  attrName: string,
  attrValue: string,
): { content: string; changed: boolean } {
  if (!source) return { content: html, changed: false };

  const openTag = html.slice(source.openStart, source.openEnd);
  // Replace an existing attribute if present, otherwise insert before the
  // closing `>` or `/>`.
  const attrRe = new RegExp(
    `(\\s${attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>"']+)`,
    "i",
  );
  const escaped = escapeAttributeValue(attrValue);

  let newOpenTag: string;
  if (attrRe.test(openTag)) {
    newOpenTag = openTag.replace(
      attrRe,
      (_match, prefix: string) => `${prefix}"${escaped}"`,
    );
  } else {
    const insertOffset = openTag.endsWith("/>")
      ? openTag.length - 2
      : openTag.length - 1;
    newOpenTag = `${openTag.slice(0, insertOffset)} ${attrName}="${escaped}"${openTag.slice(insertOffset)}`;
  }

  if (newOpenTag === openTag) return { content: html, changed: false };

  return {
    content:
      html.slice(0, source.openStart) + newOpenTag + html.slice(source.openEnd),
    changed: true,
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
    // Pass through the versionHash of the ACTUAL base the transform used
    // (captured by the caller in run() at the same read as `html`, BEFORE
    // applyRootAttributeEdit/applyVisualEdit computed `patchedContent` from
    // it) — not a fresh re-read of the (already-transformed) content here.
    // Re-reading the live/SQL state at persist time and hashing THAT would
    // always match itself trivially, proving nothing about whether a sibling
    // write landed between the transform's base read and this persist call.
    // writeInlineSourceFile re-reads the live text immediately before its own
    // applyText/DB write and rejects it if it no longer matches this hash —
    // closing the race window (the same stale-diff-base bug fixed for
    // insert-design-native-asset.ts / insert-asset.ts / apply-visual-edit.ts).
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

async function persistLinkedComponentEdit(args: {
  designId: string;
  nodeId: string;
  fileId: string;
  edit:
    | ComponentPropertyEdit
    | { kind: "styleBatch"; values: Record<string, string> }
    | {
        kind: "styleTargetsBatch";
        targets: Array<{
          fileId: string;
          nodeId: string;
          styles: Record<string, string>;
        }>;
      }
    | { kind: "resetOverrides" }
    | ComponentStructureEdit;
  expectedFiles: Array<{ fileId: string; versionHash: string }>;
}): Promise<Record<string, unknown>> {
  const workspace = await resolveSourceWorkspace(args.designId, {
    includeContent: true,
    includeBoard: true,
  });
  if (workspace.sourceType !== "inline") {
    return {
      designId: args.designId,
      nodeId: args.nodeId,
      persisted: false,
      ctaRequired: true,
      sourceType: workspace.sourceType,
      error: "Linked component edits require inline design files.",
    };
  }

  const files = workspace.files.filter((file) => file.fileType === "html");
  const expected = new Map(
    args.expectedFiles.map(({ fileId, versionHash }) => [fileId, versionHash]),
  );
  if (
    expected.size !== args.expectedFiles.length ||
    expected.size !== files.length ||
    files.some((file) => !expected.has(file.id))
  ) {
    return {
      designId: args.designId,
      nodeId: args.nodeId,
      persisted: false,
      conflict: true,
      error:
        "The editor's source file set changed. Refresh the design and retry.",
    };
  }

  const liveFiles = await Promise.all(
    files.map(async (file) => ({ file, ...(await readLiveSourceFile(file)) })),
  );
  if (
    liveFiles.some(
      ({ file, versionHash }) => expected.get(file.id) !== versionHash,
    )
  ) {
    return {
      designId: args.designId,
      nodeId: args.nodeId,
      persisted: false,
      conflict: true,
      error:
        "A source file changed since this component edit was prepared. Refresh the design and retry.",
    };
  }

  const documents: ComponentSourceDocument[] = liveFiles.map(
    ({ file, content }) => ({
      source: {
        kind: "design-file",
        designId: args.designId,
        fileId: file.id,
        filename: file.filename,
      },
      content,
    }),
  );
  let transformed: ComponentStructureTransformResult | null = null;
  let selection: LinkedComponentSelection | undefined;
  if (args.edit.kind === "resetOverrides") {
    transformed = resetComponentInstanceOverrides({
      documents,
      instance: { fileId: args.fileId, nodeId: args.nodeId },
    });
  } else if (args.edit.kind === "styleBatch") {
    let currentDocuments = documents;
    let componentId = "";
    const originalByFileId = new Map(
      documents.map((document) => [document.source.fileId!, document]),
    );
    for (const [property, value] of Object.entries(args.edit.values)) {
      const next = applyComponentPropertyEdit({
        documents: currentDocuments,
        target: { fileId: args.fileId, nodeId: args.nodeId },
        edit: { kind: "style", property, value },
      });
      if (next.status !== "updated") {
        transformed = next;
        break;
      }
      componentId = next.componentId;
      const changesByFileId = new Map(
        next.changes.map((change) => [change.fileId, change.after]),
      );
      currentDocuments = currentDocuments.map((document) => ({
        ...document,
        content:
          changesByFileId.get(document.source.fileId ?? "") ?? document.content,
      }));
    }
    if (!transformed) {
      transformed = {
        status: "updated",
        componentId,
        changes: currentDocuments.flatMap((document) => {
          const fileId = document.source.fileId ?? "";
          const before = originalByFileId.get(fileId)?.content;
          return before === undefined || before === document.content
            ? []
            : [
                {
                  fileId,
                  source: document.source,
                  before,
                  after: document.content,
                },
              ];
        }),
      };
    }
  } else if (args.edit.kind === "styleTargetsBatch") {
    transformed = applyComponentStyleTargetsEdit({
      documents,
      targets: args.edit.targets,
    });
  } else if (args.edit.kind === "structure") {
    const targetDocument = documents.find(
      (document) => document.source.fileId === args.fileId,
    );
    if (!targetDocument) {
      transformed = { status: "missing-file", fileId: args.fileId };
    } else if ("intents" in args.edit) {
      const mainBefore = targetDocument.content;
      let mainAfter = mainBefore;
      let selectedNodeIds: string[] | undefined;

      for (const rawIntent of args.edit.intents) {
        const intent = rawIntent as SupportedStructureIntent;
        const beforeProjection = buildCodeLayerProjection(mainAfter, {
          source: targetDocument.source,
        });
        const patch = applyComponentStructureIntent({
          content: mainAfter,
          intent,
          source: targetDocument.source,
        });
        if (patch.result.status !== "applied") {
          transformed = {
            status: "edit-refused",
            fileId: args.fileId,
            nodeId: args.nodeId,
            message:
              patch.result.message ??
              `Structural intent ${intent.kind} was refused.`,
          };
          break;
        }
        const nextSelection = selectionForStructureIntent(
          intent,
          beforeProjection,
          patch.result.wrapperNodeId,
        );
        if (intent.kind === "wrapNodes" && !nextSelection) {
          transformed = {
            status: "edit-refused",
            fileId: args.fileId,
            nodeId: args.nodeId,
            message:
              "The structural wrapper did not receive a durable node id.",
          };
          break;
        }
        if (intent.kind === "unwrap" && nextSelection) {
          selectedNodeIds = [
            ...new Set([...(selectedNodeIds ?? []), ...nextSelection]),
          ];
        } else {
          selectedNodeIds = nextSelection ?? selectedNodeIds;
        }
        mainAfter = patch.content;
      }

      if (!transformed) {
        if (selectedNodeIds) {
          const finalProjection = buildCodeLayerProjection(mainAfter, {
            source: targetDocument.source,
          });
          const validIds = subtreeDurableNodeIds(finalProjection, args.nodeId);
          if (selectedNodeIds.some((nodeId) => !validIds.has(nodeId))) {
            transformed = {
              status: "edit-refused",
              fileId: args.fileId,
              nodeId: args.nodeId,
              message:
                "The structural edit returned a selection outside its canonical component subtree.",
            };
          }
        }
      }

      if (!transformed) {
        transformed = applyComponentStructureEdit({
          documents,
          target: { fileId: args.fileId, nodeId: args.nodeId },
          mainBefore,
          mainAfter,
        });
        if (transformed.status === "updated" && selectedNodeIds) {
          selection = { fileId: args.fileId, nodeIds: selectedNodeIds };
        }
      }
    } else {
      const mainBefore = args.edit.before;
      const mainAfter = args.edit.after;
      const snapshotSelection = args.edit.selectionNodeIds;
      if (snapshotSelection) {
        const finalProjection = buildCodeLayerProjection(mainAfter, {
          source: targetDocument.source,
        });
        const validIds = subtreeDurableNodeIds(finalProjection, args.nodeId);
        if (snapshotSelection.some((nodeId) => !validIds.has(nodeId))) {
          transformed = {
            status: "edit-refused",
            fileId: args.fileId,
            nodeId: args.nodeId,
            message:
              "The snapshot selection is outside its canonical component subtree.",
          };
        }
      }
      if (!transformed) {
        transformed = applyComponentStructureEdit({
          documents,
          target: { fileId: args.fileId, nodeId: args.nodeId },
          mainBefore,
          mainAfter,
        });
        if (transformed.status === "updated" && snapshotSelection) {
          selection = { fileId: args.fileId, nodeIds: snapshotSelection };
        }
      }
    }
  } else {
    transformed = applyComponentPropertyEdit({
      documents,
      target: { fileId: args.fileId, nodeId: args.nodeId },
      edit: args.edit,
    });
  }
  if (transformed.status !== "updated") {
    return {
      designId: args.designId,
      nodeId: args.nodeId,
      persisted: false,
      transformStatus: transformed.status,
      error:
        transformed.message ??
        `Linked component edit failed: ${transformed.status}.`,
    };
  }

  const updated = new Map(
    transformed.changes.map((change) => [change.fileId, change.after]),
  );
  const fileById = new Map(liveFiles.map(({ file }) => [file.id, file]));
  const batches = liveFiles.map(({ file, content, versionHash }) => ({
    file: { ...file, content },
    content: updated.get(file.id) ?? content,
    expectedVersionHash: versionHash,
  }));
  const entered = [...files].map((file) => file.id).sort();
  for (const id of entered) agentEnterDocument(id);
  try {
    const persisted = await writeInlineSourceFilesBatch({
      designId: args.designId,
      files: batches,
      expectedHtmlFileIds: liveFiles.map(({ file }) => file.id),
    });
    const persistedById = new Map(
      persisted.files.map((file) => [file.id, file]),
    );
    const changes = transformed.changes.map((change) => {
      const file = persistedById.get(change.fileId);
      return {
        ...change,
        beforeVersionHash: sourceContentHash(change.before),
        afterVersionHash: file?.versionHash,
        updatedAt: file?.updatedAt,
      };
    });
    const sourceBases = persisted.files.map((file) => ({
      fileId: file.id,
      versionHash: file.versionHash,
      updatedAt: file.updatedAt,
    }));
    const targetFile = fileById.get(args.fileId);
    const targetDocument = documents.find(
      ({ source }) => source.fileId === args.fileId,
    );
    const targetNode = targetDocument
      ? buildCodeLayerProjection(targetDocument.content, {
          source: targetDocument.source,
        }).nodes.find((node) => componentNodeIdMatches(node, args.nodeId))
      : undefined;
    if (targetFile && targetNode) {
      agentUpdateSelection(args.fileId, {
        selection: agentSelectionDescriptor(
          { nodeId: args.nodeId, selector: targetNode.selector },
          "Editing component",
        ),
        nodeId: args.nodeId,
        editingFile: targetFile.filename,
        designId: args.designId,
      });
    }
    return {
      designId: args.designId,
      nodeId: args.nodeId,
      componentId: transformed.componentId,
      persisted: changes.length > 0,
      ctaRequired: false,
      fileId: args.fileId,
      changes,
      sourceBases,
      ...(selection ? { selection } : {}),
    };
  } finally {
    for (const id of entered) agentLeaveDocument(id);
  }
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Persist a component prop edit to the design source. " +
    "For inline/Alpine designs, edits the data-agent-native-prop-* attributes, " +
    "x-data expression, or class list of the component root via the deterministic " +
    "HTML-patch path (same seam as apply-visual-edit). " +
    "For real-app sources, returns ctaRequired=true without modifying any file; " +
    "compiled source requires a dedicated consented bridge transform. " +
    "The structure variant atomically propagates bounded delete, wrap, unwrap, " +
    "move, and style intents across linked HTML files; unsupported structural " +
    "operations fail before any file is written. " +
    "The deleteMain and restoreMain variants archive or restore a canonical " +
    "component main across all linked HTML files.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe("data-agent-native-node-id of the component root to edit"),
    fileId: z
      .string()
      .optional()
      .describe("Design file id; defaults to index.html"),
    edit: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("alpineData"),
          value: z
            .string()
            .describe(
              "New x-data expression, e.g. \"{ variant: 'outline', size: 'lg' }\"",
            ),
        }),
        z.object({
          kind: z.literal("attribute"),
          attribute: z
            .string()
            // Strict identifier only. Blocks injecting a second attribute /
            // event handler via the *name* (the value is escaped, the name was
            // not). Rejects spaces, quotes, `=`, `>` and any `on*` handler.
            .regex(
              /^(?!on)[a-zA-Z][a-zA-Z0-9:_.-]*$/i,
              "Unsafe HTML attribute name: only identifier characters are allowed and event handlers (on*) are rejected.",
            )
            .describe("HTML attribute name to set"),
          value: z.string().describe("New attribute value"),
        }),
        z.object({
          kind: z.literal("classReplace"),
          from: z.string().describe("Existing Tailwind class to remove"),
          to: z.string().describe("Replacement Tailwind class to add"),
        }),
        z.object({
          kind: z.literal("style"),
          property: z.string().min(1),
          value: z.string(),
        }),
        z.object({
          kind: z.literal("styleBatch"),
          values: z
            .record(z.string(), z.string())
            .refine((values) => Object.keys(values).length > 0),
        }),
        z.object({
          kind: z.literal("styleTargetsBatch"),
          targets: z
            .array(
              z.object({
                fileId: z.string().min(1),
                nodeId: z.string().min(1),
                styles: z
                  .record(z.string(), z.string())
                  .refine((styles) => Object.keys(styles).length > 0),
              }),
            )
            .min(1),
        }),
        z.object({
          kind: z.literal("textContent"),
          value: z.string(),
        }),
        z.object({
          kind: z.literal("layerName"),
          value: z.string(),
        }),
        z.object({ kind: z.literal("resetOverrides") }),
        z
          .object({
            kind: z.literal("deleteMain"),
            deletionGeometry: componentDeletionGeometrySchema.optional(),
          })
          .strict(),
        z.object({ kind: z.literal("restoreMain") }).strict(),
        structureEditSchema,
      ])
      .describe("The prop edit to apply"),
    source: z
      .object({
        currentContent: z
          .string()
          .optional()
          .describe(
            "Latest editor HTML snapshot. Used to compose rapid sequential prop edits before collab persistence catches up.",
          ),
        revision: z
          .string()
          .optional()
          .describe(
            "design_files.updatedAt value the currentContent is based on.",
          ),
        expectedFiles: z
          .array(
            z.object({
              fileId: z.string().min(1),
              versionHash: z.string().min(1),
            }),
          )
          .min(1)
          .optional()
          .describe(
            "Exact source version hashes for every HTML file in the Design. Required for linked property and structure edits.",
          ),
      })
      .optional(),
  }),
  run: async ({ designId, nodeId, fileId, edit, source }, context) => {
    // ── Access check ────────────────────────────────────────────────────────
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    // ── Source type gate ────────────────────────────────────────────────────
    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);

    // Fail closed for every real-app tier even if its generic capability map
    // advertises applyEdit. This action only knows how to patch SQL-backed HTML;
    // allowing localhost through here could report success for the mirror while
    // leaving the real JSX/TSX file untouched. A future compiled-source action
    // must perform consent, canonical path resolution, AST anchoring, and an
    // expected-version bridge write as one dedicated transaction.
    if (sourceType !== "inline") {
      return {
        designId,
        nodeId,
        sourceType,
        persisted: false,
        ctaRequired: true,
        ctaMessage:
          "Prop write-back to real app sources requires a dedicated consented, " +
          "version-guarded compiled-source transform. " +
          "Use preview-component-prop-edit to preview without persisting.",
      };
    }

    await assertAccess("design", designId, "editor");

    if (edit.kind === "deleteMain" || edit.kind === "restoreMain") {
      if (!fileId || !source?.expectedFiles) {
        return {
          designId,
          nodeId,
          persisted: false,
          conflict: true,
          error:
            "Component archive edits require the target file and exact source versions. Refresh the design and retry.",
        };
      }
      const expectedTarget = source.expectedFiles.find(
        (expected) => expected.fileId === fileId,
      );
      if (!expectedTarget) {
        return {
          designId,
          nodeId,
          persisted: false,
          conflict: true,
          error:
            "The target file is missing from the expected source version set. Refresh the design and retry.",
        };
      }
      try {
        const result =
          edit.kind === "deleteMain"
            ? await deleteComponentMainFromDesign({
                designId,
                fileId,
                mainNodeId: nodeId,
                expectedVersionHash: expectedTarget.versionHash,
                expectedFiles: source.expectedFiles,
                ...(edit.deletionGeometry
                  ? { deletionGeometry: edit.deletionGeometry }
                  : {}),
              })
            : await restoreComponentMainInDesign({
                designId,
                fileId,
                instanceNodeId: nodeId,
                expectedVersionHash: expectedTarget.versionHash,
                expectedFiles: source.expectedFiles,
              });
        return componentArchiveReceipt({
          designId,
          nodeId,
          fileId,
          result,
        });
      } catch (error) {
        return componentArchiveFailureReceipt({
          designId,
          nodeId,
          fileId,
          error,
        });
      }
    }

    await snapshotDesignBeforeAgentEdit(designId, context);
    const db = getDb();

    if (edit.kind === "styleTargetsBatch") {
      const firstTarget = edit.targets[0];
      const targetKeys = edit.targets.map(
        (target) => `${target.fileId}\u0000${target.nodeId}`,
      );
      if (
        !fileId ||
        firstTarget?.fileId !== fileId ||
        firstTarget.nodeId !== nodeId ||
        new Set(targetKeys).size !== targetKeys.length
      ) {
        return {
          designId,
          nodeId,
          persisted: false,
          error:
            "The selected style targets are incomplete or duplicated. Refresh and retry.",
        };
      }
    }

    if (
      edit.kind === "style" ||
      edit.kind === "styleBatch" ||
      edit.kind === "styleTargetsBatch" ||
      edit.kind === "textContent" ||
      edit.kind === "layerName" ||
      edit.kind === "resetOverrides" ||
      edit.kind === "structure"
    ) {
      if (!fileId || !source?.expectedFiles) {
        return {
          designId,
          nodeId,
          persisted: false,
          conflict: true,
          error:
            "Linked edits require the target file and exact source versions. Refresh the design and retry.",
        };
      }
      const linkedEdit:
        | ComponentPropertyEdit
        | { kind: "styleBatch"; values: Record<string, string> }
        | {
            kind: "styleTargetsBatch";
            targets: Array<{
              fileId: string;
              nodeId: string;
              styles: Record<string, string>;
            }>;
          }
        | { kind: "resetOverrides" }
        | ComponentStructureEdit =
        edit.kind === "style" ||
        edit.kind === "textContent" ||
        edit.kind === "layerName"
          ? edit
          : edit.kind === "styleBatch" || edit.kind === "styleTargetsBatch"
            ? edit
            : edit.kind === "structure"
              ? (edit as ComponentStructureEdit)
              : { kind: "resetOverrides" };
      return persistLinkedComponentEdit({
        designId,
        nodeId,
        fileId,
        edit: linkedEdit,
        expectedFiles: source.expectedFiles,
      });
    }

    // ── Fetch file ───────────────────────────────────────────────────────────
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

    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename,
      fileType: "html",
      content: file.content,
      createdAt: null,
      updatedAt: file.updatedAt,
    };
    let prepared: Awaited<ReturnType<typeof prepareInlineSourceEdit>>;
    try {
      prepared = await prepareInlineSourceEdit({
        file: workspaceFile,
        currentContent: source?.currentContent,
        revision: source?.revision,
      });
    } catch (error) {
      if (!(error instanceof SourceWorkspaceEditConflictError)) throw error;
      return {
        designId,
        nodeId,
        persisted: false,
        conflict: true,
        fileId: file.id,
        filename: file.filename,
        error:
          "This file changed since this component prop edit was prepared. Refresh the editor and try again.",
      };
    }

    // The transform runs against the caller's working copy (when supplied),
    // while the persist CAS uses the live hash that working copy is allowed to
    // replace. Keeping those identities separate preserves rapid unsaved prop
    // edits without weakening concurrent-writer rejection.
    const html = prepared.content;
    const baseVersionHash = prepared.expectedVersionHash;

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

    // ── Apply the edit ───────────────────────────────────────────────────────
    // - alpineData / attribute: attribute mutations on the component root are
    //   applied with a direct HTML splice using the node's source span — the
    //   deterministic patcher is class/style/text focused.
    // - classReplace: routed through the deterministic apply-visual-edit
    //   patcher (same seam as all other class edits).

    let patchedContent = html;
    let changed = false;

    if (edit.kind === "alpineData" || edit.kind === "attribute") {
      const attrName = edit.kind === "alpineData" ? "x-data" : edit.attribute;
      const result = applyRootAttributeEdit(
        html,
        node.source,
        attrName,
        edit.value,
      );
      patchedContent = result.content;
      changed = result.changed;
    } else {
      // classReplace — use the deterministic patcher for class edits.
      const intent: ClassEditIntent = {
        kind: "class",
        target: { nodeId },
        operation: "replace",
        from: edit.from,
        to: edit.to,
      };
      const patch = applyVisualEdit(html, intent, { source: codeLayerSource });
      if (patch.result.status === "applied" && patch.result.changed) {
        patchedContent = patch.content;
        changed = true;
      }
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const shouldPersist = changed || patchedContent !== (file.content ?? "");

    if (shouldPersist) {
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
          "Editing component",
        ),
        nodeId,
        editingFile: file.filename,
        designId: file.designId,
      });
      return {
        designId,
        nodeId,
        componentName,
        sourceType,
        editKind: edit.kind,
        persisted: shouldPersist,
        ctaRequired: false,
        fileId: file.id,
        filename: file.filename,
        updatedAt,
        content: patchedContent,
        bytesBefore: html.length,
        bytesAfter: patchedContent.length,
        note: "Edit applied and persisted via the deterministic HTML-patch path.",
      };
    }

    return {
      designId,
      nodeId,
      componentName,
      sourceType,
      editKind: edit.kind,
      persisted: shouldPersist,
      ctaRequired: false,
      fileId: file.id,
      filename: file.filename,
      content: patchedContent,
      bytesBefore: html.length,
      bytesAfter: patchedContent.length,
      note: shouldPersist
        ? "Edit applied and persisted via the deterministic HTML-patch path."
        : "No change applied — the edit produced the same result as the current content.",
    };
  },
});
