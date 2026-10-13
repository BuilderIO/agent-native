import { defineAction } from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  resolveSourceWorkspace,
  SourceWorkspaceEditConflictError,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type AutoLayoutEditIntent,
  type BooleanSubtractEditIntent,
  type ClassEditIntent,
  type CodeLayerSource,
  type EditIntent,
  type UnwrapEditIntent,
  type WrapNodesEditIntent,
} from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import { linkedComponentRootForNode } from "../shared/component-links.js";
import { componentNodeIdMatches } from "../shared/component-model.js";
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
import { designSourceTypeFromData } from "../shared/source-mode.js";
import applyComponentPropEditAction from "./apply-component-prop-edit.js";
import readLocalFileAction from "./read-local-file.js";
import writeLocalFileAction from "./write-local-file.js";

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
    case "booleanSubtract":
      return "Subtracting selected shapes";
    case "unwrap":
      return "Ungrouping elements";
    case "autoLayout":
      return "Editing layout";
    default:
      return "Editing element";
  }
}

type VisualEditActionSource = CodeLayerSource & { html?: string };

const TAILWIND_PREFIXES = ["base", "sm", "md", "lg", "xl", "2xl"] as const;

function resolveActivePrefix(
  activeBreakpoint?: TailwindBreakpointPrefix | null,
  activeFrameWidthPx?: number | null,
): TailwindBreakpointPrefix | null {
  if (activeBreakpoint != null) return activeBreakpoint;
  if (activeFrameWidthPx != null) return widthToPrefix(activeFrameWidthPx);
  return null;
}

function stemFromToken(token: string): string {
  const prefixMatch = /^(?:2xl|xl|lg|md|sm):/.exec(token);
  const utility = prefixMatch ? token.slice(prefixMatch[0].length) : token;
  return utilityStem(utility);
}

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

  return intent;
}

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
    return intent;
  }

  if (intent.kind === "style") {
    if (intent.operation === "remove") return intent;
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
        positionPrecision: z
          .enum(["authored", "transformed", "unknown"])
          .optional(),
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

const styleIntentSchema = z
  .object({
    kind: z.literal("style"),
    target: targetSchema,
    property: z
      .string()
      .describe(
        "CSS property to set or remove. Deterministic edits cover the visual editor's common layout, typography, fill, stroke, effect, transform, and spacing properties.",
      ),
    operation: z
      .enum(["set", "remove"])
      .optional()
      .describe(
        '"set" (default) writes the CSS value; "remove" deletes all matching inline declarations so the stylesheet or inherited value applies.',
      ),
    value: z
      .string()
      .optional()
      .describe(
        'CSS value to write; required for "set" and omitted for "remove".',
      ),
  })
  .superRefine((intent, ctx) => {
    if (intent.operation === "remove" && intent.value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: 'Omit value when operation is "remove".',
      });
    } else if (intent.operation !== "remove" && intent.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: 'Provide value when operation is omitted or "set".',
      });
    }
  });

const intentSchema = z.preprocess(
  parseJsonString,
  z.discriminatedUnion("kind", [
    styleIntentSchema,
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
      value: z
        .string()
        .describe(
          "Text content for a leaf HTML element. This REPLACES the element's entire text. view-screen's selection preview caps textContent at 200 chars, so when its textContentTruncated is true, read the element's full text first — writing the preview back deletes everything past the cap.",
        ),
      html: z
        .string()
        .optional()
        .describe(
          "Optional sanitized inner HTML for preserving styled inline text runs.",
        ),
    }),
    z.object({
      kind: z.literal("attribute"),
      target: targetSchema,
      name: z.string().describe("Plain HTML attribute name to set."),
      value: z.string().describe("Attribute value to write."),
    }),
    z.object({
      kind: z.literal("deleteNode"),
      target: targetSchema,
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
      wrapperKind: z
        .enum(["group", "frame"])
        .optional()
        .describe(
          "Semantic identity for a non-auto-layout wrapper. Defaults to group; auto-layout wrappers are frames.",
        ),
      sizeHints: z.record(z.string(), structureSizeHintSchema).optional(),
    }) satisfies z.ZodType<WrapNodesEditIntent>,
    z.object({
      kind: z.literal("booleanSubtract"),
      targetIds: z
        .array(z.string())
        .min(2)
        .describe(
          "data-agent-native-node-id values of consecutive sibling rectangles and ellipses to subtract. The first selected shape in source order supplies the result fill; all selected operands remain editable layers inside the new Subtract group.",
        ),
    }) satisfies z.ZodType<BooleanSubtractEditIntent>,
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
      containerStyles: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Complete container CSS overrides, including display:grid and grid-template-columns when a grid flow is requested.",
        ),
      childRects: z
        .record(
          z.string(),
          z.object({
            x: z.number(),
            y: z.number(),
            width: z.number().nonnegative(),
            height: z.number().nonnegative(),
          }),
        )
        .optional()
        .describe(
          "Measured child rectangles relative to the container, required when disabling auto-layout.",
        ),
      containerRect: z
        .object({
          width: z.number().nonnegative(),
          height: z.number().nonnegative(),
        })
        .optional()
        .describe(
          "Measured container size used to keep a disabled auto-layout container open.",
        ),
    }) satisfies z.ZodType<AutoLayoutEditIntent>,
  ]),
);

