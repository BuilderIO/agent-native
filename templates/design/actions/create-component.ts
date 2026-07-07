/**
 * create-component — convert a selected element into a reusable component.
 *
 * Stamps the deterministic component-instance annotations on the selected node
 * so the rest of the Design Studio (component-model detection, the canvas
 * component outline, and the contextual Component inspector section) recognises
 * it as a component instance:
 *
 * - `data-agent-native-component="<Name>"` marks the node as a component root.
 * - `data-agent-native-prop-<name>="<value>"` is stamped for any obvious
 *   variant-like attributes already on the node (e.g. `data-variant`,
 *   `data-size`, `data-state`, `aria-pressed`) so the Component section shows
 *   prop controls immediately.
 *
 * Writes go through the same deterministic raw-HTML attribute-splice path used
 * by `apply-component-prop-edit` (the `replace-document-content` + Yjs/collab
 * seam shared by every HTML write), so the change persists into SQL and the
 * collab document together.
 *
 * **Tier A (Alpine / inline):**  always available — the design HTML is the
 * source of truth.
 *
 * **Tier B (real-app, localhost / fusion):**  source writes require the
 * `applyEdit` capability (bridge write hardening). Until that lands the action
 * returns `ctaRequired: true` without modifying any source.
 *
 * See DESIGN-STUDIO-PLAN.md §6.1 (component model) and §7 (action surface).
 */

