import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  applyVisualEdit,
  type AutoLayoutEditIntent,
  type ClassEditIntent,
  type CodeLayerSource,
  type EditIntent,
  type UnwrapEditIntent,
  type WrapNodesEditIntent,
} from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import type { TailwindBreakpointPrefix } from "../shared/design-state.js";
import {
  planLocalJsxVisualEdit,
  type LocalJsxLeafIntent,
} from "../shared/local-jsx-visual-edit.js";
import {
  breakpointUpperBoundPx,
  planBreakpointStyleWrite,
  utilityStem,
  widthToPrefix,
} from "../shared/responsive-classes.js";
import readLocalFileAction from "./read-local-file.js";
import writeLocalFileAction from "./write-local-file.js";

/**
 * Short human-readable label describing an edit intent, shown next to the
 * agent's selection ring for live viewers (e.g. "AI — Editing text").
 */
function editIntentLabel(intent: EditIntent): string {
  switch (intent.kind) {
    case "textContent":
      return "Editing text";
    case "style":
      return "Editing style";
    case "class":
    case "responsive-class":
    case "breakpoint-style":
      return "Editing styles";
    case "moveNode":
      return "Moving element";
    case "wrapNodes":
      return "Grouping elements";
    case "unwrap":
      return "Ungrouping elements";
    case "autoLayout":
      return "Editing layout";
    default:
      return "Editing element";
  }
}

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

/**
 * Convert a `class` or `style` intent into the equivalent Framer-scoped edit
 * for a desktop-down max-width bound (§6.4 breakpoint bar semantics):
 *
 * - `class` add/replace/remove → `responsive-class` with `maxWidthPx`
 *   (writes/removes a `max-[<bound>px]:` scoped token).
 * - `style` → the single class-vs-media decision (`planBreakpointStyleWrite`):
 *   Tailwind-utility values become scoped classes; raw CSS values become
 *   managed `@media (max-width: <bound>px)` rules via `breakpoint-style`.
 * - Everything else passes through unchanged.
 */
function scopeIntentToFramerBound(
  intent: EditIntent,
  maxWidthPx: number,
): EditIntent {
  if (intent.kind === "class") {
    if (intent.operation === "add" || intent.operation === "replace") {
      const tokens =
        intent.operation === "replace"
          ? intent.to
            ? [intent.to]
            : []
          : (intent.classNames ?? (intent.className ? [intent.className] : []));
      if (tokens.length !== 1 || !tokens[0]) return intent;
      return {
        kind: "responsive-class",
        target: intent.target,
        prefix: "base", // ignored when maxWidthPx is set
        maxWidthPx,
        operation: intent.operation,
        utility: tokens[0],
      };
    }
    if (intent.operation === "remove") {
      const tokens =
        intent.classNames ?? (intent.className ? [intent.className] : []);
      if (tokens.length !== 1 || !tokens[0]) return intent;
      return {
        kind: "responsive-class",
        target: intent.target,
        prefix: "base",
        maxWidthPx,
        operation: "remove",
        stem: stemFromToken(tokens[0]),
      };
    }
    // "set" — no per-breakpoint analog.
    return intent;
  }

  if (intent.kind === "style") {
    const plan = planBreakpointStyleWrite({
      property: intent.property,
      value: intent.value,
      upperBoundPx: maxWidthPx,
    });
    if (plan.mode === "class") {
      return {
        kind: "responsive-class",
        target: intent.target,
        prefix: "base",
        maxWidthPx: plan.boundPx,
        operation: "replace",
        utility: plan.utility,
      };
    }
    if (plan.mode === "media") {
      return {
        kind: "breakpoint-style",
        target: intent.target,
        maxWidthPx: plan.maxWidthPx,
        property: plan.property,
        value: plan.value,
        operation: "set",
      };
    }
    return intent;
  }

  return intent;
}

/**
 * Resolve the Framer desktop-down bound for a design-file edit from the
 * design's stored breakpoint set (+ the edited screen's primary width).
 *
 * - `{ kind: "bound" }` — a wider frame exists; scope below it.
 * - `{ kind: "base" }` — the active frame IS the widest context; edits
 *   belong to the base layer (Framer semantics).
 * - `{ kind: "unknown" }` — the design has no breakpoint set; callers fall
 *   back to the legacy min-width prefix behaviour.
 */
