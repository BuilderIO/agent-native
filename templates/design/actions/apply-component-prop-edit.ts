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
import type { CodeLayerSource, ClassEditIntent } from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import {
  applyComponentPropertyEdit,
  linkedComponentRootForNode,
  resetComponentInstanceOverrides,
  type ComponentPropertyEdit,
  type ComponentPropertyTransformResult,
  type ComponentSourceDocument,
} from "../shared/component-links.js";
import {
  componentNameFor,
  componentNodeIdMatches,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import { sourceContentHash } from "../shared/source-workspace.js";

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
    | { kind: "resetOverrides" };
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
  let transformed: ComponentPropertyTransformResult | null = null;
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
    let currentDocuments = documents;
    let componentId = "";
    for (const target of args.edit.targets) {
      const targetDocument = currentDocuments.find(
        (document) => document.source.fileId === target.fileId,
      );
      if (!targetDocument) {
        transformed = { status: "missing-file", fileId: target.fileId };
        break;
      }
      const projection = buildCodeLayerProjection(targetDocument.content, {
        source: targetDocument.source,
      });
      const node = projection.nodes.find((candidate) =>
        componentNodeIdMatches(candidate, target.nodeId),
      );
      if (!node) {
        transformed = {
          status: "missing-node",
          fileId: target.fileId,
          nodeId: target.nodeId,
        };
        break;
      }
      const linked = linkedComponentRootForNode(node, projection) !== null;
      for (const [property, value] of Object.entries(target.styles)) {
        if (linked) {
          const next = applyComponentPropertyEdit({
            documents: currentDocuments,
            target: { fileId: target.fileId, nodeId: target.nodeId },
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
              changesByFileId.get(document.source.fileId ?? "") ??
              document.content,
          }));
        } else {
          const targetSource = currentDocuments.find(
            (document) => document.source.fileId === target.fileId,
          )!;
          const patch = applyVisualEdit(
            targetSource.content,
            {
              kind: "style",
              target: { nodeId: target.nodeId },
              property,
              value,
            },
            { source: targetSource.source },
          );
          if (patch.result.status !== "applied") {
            transformed = {
              status: "edit-refused",
              fileId: target.fileId,
              nodeId: target.nodeId,
              message: patch.result.message,
            };
            break;
          }
          currentDocuments = currentDocuments.map((document) =>
            document.source.fileId === target.fileId
              ? { ...document, content: patch.content }
              : document,
          );
        }
      }
      if (transformed) break;
    }
    if (!transformed && !componentId) {
      const firstTarget = args.edit.targets[0];
      transformed = {
        status: "not-linked",
        fileId: firstTarget?.fileId,
        nodeId: firstTarget?.nodeId,
      };
    }
    if (!transformed) {
      const originalByFileId = new Map(
        documents.map((document) => [document.source.fileId!, document]),
      );
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
    "compiled source requires a dedicated consented bridge transform.",
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
            "Exact source version hashes for every HTML file in the Design. Required for linked property edits.",
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
      edit.kind === "resetOverrides"
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
        | { kind: "resetOverrides" } =
        edit.kind === "style" ||
        edit.kind === "textContent" ||
        edit.kind === "layerName"
          ? edit
          : edit.kind === "styleBatch" || edit.kind === "styleTargetsBatch"
            ? edit
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