import { defineAction } from "@agent-native/core";
import { agentUpdateSelection } from "@agent-native/core/collab";
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
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerNode, CodeLayerSource } from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import {
  COMPONENT_NAME_ATTR,
  COMPONENT_PROP_PREFIX,
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { normalizeDesignSourceType } from "../shared/source-mode.js";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * A single attribute to stamp onto the component root.
 */
export interface ComponentAttributeStamp {
  name: string;
  value: string;
}

/** Attributes that commonly carry variant-like meaning on an element. */
const VARIANT_LIKE_DATA_ATTRS = [
  "data-variant",
  "data-size",
  "data-state",
  "data-color",
  "data-tone",
  "data-intent",
] as const;

/** ARIA attributes that map cleanly to a boolean/value prop. */
const VARIANT_LIKE_ARIA_ATTRS = [
  "aria-pressed",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
] as const;

/** Normalize a component name into a safe PascalCase-ish identifier. */
export function normalizeComponentName(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return cleaned || "Component";
}

/** Convert a kebab-case attribute suffix to a camelCase prop name. */
function attrSuffixToPropName(suffix: string): string {
  return suffix.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Derive the `data-agent-native-prop-*` stamps to apply when promoting a node
 * to a component, based on obvious variant-like attributes already present on
 * the node.  Pure — operates on a `CodeLayerNode`'s attribute maps.
 *
 * Returns one stamp per recognised variant-like attribute; never includes the
 * component-name attribute itself or any pre-existing prop attribute.
 */
export function deriveComponentPropStamps(
  node: Pick<CodeLayerNode, "dataAttributes" | "attributes">,
): ComponentAttributeStamp[] {
  const stamps: ComponentAttributeStamp[] = [];
  const seen = new Set<string>();

  const push = (propName: string, value: string) => {
    const key = propName.toLowerCase();
    if (!propName || seen.has(key)) return;
    seen.add(key);
    stamps.push({
      name: `${COMPONENT_PROP_PREFIX}${propName}`,
      value,
    });
  };

  // data-variant / data-size / data-state / ... → prop name without "data-".
  for (const attr of VARIANT_LIKE_DATA_ATTRS) {
    const value = node.dataAttributes[attr];
    if (typeof value === "string" && value.trim()) {
      push(attrSuffixToPropName(attr.slice("data-".length)), value.trim());
    }
  }

  // aria-pressed / aria-selected / ... → prop name without "aria-".
  for (const attr of VARIANT_LIKE_ARIA_ATTRS) {
    const raw = node.attributes[attr];
    const value = raw === true ? "true" : raw;
    if (typeof value === "string" && value.trim()) {
      push(attrSuffixToPropName(attr.slice("aria-".length)), value.trim());
    }
  }

  return stamps;
}

/** Escape a raw attribute value for safe insertion inside double quotes. */
function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Splice a `name="value"` attribute into an opening tag string, replacing the
 * attribute if it already exists.  Pure string helper mirroring the technique
 * used by `apply-component-prop-edit`.
 */
export function setAttributeOnOpenTag(
  openTag: string,
  name: string,
  value: string,
): string {
  const attrRe = new RegExp(
    `(\\s${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>"']+)`,
    "i",
  );
  const escaped = escapeAttrValue(value);
  if (attrRe.test(openTag)) {
    return openTag.replace(attrRe, `$1"${escaped}"`);
  }
  const insertOffset = openTag.endsWith("/>")
    ? openTag.length - 2
    : openTag.length - 1;
  return `${openTag.slice(0, insertOffset)} ${name}="${escaped}"${openTag.slice(insertOffset)}`;
}

/**
 * Stamp the component-name attribute plus prop stamps onto the node's opening
 * tag within `html`, returning the patched HTML.  Returns the original HTML
 * unchanged when the node has no resolvable source span.
 */
export function applyComponentAnnotations(
  html: string,
  node: Pick<CodeLayerNode, "source">,
  componentName: string,
  propStamps: ComponentAttributeStamp[],
): { content: string; changed: boolean } {
  const src = node.source;
  if (!src) return { content: html, changed: false };

  let openTag = html.slice(src.openStart, src.openEnd);
  const before = openTag;

  openTag = setAttributeOnOpenTag(openTag, COMPONENT_NAME_ATTR, componentName);
  for (const stamp of propStamps) {
    openTag = setAttributeOnOpenTag(openTag, stamp.name, stamp.value);
  }

  if (openTag === before) return { content: html, changed: false };
  return {
    content: html.slice(0, src.openStart) + openTag + html.slice(src.openEnd),
    changed: true,
  };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Promote a selected element into a reusable component by stamping the " +
    "deterministic component-instance annotations on its root node: " +
    'data-agent-native-component="<Name>" plus data-agent-native-prop-* for ' +
    "obvious variant-like attributes (data-variant/size/state, aria-pressed, " +
    "etc.). For inline/Alpine designs this writes the HTML directly via the " +
    "deterministic patch path. For real-app sources the applyEdit capability " +
    "must be available; otherwise returns ctaRequired=true without modifying " +
    "any file. After it runs the node is a recognised component instance, so " +
    "component-model detection, the canvas outline, and the Component section " +
    "all pick it up.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .optional()
      .describe(
        "data-agent-native-node-id (code-layer node id) of the element to promote. Provide nodeId or selector.",
      ),
    selector: z
      .string()
      .optional()
      .describe(
        "CSS selector for the element to promote. Used when nodeId is not available.",
      ),
    name: z
      .string()
      .min(1)
      .describe(
        'Component name, e.g. "PrimaryButton". Normalized to PascalCase.',
      ),
    fileId: z
      .string()
      .optional()
      .describe("Design file id; defaults to index.html"),
  }),
  run: async ({ designId, nodeId, selector, name, fileId }) => {
    if (!nodeId && !selector) {
      throw new Error(
        "Provide either nodeId or selector for the element to promote.",
      );
    }

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
        sourceType,
        persisted: false,
        ctaRequired: true,
        ctaMessage:
          "Creating a component from a real-app source requires the bridge " +
          "applyEdit capability, which lands with bridge write hardening.",
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

    // Read the LIVE base (collab text when present, else the SQL row) right
    // before transforming, and carry its versionHash through to the write
    // below. writeInlineSourceFile re-reads the live text immediately before
    // its own applyText/DB write and rejects if it no longer matches this
    // hash — closing the race window where a concurrent editor/agent write
    // lands between this read and the persist (the same stale-diff-base bug
    // fixed for insert-design-native-asset.ts and insert-asset.ts: a diff/patch
    // computed from a stale base, unconditionally persisted, corrupts or
    // drops the other writer's change).
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename ?? "",
      fileType: "html",
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };
    const live = await readLiveSourceFile(workspaceFile);
    const html = live.content;

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

    const node = nodeId
      ? projection.nodes.find((n) => n.id === nodeId)
      : projection.nodes.find(
          (n) =>
            n.selector === selector || n.selectors.includes(selector ?? ""),
        );

    if (!node) {
      throw new Error(
        `Element not found. Run get-code-layer-projection to list current node ids and selectors.`,
      );
    }

    // ── Build annotations ─────────────────────────────────────────────────────
    const componentName = normalizeComponentName(name);
    const propStamps = deriveComponentPropStamps(node);
    const { content: patchedContent, changed } = applyComponentAnnotations(
      html,
      node,
      componentName,
      propStamps,
    );

    // ── Persist ──────────────────────────────────────────────────────────────
    if (changed) {
      await writeInlineSourceFile({
        designId: file.designId,
        file: workspaceFile,
        content: patchedContent,
        expectedVersionHash: live.versionHash,
      });

      agentUpdateSelection(file.id, {
        selection: agentSelectionDescriptor(
          { nodeId: node.id, selector: node.selector },
          "Creating component",
        ),
        nodeId: node.id,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    return {
      designId,
      nodeId: node.id,
      selector: node.selector,
      componentName,
      sourceType,
      props: propStamps.map((stamp) => ({
        name: stamp.name.slice(COMPONENT_PROP_PREFIX.length),
        value: stamp.value,
      })),
      persisted: changed,
      ctaRequired: false,
      fileId: file.id,
      filename: file.filename,
      bytesBefore: html.length,
      bytesAfter: patchedContent.length,
      note: changed
        ? "Element promoted to a component instance and persisted via the deterministic HTML-patch path."
        : "No change applied — the element could not be annotated (missing source span).",
    };
  },
});