const intentsSchema = z.preprocess(
  parseJsonString,
  z.union([intentSchema, z.array(intentSchema).min(1)]),
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

function scopeIntentForSource(
  intent: EditIntent,
  source: VisualEditActionSource,
  options: {
    activeBreakpoint?: TailwindBreakpointPrefix | null;
    activeFrameWidthPx?: number | null;
    maxWidthPx?: number | null;
    designData?: string | null;
    fileId?: string;
  },
): EditIntent {
  let scoped = intent;
  const {
    activeBreakpoint,
    activeFrameWidthPx,
    maxWidthPx,
    designData,
    fileId,
  } = options;

  if (
    maxWidthPx != null &&
    (scoped.kind === "class" || scoped.kind === "style")
  ) {
    return scopeIntentToFramerBound(scoped, maxWidthPx);
  }

  if (source.kind !== "design-file" || activeBreakpoint != null) {
    const activePrefix = resolveActivePrefix(
      activeBreakpoint,
      activeFrameWidthPx,
    );
    if (activePrefix !== null && scoped.kind === "class") {
      return scopeClassIntentToBreakpoint(scoped, activePrefix);
    }
    return scoped;
  }

  if (
    activeFrameWidthPx == null ||
    (scoped.kind !== "class" && scoped.kind !== "style")
  ) {
    return scoped;
  }

  const bound = resolveFramerBoundFromDesignData(
    designData ?? null,
    fileId ?? "",
    activeFrameWidthPx,
  );
  if (bound.kind === "bound") {
    scoped = scopeIntentToFramerBound(scoped, bound.boundPx);
  } else if (bound.kind === "unknown" && scoped.kind === "class") {
    const activePrefix = resolveActivePrefix(null, activeFrameWidthPx);
    if (activePrefix !== null) {
      scoped = scopeClassIntentToBreakpoint(scoped, activePrefix);
    }
  }
  return scoped;
}

type VisualEditPatchResult = ReturnType<typeof applyVisualEdit>;

function applyIntentBatch(
  html: string,
  intents: EditIntent[],
  source: CodeLayerSource,
  scope: (intent: EditIntent) => EditIntent,
): {
  content: string;
  projection: VisualEditPatchResult["projection"];
  results: VisualEditPatchResult["result"][];
  scopedIntents: EditIntent[];
} {
  let content = html;
  let projection: VisualEditPatchResult["projection"] | undefined;
  const results: VisualEditPatchResult["result"][] = [];
  const scopedIntents: EditIntent[] = [];

  for (const intent of intents) {
    const scoped = scope(intent);
    const patch = applyVisualEdit(content, scoped, { source });
    scopedIntents.push(scoped);
    results.push(patch.result);
    projection = patch.projection;
    if (patch.result.status !== "applied") {
      return {
        content: html,
        projection: buildCodeLayerProjection(html, { source }),
        results,
        scopedIntents,
      };
    }
    content = patch.content;
  }

  return {
    content,
    projection: projection!,
    results,
    scopedIntents,
  };
}

function batchResult(
  results: VisualEditPatchResult["result"][],
  changed: boolean,
): VisualEditPatchResult["result"] {
  const firstFailureIndex = results.findIndex(
    (result) => result.status !== "applied",
  );
  if (results.length === 1) return results[0]!;
  if (firstFailureIndex >= 0) {
    const failure = results[firstFailureIndex]!;
    return {
      ...failure,
      changed: false,
      message: `Intent ${firstFailureIndex + 1} of ${results.length} failed: ${failure.message ?? failure.status}. No batched edits were persisted.`,
    };
  }
  const last = results[results.length - 1]!;
  return {
    ...last,
    changed,
    message: `${results.length} visual edits applied in one persisted write.`,
  };
}

function targetRefsForIntent(
  intent: EditIntent,
  resolvedTarget?: { nodeId?: string; selector?: string },
): Array<{ nodeId?: string; selector?: string }> {
  const refs: Array<{ nodeId?: string; selector?: string }> = [];
  if (resolvedTarget) refs.push(resolvedTarget);
  if ("target" in intent) {
    refs.push(intent.target);
    if (intent.kind === "moveNode") refs.push(intent.anchor);
    return refs;
  }
  if ("targetIds" in intent) {
    refs.push(...intent.targetIds.map((nodeId) => ({ nodeId })));
    return refs;
  }
  if ("targetId" in intent) refs.push({ nodeId: intent.targetId });
  return refs;
}

function responsiveStyleRemovalResult() {
  return {
    status: "needsAgent" as const,
    changed: false,
    message:
      "Responsive style removal requires a scoped reset operation; no source was changed.",
  };
}

export default defineAction({
  description:
    "Apply one deterministic visual edit to a code-backed HTML design layer. " +
    "Pass one intent or an ordered array of intents; batched intents are folded into one persisted write. " +
    "Supports safe inline style, class, and leaf textContent edits on inline/SQL HTML files, plus diff-first literal leaf JSX edits on consented localhost files; escalates ambiguous, dynamic, repeated, shared, or structural JSX edits without writing. " +
    "Intent kinds (intent.kind, exact literal required): style, class, breakpoint-style, textContent (leaf text — there is no 'set-text' kind), attribute, deleteNode, moveNode, wrapNodes, booleanSubtract, unwrap, autoLayout. booleanSubtract creates an editable SVG mask from at least two consecutive sibling rectangles/ellipses; operands must be positioned with pixel geometry and solid fills. " +
    "Responsive editing (§6.4): pass activeFrameWidthPx (the active breakpoint frame width, matching the UI's breakpoint bar) to scope class AND style edits Framer-style — overrides apply below the next-wider frame and cascade down; the widest frame is the base. " +
    "Raw CSS values persist as managed @media rules (<style data-agent-native-breakpoints>); Tailwind-utility values become max-[<bound>px]: classes. " +
    "Pass activeBreakpoint to force legacy min-width prefix scoping for class edits, or maxWidthPx for an explicit desktop-down bound. Omit all three for base (global) behaviour.",
  schema: z.object({
    source: sourceSchema.describe(
      "Edit source. Use kind=design-file with designId/filename or fileId to persist into SQL; kind=inline-html with html for a preview-only patch.",
    ),
    intent: intentsSchema.describe(
      "One visual edit intent, or a non-empty ordered array of intents, targeting CodeLayerProjection nodeIds or selectors. Batched intents are folded into one persisted write.",
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
  run: async (
    {
      source,
      intent,
      includeContent,
      persist,
      activeBreakpoint,
      activeFrameWidthPx,
      maxWidthPx,
    },
    context,
  ) => {
    const actionSource = source as VisualEditActionSource;
    const editIntents = (
      Array.isArray(intent) ? intent : [intent]
    ) as EditIntent[];
    const hasStyleRemoval = editIntents.some(
      (editIntent) =>
        editIntent.kind === "style" && editIntent.operation === "remove",
    );

    if (hasStyleRemoval && maxWidthPx != null) {
      const result = responsiveStyleRemovalResult();
      return {
        result,
        results: editIntents.map(() => result),
        persisted: false,
      };
    }

    if (actionSource.kind === "local-file") {
      if (editIntents.length !== 1) {
        return {
          result: {
            status: "needsAgent" as const,
            changed: false,
            message:
              "Batched local-file JSX edits require semantic source inspection and are not written by this deterministic path.",
          },
          persisted: false,
        };
      }
      const editIntent = editIntents[0]!;
      const target =
        "target" in editIntent
          ? (editIntent.target as {
              nodeId?: string;
              selector?: string;
              sourceAnchor?: {
                line: number;
                column: number;
                positionPrecision?: "authored" | "transformed" | "unknown";
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
              "Local visual edits require designId, connectionId, path, and a complete sourceAnchor from the live selection.",
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
        editIntent.kind !== "style" &&
        editIntent.kind !== "attribute"
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
      if (editIntent.kind === "style" && editIntent.operation === "remove") {
        return {
          result: {
            status: "needsAgent" as const,
            changed: false,
            message:
              "Removing inline styles from JSX requires semantic source editing; no file was changed.",
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

    if (actionSource.kind === "inline-html") {
      const codeLayerSource: CodeLayerSource = {
        kind: "inline-html",
        filename: actionSource.filename,
        revision: actionSource.revision,
      };
      const originalContent = actionSource.html ?? "";
      const batch = applyIntentBatch(
        originalContent,
        editIntents,
        codeLayerSource,
        (editIntent) =>
          scopeIntentForSource(editIntent, actionSource, {
            activeBreakpoint,
            activeFrameWidthPx,
            maxWidthPx,
          }),
      );
      const allApplied = batch.results.every(
        (result) => result.status === "applied",
      );
      const changed =
        allApplied &&
        batch.results.some((result) => result.changed) &&
        batch.content !== originalContent;
      return {
        result: batchResult(batch.results, changed),
        results: batch.results,
        projection: batch.projection,
        patchedContent: includeContent
          ? allApplied
            ? batch.content
            : originalContent
          : undefined,
        bytesBefore: originalContent.length,
        bytesAfter: allApplied ? batch.content.length : originalContent.length,
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
      const batch = applyIntentBatch(
        "",
        editIntents,
        codeLayerSource,
        (editIntent) =>
          scopeIntentForSource(editIntent, actionSource, {
            activeBreakpoint,
            activeFrameWidthPx,
            maxWidthPx,
          }),
      );
      return {
        result: batchResult(batch.results, false),
        results: batch.results,
        projection: batch.projection,
      };
    }

    const file = await resolveEditableDesignFile(actionSource);
    if (
      hasStyleRemoval &&
      activeBreakpoint == null &&
      activeFrameWidthPx != null &&
      resolveFramerBoundFromDesignData(
        file.designData,
        file.id,
        activeFrameWidthPx,
      ).kind === "bound"
    ) {
      const result = responsiveStyleRemovalResult();
      return {
        result,
        results: editIntents.map(() => result),
        projection: buildCodeLayerProjection(file.content, {
          source: file.codeLayerSource,
        }),
        designId: file.designId,
        fileId: file.id,
        filename: file.filename,
        persisted: false,
        patchedContent: includeContent ? file.content : undefined,
        bytesBefore: file.content.length,
        bytesAfter: file.content.length,
      };
    }
    const batch = applyIntentBatch(
      file.content,
      editIntents,
      file.codeLayerSource,
      (editIntent) =>
        scopeIntentForSource(editIntent, actionSource, {
          activeBreakpoint,
          activeFrameWidthPx,
          maxWidthPx,
          designData: file.designData,
          fileId: file.id,
        }),
    );
    const allApplied = batch.results.every(
      (result) => result.status === "applied",
    );
    const changed =
      allApplied &&
      batch.results.some((result) => result.changed) &&
      batch.content !== file.content;

    const sourceProjection = buildCodeLayerProjection(file.content, {
      source: file.codeLayerSource,
    });
    const nodeForTarget = (target: { nodeId?: string; selector?: string }) => {
      const byId = target.nodeId
        ? sourceProjection.nodes.find((candidate) =>
            componentNodeIdMatches(candidate, target.nodeId!),
          )
        : undefined;
      return (
        byId ??
        sourceProjection.nodes.find(
          (candidate) => candidate.selector === target.selector,
        )
      );
    };
    const hasLinkedTarget =
      allApplied &&
      editIntents.some((editIntent, index) =>
        targetRefsForIntent(editIntent, batch.results[index]?.target).some(
          (target) => {
            const node = nodeForTarget(target);
            return node
              ? linkedComponentRootForNode(node, sourceProjection) !== null
              : false;
          },
        ),
      );

    if (hasLinkedTarget) {
      const noWrite = (
        status: "needsAgent" | "conflict",
        message: string,
        extra: Record<string, unknown> = {},
      ) => {
        const failure = {
          status,
          changed: false,
          message,
        } as const;
        const results = batch.results.map((result) => ({
          ...failure,
          target: result.target,
        }));
        return {
          result: failure,
          results,
          projection: sourceProjection,
          designId: file.designId,
          fileId: file.id,
          filename: file.filename,
          persisted: false,
          ...(extra.ctaRequired ? { ctaRequired: true } : {}),
          ...(includeContent ? { patchedContent: file.content } : {}),
          bytesBefore: file.content.length,
          bytesAfter: file.content.length,
        };
      };
      const unscoped =
        activeBreakpoint == null &&
        activeFrameWidthPx == null &&
        maxWidthPx == null;
      const oneStyle =
        batch.scopedIntents.length === 1 &&
        batch.scopedIntents[0]?.kind === "style" &&
        batch.scopedIntents[0].operation !== "remove" &&
        batch.scopedIntents[0].value !== undefined;
      const oneText =
        batch.scopedIntents.length === 1 &&
        batch.scopedIntents[0]?.kind === "textContent" &&
        batch.scopedIntents[0].html === undefined;
      const styleBatch =
        batch.scopedIntents.length > 1 &&
        batch.scopedIntents.every(
          (editIntent) =>
            editIntent.kind === "style" &&
            editIntent.operation !== "remove" &&
            editIntent.value !== undefined,
        );
      if (!unscoped || (!oneStyle && !oneText && !styleBatch)) {
        return noWrite(
          "needsAgent",
          "This linked component edit is not supported by the deterministic linked path. Use apply-component-prop-edit for linked style, text, or layer-name edits; inspect structural, class, removed-style, and breakpoint-scoped changes before writing.",
        );
      }

      const nodeIdFor = (
        editIntent: EditIntent,
        index: number,
      ): string | null => {
        if (!("target" in editIntent)) return null;
        const node = nodeForTarget(
          batch.results[index]?.target ?? editIntent.target,
        );
        const durableNodeId =
          node?.dataAttributes["data-agent-native-node-id"]?.trim();
        if (durableNodeId) return durableNodeId;
        return node &&
          linkedComponentRootForNode(node, sourceProjection) === null
          ? node.id
          : null;
      };

      let componentEdit:
        | { kind: "style"; property: string; value: string }
        | { kind: "textContent"; value: string }
        | {
            kind: "styleTargetsBatch";
            targets: Array<{
              fileId: string;
              nodeId: string;
              styles: Record<string, string>;
            }>;
          };
      let componentNodeId: string;
      const firstIntent = batch.scopedIntents[0];
      if (
        oneStyle &&
        firstIntent?.kind === "style" &&
        firstIntent.operation !== "remove" &&
        firstIntent.value !== undefined
      ) {
        const editIntent = firstIntent;
        componentNodeId = nodeIdFor(editIntent, 0) ?? "";
        if (!componentNodeId) {
          return noWrite(
            "needsAgent",
            "The linked style target has no stable node id. Refresh its source anchor before applying the linked component edit.",
          );
        }
        componentEdit = {
          kind: "style",
          property: editIntent.property,
          value: editIntent.value!,
        };
      } else if (oneText && firstIntent?.kind === "textContent") {
        const editIntent = firstIntent;
        componentNodeId = nodeIdFor(editIntent, 0) ?? "";
        if (!componentNodeId) {
          return noWrite(
            "needsAgent",
            "The linked text target has no stable node id. Refresh its source anchor before applying the linked component edit.",
          );
        }
        componentEdit = { kind: "textContent", value: editIntent.value };
      } else {
        const targets = new Map<
          string,
          { fileId: string; nodeId: string; styles: Record<string, string> }
        >();
        for (const [index, editIntent] of batch.scopedIntents.entries()) {
          if (editIntent.kind !== "style" || editIntent.operation === "remove")
            continue;
          const nodeId = nodeIdFor(editIntent, index);
          if (!nodeId) {
            return noWrite(
              "needsAgent",
              "A linked style-batch target has no stable node id. Refresh its source anchor before applying the linked component edit.",
            );
          }
          const target = targets.get(nodeId) ?? {
            fileId: file.id,
            nodeId,
            styles: {},
          };
          target.styles[editIntent.property] = editIntent.value!;
          targets.set(nodeId, target);
        }
        const [firstTarget] = targets.values();
        if (!firstTarget) {
          return noWrite(
            "needsAgent",
            "The linked style batch has no resolvable targets. No source was changed.",
          );
        }
        componentNodeId = firstTarget.nodeId;
        componentEdit = {
          kind: "styleTargetsBatch",
          targets: [...targets.values()],
        };
      }

      if (designSourceTypeFromData(file.designData) !== "inline") {
        return noWrite(
          "needsAgent",
          "Linked component persistence is available only for inline designs. Use the existing source-mode handoff; no source was changed.",
          { ctaRequired: true },
        );
      }

      const workspace = await resolveSourceWorkspace(file.designId, {
        includeContent: true,
        includeBoard: true,
      });
      if (workspace.sourceType !== "inline") {
        return noWrite(
          "needsAgent",
          "Linked component persistence is available only for inline designs. Use the existing source-mode handoff; no source was changed.",
          { ctaRequired: true },
        );
      }
      const htmlFiles = workspace.files.filter(
        (sourceFile) => sourceFile.fileType === "html",
      );
      const liveBases = await Promise.all(
        htmlFiles.map(async (sourceFile) => ({
          fileId: sourceFile.id,
          versionHash: (await readLiveSourceFile(sourceFile)).versionHash,
        })),
      );
      const primaryBase = liveBases.find((base) => base.fileId === file.id);
      if (!primaryBase || primaryBase.versionHash !== file.versionHash) {
        return noWrite(
          "conflict",
          "The selected source changed while linked component versions were being prepared. Refresh and retry; no source was changed.",
        );
      }

      let linkedResult: Record<string, unknown>;
      try {
        linkedResult = await applyComponentPropEditAction.run(
          {
            designId: file.designId,
            fileId: file.id,
            nodeId: componentNodeId,
            edit: componentEdit,
            source: { expectedFiles: liveBases },
          },
          context,
        );
      } catch (error) {
        if (!(error instanceof SourceWorkspaceEditConflictError)) throw error;
        return noWrite(
          "conflict",
          "A linked source changed before the atomic component write. Refresh and retry; no source was changed.",
        );
      }

      const conflict = linkedResult.conflict === true;
      const ctaRequired = linkedResult.ctaRequired === true;
      const error =
        typeof linkedResult.error === "string"
          ? linkedResult.error
          : typeof linkedResult.ctaMessage === "string"
            ? linkedResult.ctaMessage
            : "The linked component edit could not be applied.";
      if (conflict || ctaRequired || linkedResult.error) {
        return noWrite(conflict ? "conflict" : "needsAgent", error, {
          ctaRequired,
        });
      }

      const persisted = linkedResult.persisted === true;
      const changes = Array.isArray(linkedResult.changes)
        ? (linkedResult.changes as Array<{
            fileId?: string;
            after?: string;
          }>)
        : [];
      const targetContent =
        changes.find((change) => change.fileId === file.id)?.after ??
        file.content;
      const results = batch.results.map((result) => ({
        ...result,
        changed: persisted && result.changed,
      }));
      const aggregate = batchResult(results, persisted);
      const result =
        results.length === 1
          ? {
              ...aggregate,
              changed: persisted,
              message: persisted
                ? "Linked component edit persisted with its non-overridden instances."
                : aggregate.message,
            }
          : aggregate;
      return {
        result,
        results,
        projection: buildCodeLayerProjection(targetContent, {
          source: file.codeLayerSource,
        }),
        designId: file.designId,
        fileId: file.id,
        filename: file.filename,
        persisted,
        changes: linkedResult.changes,
        sourceBases: linkedResult.sourceBases,
        ...(includeContent ? { patchedContent: targetContent } : {}),
        bytesBefore: file.content.length,
        bytesAfter: targetContent.length,
      };
    }

    const lastResult = batch.results[batch.results.length - 1];
    if (lastResult?.target) {
      agentUpdateSelection(file.id, {
        selection: agentSelectionDescriptor(
          lastResult.target,
          editIntentLabel(batch.scopedIntents[batch.scopedIntents.length - 1]!),
        ),
        nodeId: lastResult.target.nodeId,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    if (changed) {
      await snapshotDesignBeforeAgentEdit(file.designId, context);
      await persistDesignFileEdit({
        id: file.id,
        designId: file.designId,
        filename: file.filename,
        fileType: file.fileType,
        content: batch.content,
        expectedVersionHash: file.versionHash,
      });
    }

    return {
      result: batchResult(batch.results, changed),
      results: batch.results,
      projection: batch.projection,
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      persisted: changed,
      patchedContent: includeContent
        ? allApplied
          ? batch.content
          : file.content
        : undefined,
      bytesBefore: file.content.length,
      bytesAfter: allApplied ? batch.content.length : file.content.length,
    };
  },
});