function resolveFramerBoundFromDesignData(
  designData: string | null,
  fileId: string,
  activeFrameWidthPx: number,
): { kind: "bound"; boundPx: number } | { kind: "base" } | { kind: "unknown" } {
  if (!designData) return { kind: "unknown" };
  try {
    const parsed = JSON.parse(designData) as Record<string, unknown>;
    const rawSet = parsed.breakpointSet as
      | { breakpoints?: Array<{ widthPx?: unknown }> }
      | undefined;
    const widths = Array.isArray(rawSet?.breakpoints)
      ? rawSet.breakpoints
          .map((bp) => bp?.widthPx)
          .filter(
            (width): width is number =>
              typeof width === "number" && Number.isFinite(width),
          )
      : [];
    if (widths.length === 0) return { kind: "unknown" };

    const metadataByFileId = parsed.screenMetadata as
      | Record<string, { width?: unknown } | undefined>
      | undefined;
    const rawScreenWidth = metadataByFileId?.[fileId]?.width;
    const screenWidthPx =
      typeof rawScreenWidth === "number" && Number.isFinite(rawScreenWidth)
        ? rawScreenWidth
        : null;

    const boundPx = breakpointUpperBoundPx(
      widths,
      activeFrameWidthPx,
      screenWidthPx,
    );
    return boundPx === null ? { kind: "base" } : { kind: "bound", boundPx };
  } catch {
    return { kind: "unknown" };
  }
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
      connectionId: z.string().optional(),
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
      if (
        source.kind === "local-file" &&
        (!source.designId || !source.connectionId || !source.path)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["path"],
          message:
            "designId, connectionId, and path are required for local-file sources",
        });
      }
    }),
);

