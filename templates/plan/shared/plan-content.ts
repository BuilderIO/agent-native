import { z } from "zod";

export const PLAN_CONTENT_VERSION = 1;

export type PlanBlockType =
  | "rich-text"
  | "callout"
  | "checklist"
  | "table"
  | "code-tabs"
  | "implementation-map"
  | "sketch-wireframe"
  | "sketch-diagram"
  | "decision"
  | "tabs"
  | "custom-html"
  | "visual-questions";

export type PlanBlockBase = {
  id: string;
  type: PlanBlockType;
  title?: string;
  summary?: string;
  editable?: boolean;
};

export type PlanRichTextBlock = PlanBlockBase & {
  type: "rich-text";
  data: {
    markdown: string;
    doc?: unknown;
  };
};

export type PlanCalloutBlock = PlanBlockBase & {
  type: "callout";
  data: {
    tone?: "info" | "decision" | "risk" | "warning" | "success";
    body: string;
  };
};

export type PlanChecklistBlock = PlanBlockBase & {
  type: "checklist";
  data: {
    items: Array<{
      id: string;
      label: string;
      checked?: boolean;
      note?: string;
    }>;
  };
};

export type PlanTableBlock = PlanBlockBase & {
  type: "table";
  data: {
    columns: string[];
    rows: string[][];
  };
};

export type PlanCodeTabsBlock = PlanBlockBase & {
  type: "code-tabs";
  data: {
    tabs: Array<{
      id: string;
      label: string;
      language?: string;
      code: string;
      caption?: string;
    }>;
  };
};

export type PlanImplementationMapBlock = PlanBlockBase & {
  type: "implementation-map";
  data: {
    files: Array<{
      path: string;
      title?: string;
      note: string;
      language?: string;
      snippet?: string;
    }>;
  };
};

export type PlanWireframeRegion = {
  id: string;
  kind:
    | "nav"
    | "header"
    | "list"
    | "form"
    | "toolbar"
    | "content"
    | "button"
    | "input"
    | "custom";
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  emphasis?: boolean;
};

export type PlanSketchWireframeBlock = PlanBlockBase & {
  type: "sketch-wireframe";
  data: {
    viewport?: "desktop" | "tablet" | "phone";
    caption?: string;
    regions: PlanWireframeRegion[];
  };
};

export type PlanDiagramNode = {
  id: string;
  label: string;
  detail?: string;
  x?: number;
  y?: number;
};

export type PlanDiagramEdge = {
  from: string;
  to: string;
  label?: string;
};

export type PlanSketchDiagramBlock = PlanBlockBase & {
  type: "sketch-diagram";
  data: {
    nodes: PlanDiagramNode[];
    edges: PlanDiagramEdge[];
    notes?: Array<{
      id: string;
      text: string;
      x?: number;
      y?: number;
    }>;
  };
};

export type PlanDecisionBlock = PlanBlockBase & {
  type: "decision";
  data: {
    question: string;
    options: Array<{
      id: string;
      label: string;
      detail?: string;
      recommended?: boolean;
      selected?: boolean;
    }>;
  };
};

export type PlanTabsBlock = PlanBlockBase & {
  type: "tabs";
  data: {
    tabs: Array<{
      id: string;
      label: string;
      blocks: PlanBlock[];
    }>;
  };
};

export type PlanCustomHtmlBlock = PlanBlockBase & {
  type: "custom-html";
  data: {
    html: string;
    css?: string;
    caption?: string;
  };
};

export type PlanVisualQuestion = {
  id: string;
  title: string;
  subtitle?: string;
  mode: "single" | "multi" | "freeform";
  options?: Array<{
    id: string;
    label: string;
    detail?: string;
    recommended?: boolean;
    selected?: boolean;
    wireframe?: PlanSketchWireframeBlock["data"];
    diagram?: PlanSketchDiagramBlock["data"];
  }>;
  value?: string;
};

