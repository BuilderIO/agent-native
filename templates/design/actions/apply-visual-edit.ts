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
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  applyVisualEdit,
  type AutoLayoutEditIntent,
  type ClassEditIntent,
  type CodeLayerSource,
  type EditIntent,
  type UnwrapEditIntent,
  type WrapNodesEditIntent,
} from "../shared/code-layer.js";
import type { TailwindBreakpointPrefix } from "../shared/design-state.js";
import { utilityStem, widthToPrefix } from "../shared/responsive-classes.js";

type VisualEditActionSource = CodeLayerSource & { html?: string };

/** Tailwind responsive prefix values accepted by the action. */
const TAILWIND_PREFIXES = ["base", "sm", "md", "lg", "xl", "2xl"] as const;

/**
 * Resolve the active breakpoint prefix for a class edit.
 *
 * - If `activeBreakpoint` is provided it is used directly.
 * - If only `activeFrameWidthPx` is provided the prefix is derived via `widthToPrefix`.
 * - If neither is provided the result is `null` (= no breakpoint scoping; global
 *   class edit, current backward-compatible behaviour).
 */
function resolveActivePrefix(
  activeBreakpoint?: TailwindBreakpointPrefix | null,
  activeFrameWidthPx?: number | null,
): TailwindBreakpointPrefix | null {
  if (activeBreakpoint != null) return activeBreakpoint;
  if (activeFrameWidthPx != null) return widthToPrefix(activeFrameWidthPx);
  return null;
}

/**
 * Derive a CSS-property key from a Tailwind class token for use in
 * `responsive-class` `"remove"` operations (e.g. `"text-lg"` → `"font-size"`).
 *
 * Delegates to the shared `utilityStem` so the key matches EXACTLY what
 * `setPropertyClass`/`removePropertyClass` compute internally — a divergent
 * local heuristic would make breakpoint-scoped removes silently miss (and, with
 * the old first-segment heuristic, nuke unrelated utilities like `text-center`).
 */
function stemFromToken(token: string): string {
  // Strip any responsive prefix (e.g. "md:text-sm" → "text-sm").
  const prefixMatch = /^(?:2xl|xl|lg|md|sm):/.exec(token);
  const utility = prefixMatch ? token.slice(prefixMatch[0].length) : token;
  return utilityStem(utility);
}

/**
 * Convert a global `ClassEditIntent` into the equivalent `EditIntent` scoped to
 * the given breakpoint prefix.
 *
 * - `"add"` and `"replace"` become `"responsive-class"` edits that write /
 *   replace the utility at the target prefix.
 * - `"remove"` becomes a `"responsive-class"` remove that strips the utility
 *   stem at the target prefix.
 * - `"set"` has no direct per-breakpoint analog (it replaces the whole class
 *   list) and is passed through unchanged so existing behaviour is preserved.
 *
 * When `prefix` is `"base"`, the intent is returned unchanged because
 * `setPropertyClass(className, "base", utility)` is equivalent to a
 * global unprefixed add/replace and the existing `"class"` path already
 * handles it correctly.
 */
function scopeClassIntentToBreakpoint(
  intent: ClassEditIntent,
  prefix: TailwindBreakpointPrefix,
): EditIntent {
  if (prefix === "base") return intent;

  if (intent.operation === "add") {
    const tokens =
      intent.classNames ?? (intent.className ? [intent.className] : []);
    if (tokens.length !== 1 || !tokens[0]) return intent;
    return {
      kind: "responsive-class",
      target: intent.target,
      prefix,
      operation: "add",
      utility: tokens[0],
    };
  }

  if (intent.operation === "replace") {
    if (!intent.to) return intent;
    return {
      kind: "responsive-class",
      target: intent.target,
      prefix,
      operation: "replace",
      utility: intent.to,
      from: intent.from,
    };
  }

  if (intent.operation === "remove") {
    const tokens =
      intent.classNames ?? (intent.className ? [intent.className] : []);
    if (tokens.length !== 1 || !tokens[0]) return intent;
    return {
      kind: "responsive-class",
      target: intent.target,
      prefix,
      operation: "remove",
      stem: stemFromToken(tokens[0]),
    };
  }

  // "set" — no per-breakpoint analog; fall back to global class edit.
  return intent;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const sourceSchema = z.preprocess(
  parseJsonString,
  z
    .object({
      kind: z
        .enum(["design-file", "inline-html", "local-file", "remote-url"])
        .default("design-file"),
      designId: z.string().optional(),
      fileId: z.string().optional(),
      filename: z.string().optional(),
      path: z.string().optional(),
      url: z.string().optional(),
      revision: z.string().optional(),
      html: z.string().optional(),
    })
    .superRefine((source, ctx) => {
      if (source.kind === "design-file" && !source.designId && !source.fileId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["designId"],
          message: "designId or fileId is required for design-file sources",
        });
      }
    }),
);