const targetSchema = z
  .object({
    nodeId: z.string().optional(),
    selector: z.string().optional(),
    sourceAnchor: z
      .object({
        line: z.number().int().positive(),
        column: z.number().int().positive(),
        runtimeMultiplicity: z.number().int().positive().optional(),
        scope: z
          .enum([
            "single-instance",
            "repeated-render",
            "shared-component-definition",
            "unknown",
          ])
          .optional(),
      })
      .optional(),
  })
  .superRefine((target, ctx) => {
    if (!target.nodeId && !target.selector && !target.sourceAnchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeId"],
        message:
          "target.nodeId, target.selector, or target.sourceAnchor is required",
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
      kind: z.literal("breakpoint-style"),
      target: targetSchema,
      maxWidthPx: z
        .number()
        .int()
        .positive()
        .describe(
          "Inclusive upper viewport bound (px). The declaration persists as a managed '@media (max-width: <bound>px)' rule in the <style data-agent-native-breakpoints> block — the fallback for values responsive class prefixes can't express (exact px positions, rgb()/calc() values). Use breakpointUpperBoundPx semantics: just below the next-wider breakpoint frame.",
        ),
      property: z
        .string()
        .describe("CSS property to set (camelCase or kebab-case)."),
      value: z
        .string()
        .optional()
        .describe("CSS value. Required for operation 'set'."),
      operation: z
        .enum(["set", "remove"])
        .optional()
        .describe(
          "'set' (default) writes/overwrites the scoped declaration; 'remove' deletes it so the base value cascades back down.",
        ),
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

async function resolveEditableDesignFile(
  source: VisualEditActionSource,
): Promise<{
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content: string;
  versionHash: string;
  designData: string | null;
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
      designData: schema.designs.data,
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

  // Read the live (collab-authoritative, not just SQL-stored) content and
  // capture its versionHash so the eventual persist can be conditioned on
  // this exact base still being current — see persistDesignFileEdit below.
  // Same read helper the 8 sibling actions (insert-design-native-asset.ts,
  // insert-asset.ts, etc.) migrated to, closing the write-race window where
  // a concurrent editor's change landed between this read and the raw
  // unconditional write this action used to do.
  const workspaceFile: SourceWorkspaceFile = {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    fileType: file.fileType,
    content: file.content,
    createdAt: null,
    updatedAt: null,
  };
  const live = await readLiveSourceFile(workspaceFile);

  return {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    fileType: file.fileType,
    content: live.content,
    versionHash: live.versionHash,
    designData: file.designData ?? null,
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
  filename: string;
  fileType: string;
  content: string;
  expectedVersionHash: string;
}): Promise<void> {
  agentEnterDocument(file.id);
  try {
    await writeInlineSourceFile({
      designId: file.designId,
      file: {
        id: file.id,
        designId: file.designId,
        filename: file.filename,
        fileType: file.fileType,
        content: file.content,
        createdAt: null,
        updatedAt: null,
      },
      content: file.content,
      expectedVersionHash: file.expectedVersionHash,
    });
  } finally {
    agentLeaveDocument(file.id);
  }
}

export default defineAction({
  description:
    "Apply one deterministic visual edit to a code-backed HTML design layer. " +
    "Supports safe inline style, class, and leaf textContent edits on inline/SQL HTML files, plus diff-first literal leaf JSX edits on consented localhost files; escalates ambiguous, dynamic, repeated, shared, or structural JSX edits without writing. " +
    "Responsive editing (§6.4): pass activeFrameWidthPx (the active breakpoint frame width, matching the UI's breakpoint bar) to scope class AND style edits Framer-style — overrides apply below the next-wider frame and cascade down; the widest frame is the base. " +
    "Raw CSS values persist as managed @media rules (<style data-agent-native-breakpoints>); Tailwind-utility values become max-[<bound>px]: classes. " +
    "Pass activeBreakpoint to force legacy min-width prefix scoping for class edits, or maxWidthPx for an explicit desktop-down bound. Omit all three for base (global) behaviour.",
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
    persist: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "For local-file sources only, persist the proposed edit through write-local-file. Omit/false to return a proposed diff without writing. Local persistence requires the existing human write-consent grant and an exact bridge version hash.",
      ),
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
        "Active breakpoint frame width in pixels — matches the UI's breakpoint bar. For design-file sources whose design has a breakpoint set, 'class' AND 'style' intents are scoped Framer-style: overrides apply below the next-wider frame (max-[<bound>px]: classes, or managed @media rules for raw CSS values); the widest frame is the base and writes unscoped. When the design has no breakpoint set (or for inline-html sources) class edits fall back to the legacy min-width Tailwind prefix via widthToPrefix. Ignored when activeBreakpoint is provided.",
      ),
    maxWidthPx: z
      .number()
      .int()
      .positive()
      .optional()
      .nullable()
      .describe(
        "Explicit Framer desktop-down bound (px): scope this edit to apply at viewport widths <= this value. Overrides activeBreakpoint/activeFrameWidthPx derivation. Applies to 'class' and 'style' intents.",
      ),
  }),
  run: async ({
    source,
    intent,
    includeContent,
    persist,
    activeBreakpoint,
    activeFrameWidthPx,
    maxWidthPx,
  }) => {
    const actionSource = source as VisualEditActionSource;
    let editIntent = intent as EditIntent;

    if (actionSource.kind === "local-file") {
      const target =
        "target" in editIntent
          ? (editIntent.target as {
              nodeId?: string;
              selector?: string;
              sourceAnchor?: {
                line: number;
                column: number;
                runtimeMultiplicity?: number;
                scope?:
                  | "single-instance"
                  | "repeated-render"
                  | "shared-component-definition"
                  | "unknown";
              };
            })
          : undefined;
      const sourceAnchor = target?.sourceAnchor;
      if (
        !actionSource.designId ||
        !actionSource.connectionId ||
        !actionSource.path ||
        !sourceAnchor
      ) {
        return {
          result: {
            status: "conflict" as const,
            changed: false,
            message:
              "Local visual edits require designId, connectionId, path, and an exact sourceAnchor from the live selection.",
          },
          persisted: false,
        };
      }
      const pathSegments = actionSource.path
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean);
      if (
        pathSegments.some((segment) =>
          [
            "node_modules",
            "dist",
            "build",
            "coverage",
            ".next",
            ".nuxt",
            ".output",
            "generated",
          ].includes(segment.toLowerCase()),
        )
      ) {
        return {
          result: {
            status: "unsupported" as const,
            changed: false,
            message:
              "Generated and dependency output files are not eligible for deterministic visual write-back.",
          },
          persisted: false,
        };
      }
      if (
        editIntent.kind !== "textContent" &&
        editIntent.kind !== "class" &&
        editIntent.kind !== "style"
      ) {
        return {
          result: {
            status: "needsAgent" as const,
            changed: false,
            message:
              "Structural and semantic JSX edits require coding-agent inspection and are never written by the deterministic local-file path.",
          },
          persisted: false,
        };
      }
      if (
        activeBreakpoint != null ||
        activeFrameWidthPx != null ||
        maxWidthPx != null
      ) {
        return {
          result: {
            status: "needsAgent" as const,
            changed: false,
            message:
              "Breakpoint-scoped localhost JSX edits require semantic source inspection in this first deterministic slice.",
          },
          persisted: false,
        };
      }

      const read = await readLocalFileAction.run({
        designId: actionSource.designId,
        connectionId: actionSource.connectionId,
        path: actionSource.path,
      });
      if (!read.versionHash) {
        throw new Error(
          "The local bridge did not return a version hash; no source was written.",
        );
      }
      const planned = planLocalJsxVisualEdit({
        content: read.content,
        anchor: sourceAnchor,
        intent: editIntent as LocalJsxLeafIntent,
      });
      let persisted = false;
      let versionHash = read.versionHash;
      if (
        persist &&
        planned.result.status === "applied" &&
        planned.result.changed
      ) {
        const write = await writeLocalFileAction.run({
          designId: actionSource.designId,
          connectionId: actionSource.connectionId,
          relPath: actionSource.path,
          content: planned.content,
          expectedVersionHash: read.versionHash,
          requireExpectedVersionHash: true,
        });
        persisted = write.written;
        versionHash = write.versionHash ?? versionHash;
      }
      return {
        result: planned.result,
        source: {
          kind: "local-file" as const,
          path: actionSource.path,
          connectionId: actionSource.connectionId,
        },
        proposedDiff: planned.proposedDiff,
        currentVersionHash: read.versionHash,
        versionHash,
        persisted,
        patchedContent: includeContent ? planned.content : undefined,
        bytesBefore: read.content.length,
        bytesAfter: planned.content.length,
      };
    }

    // Breakpoint scoping precedence (§6.4):
    //
    // 1. Explicit `maxWidthPx` param → Framer desktop-down scope for `class`
    //    AND `style` intents (max-[<bound>px]: classes / managed @media).
    // 2. Explicit `activeBreakpoint` prefix → legacy min-width Tailwind
    //    prefix scoping for `class` intents (backward-compatible).
    // 3. `activeFrameWidthPx` only → design-file sources resolve the Framer
    //    bound from the design's breakpoint set (below, after the file is
    //    loaded); other sources fall back to the legacy prefix path.
    if (
      maxWidthPx != null &&
      (editIntent.kind === "class" || editIntent.kind === "style")
    ) {
      editIntent = scopeIntentToFramerBound(editIntent, maxWidthPx);
    } else if (
      actionSource.kind !== "design-file" ||
      activeBreakpoint != null
    ) {
      const activePrefix = resolveActivePrefix(
        activeBreakpoint,
        activeFrameWidthPx,
      );
      if (activePrefix !== null && editIntent.kind === "class") {
        editIntent = scopeClassIntentToBreakpoint(editIntent, activePrefix);
      }
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
      // remote-url sources stay preview-only/unsupported. A 0/0 byte count
      // would misleadingly suggest that an empty remote file was measured.
      return {
        result: patch.result,
        projection: patch.projection,
      };
    }

    const file = await resolveEditableDesignFile(actionSource);

    // §6.4 — design-file Framer scoping resolved from the stored breakpoint
    // set (see precedence note above): the bound is just below the
    // next-wider frame; the widest frame is the base and writes unscoped.
    if (
      maxWidthPx == null &&
      activeBreakpoint == null &&
      activeFrameWidthPx != null &&
      (editIntent.kind === "class" || editIntent.kind === "style")
    ) {
      const bound = resolveFramerBoundFromDesignData(
        file.designData,
        file.id,
        activeFrameWidthPx,
      );
      if (bound.kind === "bound") {
        editIntent = scopeIntentToFramerBound(editIntent, bound.boundPx);
      } else if (bound.kind === "unknown" && editIntent.kind === "class") {
        // No breakpoint set on this design — legacy min-width prefix path.
        const activePrefix = resolveActivePrefix(null, activeFrameWidthPx);
        if (activePrefix !== null) {
          editIntent = scopeClassIntentToBreakpoint(editIntent, activePrefix);
        }
      }
      // bound.kind === "base": the active frame IS the widest context —
      // the edit stays a plain base write that cascades down.
    }

    const patch = applyVisualEdit(file.content, editIntent, {
      source: file.codeLayerSource,
    });

    if (patch.result.target) {
      // Publish a RESOLVABLE selection descriptor so live viewers can render a
      // ring over the element being edited. Prefer the stable
      // `data-agent-native-node-id` anchor over the projection CSS selector.
      agentUpdateSelection(file.id, {
        selection: agentSelectionDescriptor(
          patch.result.target,
          editIntentLabel(editIntent),
        ),
        nodeId: patch.result.target.nodeId,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    if (patch.result.status === "applied" && patch.result.changed) {
      await persistDesignFileEdit({
        id: file.id,
        designId: file.designId,
        filename: file.filename,
        fileType: file.fileType,
        content: patch.content,
        expectedVersionHash: file.versionHash,
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