export type PlanVisualQuestionsBlock = PlanBlockBase & {
  type: "visual-questions";
  data: {
    questions: PlanVisualQuestion[];
    submitLabel?: string;
  };
};

export type PlanBlock =
  | PlanRichTextBlock
  | PlanCalloutBlock
  | PlanChecklistBlock
  | PlanTableBlock
  | PlanCodeTabsBlock
  | PlanImplementationMapBlock
  | PlanSketchWireframeBlock
  | PlanSketchDiagramBlock
  | PlanDecisionBlock
  | PlanTabsBlock
  | PlanCustomHtmlBlock
  | PlanVisualQuestionsBlock;

export type PlanCanvasFrame = {
  id: string;
  title: string;
  blockId?: string;
  wireframe?: PlanSketchWireframeBlock["data"];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type PlanCanvasNote = {
  id: string;
  title?: string;
  body: string;
  x?: number;
  y?: number;
  arrowToFrameId?: string;
};

export type PlanContent = {
  version: typeof PLAN_CONTENT_VERSION;
  title?: string;
  brief?: string;
  canvas?: {
    title?: string;
    frames: PlanCanvasFrame[];
    flow?: PlanDiagramEdge[];
    notes?: PlanCanvasNote[];
  };
  blocks: PlanBlock[];
};

export type PlanContentPatch =
  | {
      op: "replace-block";
      blockId: string;
      block: PlanBlock;
    }
  | {
      op: "update-rich-text";
      blockId: string;
      title?: string;
      markdown?: string;
      doc?: unknown;
    }
  | {
      op: "update-custom-html";
      blockId: string;
      title?: string;
      html?: string;
      css?: string | null;
      caption?: string | null;
    }
  | {
      op: "update-wireframe-region";
      blockId: string;
      regionId: string;
      patch: Partial<Omit<PlanWireframeRegion, "id" | "label">> & {
        label?: string | null;
      };
    }
  | {
      op: "replace-wireframe-regions";
      blockId: string;
      regions: PlanWireframeRegion[];
    }
  | {
      op: "update-canvas-frame";
      frameId: string;
      patch: Partial<Omit<PlanCanvasFrame, "id">>;
    }
  | {
      op: "append-block";
      block: PlanBlock;
      afterBlockId?: string;
      parent?: {
        tabBlockId: string;
        tabId: string;
      };
    }
  | {
      op: "remove-block";
      blockId: string;
    };

const idSchema = z.string().trim().min(1).max(120);

const baseBlockSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(180).optional(),
  summary: z.string().trim().max(600).optional(),
  editable: z.boolean().optional(),
});

const unsafeCustomHtmlPattern =
  /(?:<!doctype|<\/?(?:html|head|body|script|iframe|object|embed|link|meta|base|form)[\s>/]|<\/style\s*>|\b(?:javascript|data:text\/html)\s*:|\bsrcdoc\s*=|\bon[a-z][\w:-]*\s*=)/i;

const noFullHtmlDocument = (value: string) =>
  !unsafeCustomHtmlPattern.test(value);

const wireframeRegionSchema: z.ZodType<PlanWireframeRegion> = z.object({
  id: idSchema,
  kind: z.enum([
    "nav",
    "header",
    "list",
    "form",
    "toolbar",
    "content",
    "button",
    "input",
    "custom",
  ]),
  label: z.string().trim().max(120).optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(1).max(100),
  height: z.number().min(1).max(100),
  emphasis: z.boolean().optional(),
});

const diagramNodeSchema: z.ZodType<PlanDiagramNode> = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(500).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
});

const diagramEdgeSchema: z.ZodType<PlanDiagramEdge> = z.object({
  from: idSchema,
  to: idSchema,
  label: z.string().trim().max(100).optional(),
});

const wireframeDataSchema: z.ZodType<PlanSketchWireframeBlock["data"]> =
  z.object({
    viewport: z.enum(["desktop", "tablet", "phone"]).optional(),
    caption: z.string().trim().max(400).optional(),
    regions: z.array(wireframeRegionSchema).max(80).default([]),
  });

