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
 * `applyEdit` source capability (bridge write hardening).  Until that lands the
 * action returns a `ctaRequired: true` response and does not modify any source.
 *
 * See DESIGN-STUDIO-PLAN.md §6.1, §7 (preview/apply contract), §11 phase 2.
 */

import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
  applyText,
  getText,
  hasCollabState,
  seedFromText,
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
import { componentNameFor } from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { normalizeDesignSourceType } from "../shared/source-mode.js";

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

async function persistEdit(file: {
  id: string;
  designId: string;
  content: string;
}): Promise<void> {
  await assertAccess("design", file.designId, "editor");
  const db = getDb();
  const now = new Date().toISOString();

  agentEnterDocument(file.id);
  try {
    await db
      .update(schema.designFiles)
      .set({ content: file.content, updatedAt: now })
      .where(eq(schema.designFiles.id, file.id));

    if (await hasCollabState(file.id)) {
      await applyText(file.id, file.content, "content", "agent");
    } else {
      await seedFromText(file.id, file.content);
    }

    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, file.designId));
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
  }),
  run: async ({ designId, nodeId, fileId, edit }) => {
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

    const node = projection.nodes.find((n) => n.id === nodeId);
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

    // ── Build edit intent ────────────────────────────────────────────────────
    // Map the component prop edit kind to an EditIntent that apply-visual-edit
    // understands.  We use the same deterministic patch path for all kinds.

    const target = { nodeId };

    let intent: ClassEditIntent | StyleEditIntent;

    if (edit.kind === "alpineData") {
      // x-data is not a standard CSS property or Tailwind class — we write it
      // as a style-like "attribute" edit by embedding it in the class edit path
      // via the `set` operation on a synthetic class string.  Because the HTML
      // patcher writes raw attribute values we use the attribute-set approach
      // that `apply-visual-edit` already supports through the `style` path
      // (targeting `x-data` as a custom property in an inline `style`
      // attribute would corrupt the DOM, so instead we encode the value in a
      // `data-agent-native-alpine-data` attribute and let the bridge pick it
      // up).  For maximum compatibility with the existing apply-visual-edit
      // path we use a class operation to manipulate the x-data value through a
      // well-known pattern the bridge understands.
      //
      // The cleanest path is to write `data-agent-native-alpine-data` as an
      // attribute so the iframe bridge can relay it to Alpine as the effective
      // x-data — but since the bridge postMessage layer handles x-data edits
      // on preview, for the persist path we do a direct HTML attribute patch.
      // We accomplish this by treating it as a `style` edit on a sentinel
      // property that the patcher will place as an attribute.  However the
      // current patcher only handles CSS properties, so we write the x-data
      // value through the attribute approach: stamp `data-agent-native-prop-x-data`.
      intent = {
        kind: "class",
        target,
        // Use the `set` operation with a minimal token list to mark the node's
        // Alpine data without touching real layout classes.  The actual x-data
        // attribute is written below via a direct HTML splice.
        operation: "add",
        className: `data-[x-data=${JSON.stringify(edit.value)}]:hidden`, // sentinel (will not apply visually)
      } as ClassEditIntent;
      // Fall through to the direct HTML splice below.
    } else if (edit.kind === "classReplace") {
      intent = {
        kind: "class",
        target,
        operation: "replace",
        from: edit.from,
        to: edit.to,
      } as ClassEditIntent;
    } else {
      // attribute kind — write as a class add of a data-attribute sentinel so
      // the existing patcher path handles it, then fall through to the direct
      // splice for the actual attribute patch.
      intent = {
        kind: "class",
        target,
        operation: "add",
        className: `data-[prop-${edit.attribute}]:hidden`, // sentinel
      } as ClassEditIntent;
    }

    // ── Direct HTML splice for attribute edits (alpineData + attribute) ──────
    // The existing apply-visual-edit patcher is class/style/text focused.  For
    // attribute mutations on the component root we splice the raw HTML directly
    // using the node's source span (the same technique the patcher uses for
    // attribute stamping).

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
    } else if (edit.kind === "classReplace") {
      // Use the deterministic patcher for class edits.
      const patch = applyVisualEdit(html, intent, { source: codeLayerSource });
      if (patch.result.status === "applied" && patch.result.changed) {
        patchedContent = patch.content;
        changed = true;
      }
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    if (changed) {
      await persistEdit({
        id: file.id,
        designId: file.designId,
        content: patchedContent,
      });

      agentUpdateSelection(file.id, {
        selection: node.selector,
        nodeId,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    return {
      designId,
      nodeId,
      componentName,
      sourceType,
      editKind: edit.kind,
      persisted: changed,
      ctaRequired: false,
      fileId: file.id,
      filename: file.filename,
      bytesBefore: html.length,
      bytesAfter: patchedContent.length,
      note: changed
        ? "Edit applied and persisted via the deterministic HTML-patch path."
        : "No change applied — the edit produced the same result as the current content.",
    };
  },
});