const targetSchema = z
  .object({
    nodeId: z.string().optional(),
    selector: z.string().optional(),
  })
  .superRefine((target, ctx) => {
    if (!target.nodeId && !target.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeId"],
        message: "target.nodeId or target.selector is required",
      });
    }
  });

const intentSchema = z.preprocess(
  parseJsonString,
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("style"),
      target: targetSchema,
      property: z
        .string()
        .describe(
          "CSS property to set. Deterministic edits cover the visual editor's common layout, typography, fill, stroke, effect, transform, and spacing properties.",
        ),
      value: z.string().describe("CSS value to write into the inline style."),
    }),
    z.object({
      kind: z.literal("class"),
      target: targetSchema,
      operation: z.enum(["add", "remove", "replace", "set"]),
      className: z.string().optional(),
      classNames: z.array(z.string()).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    z.object({
      kind: z.literal("textContent"),
      target: targetSchema,
      value: z.string().describe("Text content for a leaf HTML element."),
      html: z
        .string()
        .optional()
        .describe(
          "Optional sanitized inner HTML for preserving styled inline text runs.",
        ),
    }),
    z.object({
      kind: z.literal("moveNode"),
      target: targetSchema,
      anchor: targetSchema,
      placement: z.enum(["before", "after", "inside"]),
    }),
    z.object({
      kind: z.literal("wrapNodes"),
      targetIds: z
        .array(z.string())
        .min(1)
        .describe(
          "data-agent-native-node-id values of sibling nodes to group. All must share a common parent.",
        ),
      autoLayout: z
        .boolean()
        .optional()
        .describe(
          "When true the wrapper gets display:flex; flex-direction:column; gap:8px and absolute positioning is stripped from each wrapped child.",
        ),
    }) satisfies z.ZodType<WrapNodesEditIntent>,
    z.object({
      kind: z.literal("unwrap"),
      targetId: z
        .string()
        .describe(
          "data-agent-native-node-id of the wrapper to remove, promoting its children to the wrapper's parent.",
        ),
    }) satisfies z.ZodType<UnwrapEditIntent>,
    z.object({
      kind: z.literal("autoLayout"),
      targetId: z
        .string()
        .describe(
          "data-agent-native-node-id of the container to convert to/from auto-layout.",
        ),
      enabled: z
        .boolean()
        .describe(
          "true = enable auto-layout (display:flex + direction + gap, strip absolute positioning from direct children); false = set display:block.",
        ),
      direction: z
        .enum(["row", "column"])
        .optional()
        .describe("Flex direction when enabling. Defaults to column."),
      gap: z
        .string()
        .optional()
        .describe("Gap value when enabling. Defaults to 8px."),
    }) satisfies z.ZodType<AutoLayoutEditIntent>,
  ]),
);

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
    // Collab reads are best-effort; SQL content remains the fallback.
  }
  return storedContent;
}

async function resolveEditableDesignFile(
  source: VisualEditActionSource,
): Promise<{
  id: string;
  designId: string;
  filename: string;
  content: string;
  codeLayerSource: CodeLayerSource;
}> {
  if (!source.fileId && !source.designId) {
    throw new Error(
      "source.designId or source.fileId is required for design-file.",
    );
  }

  const db = getDb();
  const conditions = [
    accessFilter(schema.designs, schema.designShares),
    source.fileId
      ? eq(schema.designFiles.id, source.fileId)
      : eq(schema.designFiles.designId, source.designId ?? ""),
  ];
  if (!source.fileId) {
    conditions.push(
      eq(schema.designFiles.filename, source.filename ?? "index.html"),
    );
  }

  const [file] = await db
    .select({
      id: schema.designFiles.id,
      designId: schema.designFiles.designId,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
    })
    .from(schema.designFiles)
    .innerJoin(
      schema.designs,
      eq(schema.designFiles.designId, schema.designs.id),
    )
    .where(and(...conditions))
    .limit(1);

  if (!file) {
    throw new Error("Design HTML file not found.");
  }
  if (file.fileType !== "html") {
    throw new Error("Visual code-layer edits only support HTML files for now.");
  }
  if (source.designId && file.designId !== source.designId) {
    throw new Error(
      `source.designId "${source.designId}" does not match file "${file.id}"`,
    );
  }
  if (!source.fileId && source.filename && file.filename !== source.filename) {
    throw new Error(
      `source.filename "${source.filename}" does not match file "${file.id}"`,
    );
  }

  await assertAccess("design", file.designId, "editor");

  return {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    content: await liveContent(file.id, file.content ?? ""),
    codeLayerSource: {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      revision: source.revision,
    },
  };
}