const diagramDataSchema: z.ZodType<PlanSketchDiagramBlock["data"]> = z.object({
  nodes: z.array(diagramNodeSchema).min(1).max(80),
  edges: z.array(diagramEdgeSchema).max(120).default([]),
  notes: z
    .array(
      z.object({
        id: idSchema,
        text: z.string().trim().min(1).max(500),
        x: z.number().min(0).max(100).optional(),
        y: z.number().min(0).max(100).optional(),
      }),
    )
    .max(40)
    .optional(),
});

export const planBlockSchema: z.ZodType<PlanBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    baseBlockSchema.extend({
      type: z.literal("rich-text"),
      data: z.object({
        markdown: z.string().max(100_000),
        doc: z.unknown().optional(),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("callout"),
      data: z.object({
        tone: z
          .enum(["info", "decision", "risk", "warning", "success"])
          .optional(),
        body: z.string().trim().min(1).max(10_000),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("checklist"),
      data: z.object({
        items: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(400),
              checked: z.boolean().optional(),
              note: z.string().trim().max(800).optional(),
            }),
          )
          .max(200),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("table"),
      data: z.object({
        columns: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
        rows: z.array(z.array(z.string().max(2_000)).max(12)).max(100),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("code-tabs"),
      data: z.object({
        tabs: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(120),
              language: z.string().trim().max(40).optional(),
              code: z.string().max(100_000),
              caption: z.string().trim().max(400).optional(),
            }),
          )
          .min(1)
          .max(12),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("implementation-map"),
      data: z.object({
        files: z
          .array(
            z.object({
              path: z.string().trim().min(1).max(500),
              title: z.string().trim().max(180).optional(),
              note: z.string().trim().min(1).max(2_000),
              language: z.string().trim().max(40).optional(),
              snippet: z.string().max(50_000).optional(),
            }),
          )
          .min(1)
          .max(80),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("sketch-wireframe"),
      data: wireframeDataSchema,
    }),
    baseBlockSchema.extend({
      type: z.literal("sketch-diagram"),
      data: diagramDataSchema,
    }),
    baseBlockSchema.extend({
      type: z.literal("decision"),
      data: z.object({
        question: z.string().trim().min(1).max(500),
        options: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(200),
              detail: z.string().trim().max(800).optional(),
              recommended: z.boolean().optional(),
              selected: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(20),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("tabs"),
      data: z.object({
        tabs: z
          .array(
            z.object({
              id: idSchema,
              label: z.string().trim().min(1).max(120),
              blocks: z.array(planBlockSchema).max(40),
            }),
          )
          .min(1)
          .max(12),
      }),
    }),
    baseBlockSchema.extend({
      type: z.literal("custom-html"),
      data: z
        .object({
          html: z.string().max(100_000).refine(noFullHtmlDocument, {
            message:
              "Custom HTML blocks must be bounded fragments without html/head/body/script tags.",
          }),
          css: z
            .string()
            .max(50_000)
            .refine(noFullHtmlDocument, {
              message:
                "Custom CSS blocks must not include document or script tags.",
            })
            .optional(),
          caption: z.string().trim().max(400).optional(),
        })
        .strict(),
    }),
    baseBlockSchema.extend({
      type: z.literal("visual-questions"),
      data: z.object({
        questions: z
          .array(
            z.object({
              id: idSchema,
              title: z.string().trim().min(1).max(260),
              subtitle: z.string().trim().max(700).optional(),
              mode: z.enum(["single", "multi", "freeform"]),
              options: z
                .array(
                  z.object({
                    id: idSchema,
                    label: z.string().trim().min(1).max(220),
                    detail: z.string().trim().max(800).optional(),
                    recommended: z.boolean().optional(),
                    selected: z.boolean().optional(),
                    wireframe: wireframeDataSchema.optional(),
                    diagram: diagramDataSchema.optional(),
                  }),
                )
                .max(40)
                .optional(),
              value: z.string().max(10_000).optional(),
            }),
          )
          .min(1)
          .max(40),
        submitLabel: z.string().trim().max(80).optional(),
      }),
    }),
  ]),
) as z.ZodType<PlanBlock>;

const canvasFrameSchema: z.ZodType<PlanCanvasFrame> = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(180),
  blockId: idSchema.optional(),
  wireframe: wireframeDataSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(80).optional(),
  height: z.number().min(80).optional(),
});

const canvasNoteSchema: z.ZodType<PlanCanvasNote> = z.object({
  id: idSchema,
  title: z.string().trim().max(180).optional(),
  body: z.string().trim().min(1).max(2_000),
  x: z.number().optional(),
  y: z.number().optional(),
  arrowToFrameId: idSchema.optional(),
});

export const planContentSchema: z.ZodType<PlanContent> = z
  .object({
    version: z.literal(PLAN_CONTENT_VERSION),
    title: z.string().trim().max(240).optional(),
    brief: z.string().trim().max(4_000).optional(),
    canvas: z
      .object({
        title: z.string().trim().max(180).optional(),
        frames: z.array(canvasFrameSchema).max(40).default([]),
        flow: z.array(diagramEdgeSchema).max(80).optional(),
        notes: z.array(canvasNoteSchema).max(80).optional(),
      })
      .optional(),
    blocks: z.array(planBlockSchema).max(200).default([]),
  })
  .superRefine((content, context) => {
    const seen = new Set<string>();
    const visit = (block: PlanBlock) => {
      if (seen.has(block.id)) {
        context.addIssue({
          code: "custom",
          path: ["blocks"],
          message: `Duplicate block id: ${block.id}`,
        });
      }
      seen.add(block.id);
      if (block.type === "tabs") {
        for (const tab of block.data.tabs) {
          for (const child of tab.blocks) {
            visit(child);
          }
        }
      }
    };

    for (const block of content.blocks) {
      visit(block);
    }
  });

export type PlanContentInput = z.input<typeof planContentSchema>;

const wireframeRegionPatchSchema = z
  .object({
    kind: z
      .enum([
        "nav",
        "header",
        "list",
        "form",
        "toolbar",
        "content",
        "button",
        "input",
        "custom",
      ])
      .optional(),
    label: z.string().trim().max(120).nullable().optional(),
    x: z.number().min(0).max(100).optional(),
    y: z.number().min(0).max(100).optional(),
    width: z.number().min(1).max(100).optional(),
    height: z.number().min(1).max(100).optional(),
    emphasis: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Patch must include at least one region field.",
  });

const canvasFramePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    blockId: idSchema.optional(),
    wireframe: wireframeDataSchema.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().min(80).optional(),
    height: z.number().min(80).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Patch must include at least one canvas frame field.",
  });

export const planContentPatchSchema: z.ZodType<PlanContentPatch> =
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("replace-block"),
      blockId: idSchema,
      block: planBlockSchema,
    }),
    z.object({
      op: z.literal("update-rich-text"),
      blockId: idSchema,
      title: z.string().trim().min(1).max(180).optional(),
      markdown: z.string().max(100_000).optional(),
      doc: z.unknown().optional(),
    }),
    z.object({
      op: z.literal("update-custom-html"),
      blockId: idSchema,
      title: z.string().trim().min(1).max(180).optional(),
      html: z
        .string()
        .max(100_000)
        .refine(noFullHtmlDocument, {
          message:
            "Custom HTML blocks must be bounded fragments without html/head/body/script tags.",
        })
        .optional(),
      css: z
        .string()
        .max(50_000)
        .refine(noFullHtmlDocument, {
          message:
            "Custom CSS blocks must not include document or script tags.",
        })
        .nullable()
        .optional(),
      caption: z.string().trim().max(400).nullable().optional(),
    }),
    z.object({
      op: z.literal("update-wireframe-region"),
      blockId: idSchema,
      regionId: idSchema,
      patch: wireframeRegionPatchSchema,
    }),
    z.object({
      op: z.literal("replace-wireframe-regions"),
      blockId: idSchema,
      regions: z.array(wireframeRegionSchema).max(80),
    }),
    z.object({
      op: z.literal("update-canvas-frame"),
      frameId: idSchema,
      patch: canvasFramePatchSchema,
    }),
    z.object({
      op: z.literal("append-block"),
      block: planBlockSchema,
      afterBlockId: idSchema.optional(),
      parent: z
        .object({
          tabBlockId: idSchema,
          tabId: idSchema,
        })
        .optional(),
    }),
    z.object({
      op: z.literal("remove-block"),
      blockId: idSchema,
    }),
  ]) as z.ZodType<PlanContentPatch>;

