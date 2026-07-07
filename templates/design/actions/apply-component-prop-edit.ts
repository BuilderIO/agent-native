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
 * **Tier B (real-app, localhost / fusion):**  prop writes require the
 * `applyEdit` source capability.  Localhost sources have it (design bridge +
 * user write consent); fusion sources gain it after bridge hardening.  For
 * sources without it the action returns a `ctaRequired: true` response and
 * does not modify any source.
 *
 * See DESIGN-STUDIO-PLAN.md §6.1, §7 (preview/apply contract), §11 phase 2.
 */

import { defineAction } from "@agent-native/core";
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
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
} from "../shared/code-layer.js";
import type {
  CodeLayerSource,
  ClassEditIntent,
  StyleEditIntent,
} from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import {
  componentNameFor,
  componentNodeIdMatches,
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { normalizeDesignSourceType } from "../shared/source-mode.js";
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
    newOpenTag = openTag.replace(attrRe, `$1"${escaped}"`);
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

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Persist a component prop edit to the design source. " +
    "For inline/Alpine designs, edits the data-agent-native-prop-* attributes, " +
    "x-data expression, or class list of the component root via the deterministic " +
    "HTML-patch path (same seam as apply-visual-edit). " +
    "For real-app sources, the applyEdit capability must be available; if not, " +
    "returns ctaRequired=true without modifying any file.",
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
      })
      .optional(),
  }),
  run: async ({ designId, nodeId, fileId, edit, source }) => {
    const db = getDb();

    // ── Access check ────────────────────────────────────────────────────────
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    // ── Source type + capability gate ────────────────────────────────────────
    let rawSourceType: unknown = "inline";
    const rawData = (access.resource as { data?: unknown }).data;
    if (typeof rawData === "string") {
      try {
        const parsed: unknown = JSON.parse(rawData);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "sourceType" in (parsed as object)
        ) {
          rawSourceType = (parsed as { sourceType: unknown }).sourceType;
        }
      } catch {
        // Default to inline.
      }
    }

    const sourceType = normalizeDesignSourceType(rawSourceType) ?? "inline";
    const caps = resolveSourceCapabilities(sourceType);

    // Real-app sources gate on `applyEdit` (bridge write hardening).
    if (sourceType !== "inline" && !hasCapability(caps, "applyEdit")) {
      return {
        designId,
        nodeId,
        sourceType,
        persisted: false,
        ctaRequired: true,
        ctaMessage:
          "Prop write-back to real app sources requires the bridge applyEdit " +
          "capability, which lands with bridge write hardening. " +
          "Use preview-component-prop-edit to preview without persisting.",
      };
    }

    await assertAccess("design", designId, "editor");

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

    if (
      source?.currentContent &&
      source.revision &&
      file.updatedAt &&
      source.revision !== file.updatedAt
    ) {
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

    // Prefer explicit editor content after the caller's revision check, and use
    // the saved SQL content as the fallback. Collab/Yjs reads can be stale
    // across local dev worker processes and make prop controls lag behind.
    const html =
      typeof source?.currentContent === "string"
        ? source.currentContent
        : (file.content ?? "");
    // Capture the hash of this EXACT base — the same string the transform
    // below reads from — so persistEdit can pass it through as
    // expectedVersionHash. A re-read at persist time would hash whatever is
    // live "then" instead of proving this base is still current.
    const baseVersionHash = sourceContentHash(html);

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