async function persistDesignFileEdit(file: {
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

export default defineAction({
  description:
    "Apply one deterministic visual edit to a code-backed HTML design layer. " +
    "Supports safe inline style, class, and leaf textContent edits on inline/SQL HTML files; escalates ambiguous or structural edits with PatchResult statuses. " +
    "Pass activeBreakpoint (or activeFrameWidthPx) to scope a class edit to a specific Tailwind responsive prefix; omit for global (backward-compatible) behaviour.",
  schema: z.object({
    source: sourceSchema.describe(
      "Edit source. Use kind=design-file with designId/filename or fileId to persist into SQL; kind=inline-html with html for a preview-only patch.",
    ),
    intent: intentSchema.describe(
      "Visual edit intent targeting a CodeLayerProjection nodeId or selector.",
    ),
    includeContent: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include patched HTML content in the response."),
    activeBreakpoint: z
      .enum(TAILWIND_PREFIXES)
      .optional()
      .nullable()
      .describe(
        "Active canvas breakpoint prefix. When set and the intent is a 'class' edit, the change is written as a breakpoint-scoped Tailwind class (e.g. 'md:text-lg') instead of a global class. 'base' writes an unprefixed class (same as omitting this field). Takes priority over activeFrameWidthPx.",
      ),
    activeFrameWidthPx: z
      .number()
      .int()
      .positive()
      .optional()
      .nullable()
      .describe(
        "Canvas frame width in pixels. When activeBreakpoint is not set, this is used to derive the Tailwind responsive prefix (via widthToPrefix) and scope class edits accordingly. Ignored when activeBreakpoint is provided.",
      ),
  }),
  run: async ({
    source,
    intent,
    includeContent,
    activeBreakpoint,
    activeFrameWidthPx,
  }) => {
    const actionSource = source as VisualEditActionSource;
    let editIntent = intent as EditIntent;

    // Breakpoint scoping: when the caller specifies an active breakpoint (or
    // frame width) and the intent is a plain `"class"` edit, convert it to a
    // `"responsive-class"` edit scoped to the appropriate Tailwind prefix.
    // All other intent kinds (style, textContent, moveNode, responsive-class)
    // are passed through unchanged — the caller either already supplied the
    // correct prefix (responsive-class) or does not need one (the others).
    const activePrefix = resolveActivePrefix(
      activeBreakpoint,
      activeFrameWidthPx,
    );
    if (activePrefix !== null && editIntent.kind === "class") {
      editIntent = scopeClassIntentToBreakpoint(editIntent, activePrefix);
    }

    if (actionSource.kind === "inline-html") {
      const codeLayerSource: CodeLayerSource = {
        kind: "inline-html",
        filename: actionSource.filename,
        revision: actionSource.revision,
      };
      const patch = applyVisualEdit(actionSource.html ?? "", editIntent, {
        source: codeLayerSource,
      });
      return {
        result: patch.result,
        projection: patch.projection,
        patchedContent: includeContent ? patch.content : undefined,
        bytesBefore: (actionSource.html ?? "").length,
        bytesAfter: patch.content.length,
      };
    }

    if (actionSource.kind !== "design-file") {
      const codeLayerSource: CodeLayerSource = {
        kind: actionSource.kind,
        path: actionSource.path,
        url: actionSource.url,
        filename: actionSource.filename,
        revision: actionSource.revision,
      };
      const patch = applyVisualEdit("", editIntent, {
        source: codeLayerSource,
      });
      // local-file / remote-url sources are not editable here (the engine
      // reports "unsupported"), so no byte counts are returned — a 0/0 pair
      // would misleadingly suggest an empty file was measured.
      return {
        result: patch.result,
        projection: patch.projection,
      };
    }

    const file = await resolveEditableDesignFile(actionSource);
    const patch = applyVisualEdit(file.content, editIntent, {
      source: file.codeLayerSource,
    });

    if (patch.result.target) {
      agentUpdateSelection(file.id, {
        selection: patch.result.target.selector,
        nodeId: patch.result.target.nodeId,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    if (patch.result.status === "applied" && patch.result.changed) {
      await persistDesignFileEdit({
        id: file.id,
        designId: file.designId,
        content: patch.content,
      });
    }

    return {
      result: patch.result,
      projection: patch.projection,
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      persisted: patch.result.status === "applied" && patch.result.changed,
      patchedContent: includeContent ? patch.content : undefined,
      bytesBefore: file.content.length,
      bytesAfter: patch.content.length,
    };
  },
});