export const planContentPatchesSchema = z.array(planContentPatchSchema).max(80);

export function applyPlanContentPatches(
  content: PlanContent,
  patches: PlanContentPatch[],
): PlanContent {
  const next = cloneJson(planContentSchema.parse(content));

  for (const patch of planContentPatchesSchema.parse(patches)) {
    if (patch.op === "replace-block") {
      next.blocks = updateBlock(
        next.blocks,
        patch.blockId,
        () => patch.block,
      ).blocks;
      continue;
    }
    if (patch.op === "update-rich-text") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "rich-text") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not rich-text.`,
          );
        }
        return {
          ...block,
          ...(patch.title ? { title: patch.title } : {}),
          data: {
            markdown: patch.markdown ?? block.data.markdown,
            doc: patch.doc ?? block.data.doc,
          },
        };
      }).blocks;
      continue;
    }
    if (patch.op === "update-custom-html") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "custom-html") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not custom-html.`,
          );
        }
        return {
          ...block,
          ...(patch.title ? { title: patch.title } : {}),
          data: {
            html: patch.html ?? block.data.html,
            css: patch.css === null ? undefined : (patch.css ?? block.data.css),
            caption:
              patch.caption === null
                ? undefined
                : (patch.caption ?? block.data.caption),
          },
        };
      }).blocks;
      continue;
    }
    if (patch.op === "update-wireframe-region") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "sketch-wireframe") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not sketch-wireframe.`,
          );
        }
        let changed = false;
        const regions = block.data.regions.map((region) => {
          if (region.id !== patch.regionId) return region;
          changed = true;
          return {
            ...region,
            ...patch.patch,
            label:
              patch.patch.label === null
                ? undefined
                : (patch.patch.label ?? region.label),
          };
        });
        if (!changed) {
          throw new Error(
            `Wireframe region ${patch.regionId} was not found in block ${patch.blockId}.`,
          );
        }
        return { ...block, data: { ...block.data, regions } };
      }).blocks;
      continue;
    }
    if (patch.op === "replace-wireframe-regions") {
      next.blocks = updateBlock(next.blocks, patch.blockId, (block) => {
        if (block.type !== "sketch-wireframe") {
          throw new Error(
            `Block ${patch.blockId} is ${block.type}, not sketch-wireframe.`,
          );
        }
        return { ...block, data: { ...block.data, regions: patch.regions } };
      }).blocks;
      continue;
    }
    if (patch.op === "update-canvas-frame") {
      const frame = next.canvas?.frames.find(
        (candidate) => candidate.id === patch.frameId,
      );
      if (!frame) {
        throw new Error(`Canvas frame ${patch.frameId} was not found.`);
      }
      Object.assign(frame, patch.patch);
      continue;
    }
    if (patch.op === "append-block") {
      if (patch.parent) {
        next.blocks = updateBlock(
          next.blocks,
          patch.parent.tabBlockId,
          (block) => {
            if (block.type !== "tabs") {
              throw new Error(
                `Block ${patch.parent?.tabBlockId} is ${block.type}, not tabs.`,
              );
            }
            let changed = false;
            const tabs = block.data.tabs.map((tab) => {
              if (tab.id !== patch.parent?.tabId) return tab;
              changed = true;
              return {
                ...tab,
                blocks: insertBlock(
                  tab.blocks,
                  patch.block,
                  patch.afterBlockId,
                ),
              };
            });
            if (!changed) {
              throw new Error(`Tab ${patch.parent.tabId} was not found.`);
            }
            return { ...block, data: { tabs } };
          },
        ).blocks;
      } else {
        next.blocks = insertBlock(next.blocks, patch.block, patch.afterBlockId);
      }
      continue;
    }
    if (patch.op === "remove-block") {
      const result = removeBlock(next.blocks, patch.blockId);
      if (!result.changed) {
        throw new Error(`Block ${patch.blockId} was not found.`);
      }
      next.blocks = result.blocks;
    }
  }

  syncCanvasWireframes(next);
  return planContentSchema.parse(next);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function updateBlock(
  blocks: PlanBlock[],
  blockId: string,
  updater: (block: PlanBlock) => PlanBlock,
): { blocks: PlanBlock[]; changed: boolean } {
  const result = updateBlockRecursive(blocks, blockId, updater);
  if (!result.changed) throw new Error(`Block ${blockId} was not found.`);
  return result;
}

function updateBlockRecursive(
  blocks: PlanBlock[],
  blockId: string,
  updater: (block: PlanBlock) => PlanBlock,
): { blocks: PlanBlock[]; changed: boolean } {
  let changed = false;
  const nextBlocks = blocks.map((block) => {
    if (block.id === blockId) {
      changed = true;
      return updater(block);
    }
    if (block.type !== "tabs") return block;
    const childResult = block.data.tabs.reduce<{
      tabs: PlanTabsBlock["data"]["tabs"];
      changed: boolean;
    }>(
      (acc, tab) => {
        const updated = updateBlockRecursive(tab.blocks, blockId, updater);
        acc.tabs.push({ ...tab, blocks: updated.blocks });
        acc.changed = acc.changed || updated.changed;
        return acc;
      },
      { tabs: [], changed: false },
    );
    if (!childResult.changed) return block;
    changed = true;
    return { ...block, data: { tabs: childResult.tabs } };
  });
  return { blocks: nextBlocks, changed };
}

function insertBlock(
  blocks: PlanBlock[],
  block: PlanBlock,
  afterBlockId?: string,
): PlanBlock[] {
  const parsedBlock = planBlockSchema.parse(block);
  if (!afterBlockId) return [...blocks, parsedBlock];
  const index = blocks.findIndex((candidate) => candidate.id === afterBlockId);
  if (index === -1) {
    throw new Error(`Block ${afterBlockId} was not found.`);
  }
  return [
    ...blocks.slice(0, index + 1),
    parsedBlock,
    ...blocks.slice(index + 1),
  ];
}

function removeBlock(
  blocks: PlanBlock[],
  blockId: string,
): { blocks: PlanBlock[]; changed: boolean } {
  let changed = false;
  const filtered = blocks
    .filter((block) => {
      if (block.id === blockId) {
        changed = true;
        return false;
      }
      return true;
    })
    .map((block) => {
      if (block.type !== "tabs") return block;
      const tabs = block.data.tabs.map((tab) => {
        const result = removeBlock(tab.blocks, blockId);
        changed = changed || result.changed;
        return { ...tab, blocks: result.blocks };
      });
      return { ...block, data: { tabs } };
    });
  return { blocks: filtered, changed };
}

function syncCanvasWireframes(content: PlanContent) {
  if (!content.canvas) return;
  const blocks = new Map<string, PlanBlock>();
  const visit = (block: PlanBlock) => {
    blocks.set(block.id, block);
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        for (const child of tab.blocks) visit(child);
      }
    }
  };
  for (const block of content.blocks) visit(block);

  for (const frame of content.canvas.frames) {
    if (!frame.blockId) continue;
    const block = blocks.get(frame.blockId);
    if (block?.type === "sketch-wireframe") {
      frame.wireframe = cloneJson(block.data);
    }
  }
}

export function createPlanBlockId(prefix: string): string {
  const safePrefix = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${safePrefix || "block"}-${random}`;
}
