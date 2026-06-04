import {
  PLAN_CONTENT_VERSION,
  createPlanBlockId,
  planContentSchema,
  type PlanBlock,
  type PlanCanvasFrame,
  type PlanContent,
  type PlanContentInput,
  type PlanDiagramEdge,
  type PlanSketchDiagramBlock,
  type PlanSketchWireframeBlock,
  type PlanWireframeRegion,
  type PlanVisualQuestion,
} from "../shared/plan-content.js";
import type { PlanSection } from "../shared/types.js";

type SectionLike = Pick<PlanSection, "id" | "type" | "title" | "body" | "html">;

export function parsePlanContent(value: unknown): PlanContent | null {
  if (!value) return null;
  const parsedValue =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;
  if (!parsedValue) return null;
  const result = planContentSchema.safeParse(parsedValue);
  return result.success ? result.data : null;
}

export function serializePlanContent(content: PlanContentInput): string {
  return JSON.stringify(planContentSchema.parse(content));
}

export function normalizePlanContent(
  content: PlanContentInput | undefined,
): PlanContent | null {
  if (!content) return null;
  return planContentSchema.parse(content);
}

export function createPlanContentFromSections(input: {
  title: string;
  brief: string;
  sections: SectionLike[];
}): PlanContent {
  const blocks = input.sections.map((section, index) =>
    blockFromSection(section, index),
  );
  return planContentSchema.parse({
    version: PLAN_CONTENT_VERSION,
    title: input.title,
    brief: input.brief,
    canvas: findCanvas(blocks),
    blocks,
  });
}

export function createDefaultPlanContent(input: {
  title: string;
  brief: string;
  repoPath?: string | null;
}): PlanContent {
  return planContentSchema.parse({
    version: PLAN_CONTENT_VERSION,
    title: input.title,
    brief: input.brief,
    blocks: [
      {
        id: createPlanBlockId("plan-summary"),
        type: "rich-text",
        title: "What Matters Most",
        editable: true,
        data: {
          markdown: input.brief,
        },
      },
      {
        id: createPlanBlockId("flow"),
        type: "sketch-diagram",
        title: "Plan Flow",
        data: {
          nodes: [
            { id: "intent", label: "Intent", detail: "Clarify the target" },
            { id: "review", label: "Review", detail: "Comment on the plan" },
            { id: "build", label: "Build", detail: "Agent implements" },
            { id: "verify", label: "Verify", detail: "Check the result" },
          ],
          edges: [
            { from: "intent", to: "review" },
            { from: "review", to: "build" },
            { from: "build", to: "verify" },
          ],
        },
      },
      {
        id: createPlanBlockId("implementation-map"),
        type: "implementation-map",
        title: "Implementation Map",
        data: {
          files: [
            {
              path: input.repoPath ? `${input.repoPath}/...` : "repo/path.tsx",
              title: "Files to inspect",
              note: "Replace this with concrete file references, symbols, and short snippets after the repo pass.",
              language: "text",
            },
          ],
        },
      },
    ],
  });
}

export function createUiPlanContent(input: {
  title: string;
  brief: string;
  source?: string;
  repoPath?: string | null;
  states: Array<{ name: string; description: string }>;
  components: Array<{ name: string; description: string }>;
  implementationNotes?: string | null;
}): PlanContent {
  const states = input.states;
  const stateIds = uniqueIds(
    states.map((state, index) => slug(state.name) || `state-${index + 1}`),
  );
  const stateBlockIds = stateIds.map((id) => ({
    notes: createPlanBlockId(`${id}-notes`),
    wireframe: createPlanBlockId(`${id}-wireframe`),
  }));
  const componentIds = uniqueIds(
    input.components.map(
      (component, index) => slug(component.name) || `component-${index + 1}`,
    ),
  );
  const componentPlan = isComponentPlan(input);
  const frames: PlanCanvasFrame[] = states.slice(0, 6).map((state, index) => ({
    id: `frame-${stateIds[index] ?? index + 1}`,
    title: state.name,
    blockId: stateBlockIds[index]?.wireframe,
    wireframe: createWireframeData({
      title: state.name,
      description: state.description,
      viewport: viewportForState(state, componentPlan),
      component: componentPlan,
    }),
    ...(componentPlan
      ? {
          x: 80 + (index % 3) * 420,
          y: 96 + Math.floor(index / 3) * 430,
          width: 360,
          height: 360,
        }
      : {}),
  }));
  const stateFlow = shouldUseStateFlow(input, componentPlan);
  const flow: PlanDiagramEdge[] = stateFlow
    ? frames.slice(0, -1).map((frame, index) => ({
        from: frame.id,
        to: frames[index + 1]?.id ?? frame.id,
        label: `Step ${index + 1}`,
      }))
    : [];
  const blocks: PlanBlock[] = [
    {
      id: createPlanBlockId("summary"),
      type: "rich-text",
      title: "What Matters Most",
      editable: true,
      data: {
        markdown: input.brief,
      },
    },
    ...(states.length > 0
      ? ([
          {
            id: createPlanBlockId("screen-states"),
            type: "tabs",
            title: componentPlan ? "Component States" : "Screen States",
            data: {
              tabs: states.map((state, index) => ({
                id: stateIds[index] ?? createPlanBlockId("state"),
                label: state.name,
                blocks: [
                  {
                    id:
                      stateBlockIds[index]?.notes ??
                      createPlanBlockId(`${state.name}-notes`),
                    type: "rich-text",
                    title: state.name,
                    editable: true,
                    data: { markdown: state.description },
                  },
                  {
                    id:
                      stateBlockIds[index]?.wireframe ??
                      createPlanBlockId(`${state.name}-wireframe`),
                    type: "sketch-wireframe",
                    title: `${state.name} Wireframe`,
                    data: createWireframeData({
                      title: state.name,
                      description: state.description,
                      viewport: viewportForState(state, componentPlan),
                      component: componentPlan,
                    }),
                  },
                ],
              })),
            },
          },
          ...(stateFlow
            ? ([
                {
                  id: createPlanBlockId("flow-diagram"),
                  type: "sketch-diagram",
                  title: "Flow Diagram",
                  data: {
                    nodes: states.slice(0, 6).map((state, index) => ({
                      id: stateIds[index] ?? `state-${index + 1}`,
                      label: state.name,
                      detail: state.description,
                    })),
                    edges: states.slice(0, -1).map((state, index) => ({
                      from: stateIds[index] ?? `state-${index + 1}`,
                      to: stateIds[index + 1] ?? `state-${index + 2}`,
                      label: `Step ${index + 1}`,
                    })),
                  },
                },
              ] satisfies PlanBlock[])
            : []),
        ] satisfies PlanBlock[])
      : []),
    ...(input.components.length > 0
      ? ([
          {
            id: createPlanBlockId("components"),
            type: "tabs",
            title: "Interaction Notes",
            data: {
              tabs: input.components.map((component, index) => ({
                id: componentIds[index] ?? `component-${index + 1}`,
                label: component.name,
                blocks: [
                  {
                    id: createPlanBlockId(`${component.name}-detail`),
                    type: "rich-text",
                    title: component.name,
                    editable: true,
                    data: { markdown: component.description },
                  },
                  {
                    id: createPlanBlockId(`${component.name}-sketch`),
                    type: "sketch-wireframe",
                    title: `${component.name} Sketch`,
                    data: createWireframeData({
                      title: component.name,
                      description: component.description,
                      viewport: "desktop",
                      component: true,
                    }),
                  },
                ],
              })),
            },
          },
        ] satisfies PlanBlock[])
      : []),
    {
      id: createPlanBlockId("implementation-map"),
      type: "implementation-map",
      title: "Implementation Map",
      data: {
        files: [
          {
            path: input.repoPath ? `${input.repoPath}/...` : "repo/path.tsx",
            title: "Implementation notes",
            note:
              input.implementationNotes ||
              "Add concrete file references, state ownership, actions, accessibility checks, and the smallest snippets needed.",
            language: "tsx",
            snippet: `const planShape = {\n  canvas: "when states or components exist",\n  document: "editable rich blocks",\n};`,
          },
        ],
      },
    },
  ];

  return planContentSchema.parse({
    version: PLAN_CONTENT_VERSION,
    title: input.title,
    brief: input.brief,
    ...(frames.length > 0
      ? {
          canvas: {
            title: componentPlan ? "Component States" : "UI Flow",
            frames,
            ...(flow.length > 0 ? { flow } : {}),
            ...(componentPlan
              ? {}
              : {
                  notes: [
                    {
                      id: "canvas-note-review",
                      title: "Read this like a design handoff.",
                      body: "Pan and zoom to compare states, then scroll for the document spec.",
                      x: 80,
                      y: 560,
                    },
                  ],
                }),
          },
        }
      : {}),
    blocks,
  });
}

function isComponentPlan(input: {
  title: string;
  brief: string;
  states: Array<{ name: string; description: string }>;
  components: Array<{ name: string; description: string }>;
}) {
  const text = [
    input.title,
    input.brief,
    ...input.states.flatMap((state) => [state.name, state.description]),
    ...input.components.flatMap((component) => [
      component.name,
      component.description,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return /\b(component|widget|popover|sidebar|side\s*panel|panel|dialog|modal|dropdown|toolbar|inspector|menu|card)\b/.test(
    text,
  );
}

function shouldUseStateFlow(
  input: {
    title: string;
    brief: string;
    states: Array<{ name: string; description: string }>;
  },
  componentPlan: boolean,
) {
  if (componentPlan || input.states.length < 2) return false;
  const text = [
    input.title,
    input.brief,
    ...input.states.map((state) => state.name),
  ]
    .join(" ")
    .toLowerCase();
  return /\b(flow|journey|sequence|wizard|checkout|onboard|handoff|step|next|submit|confirm|complete|path)\b/.test(
    text,
  );
}

function viewportForState(
  state: { name: string; description: string },
  componentPlan: boolean,
): "desktop" | "tablet" | "phone" {
  if (componentPlan) return "desktop";
  const name = state.name.toLowerCase();
  const description = state.description.toLowerCase();
  if (/\b(phone|mobile|narrow)\b/.test(name)) return "phone";
  if (/\b(tablet)\b/.test(name)) return "tablet";
  if (/\b(tablet-only|tablet first|tablet-first)\b/.test(description)) {
    return "tablet";
  }
  if (
    /\b(phone-only|mobile-only|mobile first|mobile-first|narrow screen|single-column mobile)\b/.test(
      description,
    )
  ) {
    return "phone";
  }
  return "desktop";
}

function uniqueIds(values: string[]): string[] {
  const counts = new Map<string, number>();
  return values.map((value) => {
    const count = counts.get(value) ?? 0;
    counts.set(value, count + 1);
    return count === 0 ? value : `${value}-${count + 1}`;
  });
}

export type VisualQuestionBuilderInput = {
  id: string;
  type: "single" | "multi" | "freeform" | "visual";
  title: string;
  subtitle?: string;
  options?: Array<{
    value?: string;
    label: string;
    description?: string;
    recommended?: boolean;
    preview?: "desktop" | "mobile" | "split" | "flow" | "diagram";
    bullets?: string[];
  }>;
  allowOther?: boolean;
  placeholder?: string;
};

type VisualQuestionPreview = NonNullable<
  VisualQuestionBuilderInput["options"]
>[number]["preview"];

export function createVisualQuestionsContent(input: {
  title: string;
  brief: string;
  questions: VisualQuestionBuilderInput[];
}): PlanContent {
  const questions = input.questions.length
    ? input.questions
    : defaultVisualQuestions(input.brief);
  const visualQuestions: PlanVisualQuestion[] = questions.map((question) => ({
    id: question.id,
    title: question.title,
    subtitle: question.subtitle,
    mode:
      question.type === "multi"
        ? "multi"
        : question.type === "freeform"
          ? "freeform"
          : "single",
    options: question.options?.map((option, index) => ({
      id: option.value || slug(option.label) || `option-${index + 1}`,
      label: option.label,
      detail: [
        option.description,
        ...(option.bullets?.map((bullet) => `- ${bullet}`) ?? []),
      ]
        .filter(Boolean)
        .join("\n"),
      recommended: option.recommended,
      wireframe: previewToWireframe(option.preview, option.label),
      diagram: previewToDiagram(option.preview, option.label),
    })),
  }));

  return planContentSchema.parse({
    version: PLAN_CONTENT_VERSION,
    title: input.title,
    brief: input.brief,
    blocks: [
      {
        id: createPlanBlockId("visual-intake"),
        type: "visual-questions",
        title: input.title,
        data: {
          questions: visualQuestions,
          submitLabel: "Send to agent",
        },
      },
    ],
  });
}

export function buildPlanContentHtml(input: {
  content: PlanContent;
  title: string;
  brief: string;
  source?: string | null;
  status?: string | null;
  repoPath?: string | null;
}) {
  const planLabel =
    input.content.canvas?.title === "UI Flow" ? "UI Plan" : "Visual Plan";
  const canvas = input.content.canvas
    ? renderCanvasHtml(input.content.canvas)
    : "";
  const blocks = input.content.blocks.map(renderBlockHtml).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>${CONTENT_EXPORT_CSS}</style>
</head>
<body>
  ${canvas}
  <main>
    <section class="hero">
      <p class="kicker">${escapeHtml(planLabel)}</p>
      <h1>${escapeHtml(input.content.title || input.title)}</h1>
      <p class="lede">${escapeHtml(input.content.brief || input.brief)}</p>
    </section>
    ${blocks}
  </main>
</body>
</html>`;
}

function blockFromSection(section: SectionLike, index: number): PlanBlock {
  if (section.html?.trim()) {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "custom-html",
      title: section.title,
      data: {
        html: section.html,
        caption: section.body,
      },
    };
  }
  if (section.type === "implementation") {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "implementation-map",
      title: section.title,
      data: {
        files: [
          {
            path: "repo/path.tsx",
            title: "Implementation detail",
            note: section.body || "Add concrete file and symbol notes here.",
            language: "tsx",
          },
        ],
      },
    };
  }
  if (section.type === "wireframe" || section.type === "mockup") {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "sketch-wireframe",
      title: section.title,
      summary: section.body,
      data: createWireframeData({
        title: section.title,
        description: section.body,
        viewport: index === 0 ? "desktop" : "phone",
      }),
    };
  }
  if (section.type === "diagram") {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "sketch-diagram",
      title: section.title,
      data: createBasicDiagram(section.title, section.body),
    };
  }
  if (section.type === "questions" || section.type === "decisions") {
    return {
      id: section.id || createPlanBlockId(section.title),
      type: "decision",
      title: section.title,
      data: {
        question: section.title,
        options: markdownLines(section.body).map((line, optionIndex) => ({
          id: `option-${optionIndex + 1}`,
          label: line,
        })),
      },
    };
  }
  return {
    id: section.id || createPlanBlockId(section.title),
    type: "rich-text",
    title: section.title,
    editable: true,
    data: {
      markdown: section.body,
    },
  };
}

function findCanvas(blocks: PlanBlock[]): PlanContent["canvas"] | undefined {
  const frames = blocks
    .filter((block): block is PlanSketchWireframeBlock => {
      return block.type === "sketch-wireframe";
    })
    .slice(0, 6)
    .map<PlanCanvasFrame>((block, index) => ({
      id: `frame-${block.id}`,
      title: block.title || `Frame ${index + 1}`,
      blockId: block.id,
      wireframe: block.data,
    }));
  if (frames.length === 0) return undefined;
  return {
    title: "Wireframes",
    frames,
    flow: frames.slice(0, -1).map((frame, index) => ({
      from: frame.id,
      to: frames[index + 1]?.id ?? frame.id,
      label: `Step ${index + 1}`,
    })),
  };
}

function createWireframeData(input: {
  title: string;
  description?: string;
  viewport?: "desktop" | "tablet" | "phone";
  component?: boolean;
}): PlanSketchWireframeBlock["data"] {
  const viewport = input.viewport ?? "desktop";
  if (input.component) {
    return {
      viewport,
      caption: input.description,
      regions: createComponentWireframeRegions(input),
    };
  }
  if (viewport === "phone") {
    return {
      viewport,
      caption: input.description,
      regions: [
        { id: "top", kind: "header", x: 8, y: 5, width: 84, height: 10 },
        { id: "tabs", kind: "toolbar", x: 10, y: 20, width: 70, height: 8 },
        { id: "list", kind: "list", x: 10, y: 34, width: 78, height: 42 },
        {
          id: "action",
          kind: "button",
          x: 70,
          y: 82,
          width: 16,
          height: 9,
          emphasis: true,
        },
      ],
    };
  }
  return {
    viewport,
    caption: input.description,
    regions: [
      { id: "chrome", kind: "header", x: 3, y: 4, width: 94, height: 8 },
      { id: "nav", kind: "nav", x: 3, y: 12, width: 22, height: 78 },
      { id: "title", kind: "header", x: 30, y: 18, width: 48, height: 11 },
      { id: "toolbar", kind: "toolbar", x: 30, y: 34, width: 36, height: 8 },
      { id: "content", kind: "list", x: 30, y: 46, width: 62, height: 34 },
      {
        id: "primary",
        kind: "button",
        x: 82,
        y: 20,
        width: 12,
        height: 8,
        emphasis: true,
      },
    ],
  };
}

function createComponentWireframeRegions(input: {
  title: string;
  description?: string;
}): PlanWireframeRegion[] {
  const text = `${input.title} ${input.description ?? ""}`.toLowerCase();
  if (/\b(chat|message|composer|thinking)\b/.test(text)) {
    return [
      componentShell(),
      {
        id: "messages",
        kind: "list",
        label: "Chat messages",
        x: 14,
        y: 15,
        width: 72,
        height: 42,
        emphasis: true,
      },
      {
        id: "thinking-status",
        kind: "toolbar",
        label: "Thinking status",
        x: 14,
        y: 62,
        width: 40,
        height: 8,
      },
      {
        id: "composer",
        kind: "input",
        label: "Composer",
        x: 14,
        y: 76,
        width: 72,
        height: 10,
      },
    ];
  }

  const looksLikeContextXRay =
    /\b(context\s*x-?ray|x-?ray|popover|usage|meter|list\/?map)\b/.test(text);

  if (
    !looksLikeContextXRay &&
    /\b(map|treemap|token distribution)\b/.test(text)
  ) {
    return [
      componentShell(),
      {
        id: "map-title",
        kind: "header",
        label: "Map",
        x: 14,
        y: 12,
        width: 36,
        height: 9,
        emphasis: true,
      },
      {
        id: "token-map",
        kind: "content",
        label: "Token map",
        x: 14,
        y: 28,
        width: 72,
        height: 38,
        emphasis: true,
      },
      {
        id: "legend",
        kind: "toolbar",
        label: "Legend",
        x: 14,
        y: 72,
        width: 34,
        height: 8,
      },
      {
        id: "selected-summary",
        kind: "content",
        label: "Selected 2.0k",
        x: 54,
        y: 72,
        width: 32,
        height: 8,
      },
    ];
  }

  if (/\b(expanded|segment|detail|pin|evict|protected)\b/.test(text)) {
    return [
      componentShell(),
      {
        id: "segment-title",
        kind: "header",
        label: "Conversation",
        x: 14,
        y: 12,
        width: 42,
        height: 9,
        emphasis: true,
      },
      {
        id: "segment-usage",
        kind: "toolbar",
        label: "2.0k protected",
        x: 58,
        y: 12,
        width: 28,
        height: 9,
      },
      {
        id: "user-row",
        kind: "list",
        label: "User message",
        x: 14,
        y: 30,
        width: 72,
        height: 14,
      },
      {
        id: "tool-row",
        kind: "list",
        label: "Tool result",
        x: 14,
        y: 49,
        width: 72,
        height: 14,
      },
      {
        id: "pin-evict",
        kind: "button",
        label: "Pin / evict",
        x: 58,
        y: 72,
        width: 28,
        height: 9,
        emphasis: true,
      },
    ];
  }

  if (looksLikeContextXRay) {
    return [
      componentShell(),
      {
        id: "xray-title",
        kind: "header",
        label: "Context X-Ray",
        x: 14,
        y: 12,
        width: 46,
        height: 9,
        emphasis: true,
      },
      {
        id: "usage-meter",
        kind: "content",
        label: "2.0k used",
        x: 14,
        y: 28,
        width: 72,
        height: 20,
      },
      {
        id: "view-toggle",
        kind: "toolbar",
        label: "List / Map",
        x: 14,
        y: 54,
        width: 38,
        height: 8,
      },
      {
        id: "conversation-group",
        kind: "list",
        label: "Conversation",
        x: 14,
        y: 68,
        width: 72,
        height: 18,
        emphasis: true,
      },
      {
        id: "row-action",
        kind: "button",
        label: "Pin",
        x: 70,
        y: 76,
        width: 14,
        height: 7,
      },
    ];
  }

  return [
    componentShell(),
    {
      id: "title",
      kind: "header",
      label: input.title,
      x: 14,
      y: 12,
      width: 42,
      height: 9,
      emphasis: true,
    },
    { id: "summary", kind: "content", x: 14, y: 28, width: 72, height: 18 },
    { id: "controls", kind: "toolbar", x: 14, y: 52, width: 36, height: 8 },
    {
      id: "content",
      kind: "list",
      x: 14,
      y: 66,
      width: 72,
      height: 20,
      emphasis: true,
    },
  ];
}

function componentShell(): PlanWireframeRegion {
  return { id: "shell", kind: "content", x: 8, y: 6, width: 84, height: 88 };
}

function createBasicDiagram(
  title: string,
  body: string,
): PlanSketchDiagramBlock["data"] {
  const labels = markdownLines(body).slice(0, 5);
  const nodes = (labels.length ? labels : [title, "Review", "Build", "Verify"])
    .slice(0, 6)
    .map((label, index) => ({
      id: `node-${index + 1}`,
      label,
    }));
  return {
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      from: node.id,
      to: nodes[index + 1]?.id ?? node.id,
    })),
  };
}

function renderBlockHtml(block: PlanBlock): string {
  const title = block.title ? `<h2>${escapeHtml(block.title)}</h2>` : "";
  if (block.type === "rich-text") {
    return `<section class="plan-block">${title}<div class="copy">${markdownToHtml(block.data.markdown)}</div></section>`;
  }
  if (block.type === "callout") {
    return `<aside class="callout ${escapeHtml(block.data.tone || "info")}">${title}<p>${escapeHtml(block.data.body)}</p></aside>`;
  }
  if (block.type === "checklist") {
    return `<section class="plan-block">${title}<ul class="checklist">${block.data.items.map((item) => `<li>${item.checked ? "[x]" : "[ ]"} ${escapeHtml(item.label)}</li>`).join("")}</ul></section>`;
  }
  if (block.type === "table") {
    return `<section class="plan-block">${title}<table><thead><tr>${block.data.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${block.data.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
  }
  if (block.type === "code-tabs") {
    return `<section class="plan-block">${title}<div class="code-tabs">${block.data.tabs.map((tab) => `<article><h3>${escapeHtml(tab.label)}</h3><pre><code>${escapeHtml(tab.code)}</code></pre></article>`).join("")}</div></section>`;
  }
  if (block.type === "implementation-map") {
    return `<section class="plan-block">${title}<div class="implementation-map">${block.data.files.map((file) => `<article><h3>${escapeHtml(file.title || file.path)}</h3><p><code>${escapeHtml(file.path)}</code></p><p>${escapeHtml(file.note)}</p>${file.snippet ? `<pre><code>${escapeHtml(file.snippet)}</code></pre>` : ""}</article>`).join("")}</div></section>`;
  }
  if (block.type === "sketch-wireframe") {
    return `<section class="plan-block sketch-block">${title}${renderWireframeHtml(block.data)}</section>`;
  }
  if (block.type === "sketch-diagram") {
    return `<section class="plan-block sketch-block">${title}${renderDiagramHtml(block.data)}</section>`;
  }
  if (block.type === "decision") {
    return `<section class="plan-block">${title}<h3>${escapeHtml(block.data.question)}</h3><div class="chips">${block.data.options.map((option) => `<span>${escapeHtml(option.label)}</span>`).join("")}</div></section>`;
  }
  if (block.type === "tabs") {
    return `<section class="plan-block">${title}<div class="tab-export">${block.data.tabs.map((tab) => `<article><h3>${escapeHtml(tab.label)}</h3>${tab.blocks.map(renderBlockHtml).join("")}</article>`).join("")}</div></section>`;
  }
  if (block.type === "custom-html") {
    const source = [
      block.data.css ? `<style>\n${block.data.css}\n</style>` : "",
      block.data.html,
    ]
      .filter(Boolean)
      .join("\n");
    return `<section class="plan-block">${title}<div class="custom-fragment"><p class="caption">Custom HTML fragment. Plans renders this safely in a sandboxed iframe; standalone exports show the source instead of executing it.</p><pre><code>${escapeHtml(source)}</code></pre></div>${block.data.caption ? `<p class="caption">${escapeHtml(block.data.caption)}</p>` : ""}</section>`;
  }
  if (block.type === "visual-questions") {
    return `<section class="plan-block">${title}${block.data.questions.map((question, index) => `<article class="question"><h3>${index + 1}. ${escapeHtml(question.title)}</h3>${question.subtitle ? `<p>${escapeHtml(question.subtitle)}</p>` : ""}<div class="chips">${question.options?.map((option) => `<span>${escapeHtml(option.label)}</span>`).join("") ?? ""}</div></article>`).join("")}</section>`;
  }
  return "";
}

function renderCanvasHtml(canvas: NonNullable<PlanContent["canvas"]>): string {
  const layoutFrames = layoutCanvasFrames(canvas.frames);
  const frames = layoutFrames
    .map(
      (
        frame,
      ) => `<div class="canvas-frame" style="left:${frame.x ?? 80}px;top:${frame.y ?? 80}px;width:${frame.width ?? 420}px;height:${frame.height ?? 360}px">
        <h3>${escapeHtml(frame.title)}</h3>
        ${frame.wireframe ? renderWireframeHtml(frame.wireframe) : ""}
      </div>`,
    )
    .join("");
  const notes = (canvas.notes ?? [])
    .map(
      (note) =>
        `<aside class="canvas-note" style="left:${note.x ?? 80}px;top:${note.y ?? 40}px"><strong>${escapeHtml(note.title || "Note")}</strong><p>${escapeHtml(note.body)}</p></aside>`,
    )
    .join("");
  return `<section class="canvas-export"><div class="canvas-inner">${frames}${notes}</div></section>`;
}

function layoutCanvasFrames(frames: PlanCanvasFrame[]): PlanCanvasFrame[] {
  return frames.map((frame, index) => {
    const explicitSize =
      frame.width !== undefined || frame.height !== undefined;
    const isPhone = frame.wireframe?.viewport === "phone";
    const width = frame.width ?? (isPhone ? 300 : index === 0 ? 640 : 560);
    const height = frame.height ?? (isPhone ? 520 : 420);
    if (frame.x !== undefined || frame.y !== undefined || explicitSize) {
      return {
        ...frame,
        width,
        height,
        x: frame.x ?? 80,
        y: frame.y ?? 80,
      };
    }
    const desktopCountBefore = frames
      .slice(0, index)
      .filter((candidate) => candidate.wireframe?.viewport !== "phone").length;
    const phoneCountBefore = frames
      .slice(0, index)
      .filter((candidate) => candidate.wireframe?.viewport === "phone").length;
    return {
      ...frame,
      width,
      height,
      x: isPhone ? 760 + phoneCountBefore * 380 : 80 + desktopCountBefore * 700,
      y: isPhone ? 80 : 80 + Math.floor(desktopCountBefore / 2) * 520,
    };
  });
}

function renderWireframeHtml(data: PlanSketchWireframeBlock["data"]) {
  return `<div class="sketch-wireframe ${escapeHtml(data.viewport || "desktop")}">
    ${data.regions
      .map(
        (region) =>
          `<span class="sketch-region ${escapeHtml(region.kind)}${region.emphasis ? " emphasis" : ""}" style="left:${region.x}%;top:${region.y}%;width:${region.width}%;height:${region.height}%">${region.label ? escapeHtml(region.label) : ""}</span>`,
      )
      .join("")}
  </div>`;
}

function renderDiagramHtml(data: PlanSketchDiagramBlock["data"]) {
  const nodes = data.nodes;
  const positioned = nodes.map((node, index) => ({
    ...node,
    x: node.x ?? 12 + index * (76 / Math.max(nodes.length - 1, 1)),
    y: node.y ?? 50,
  }));
  return `<svg class="sketch-diagram" viewBox="0 0 100 100" role="img">
    ${data.edges
      .map((edge) => {
        const from = positioned.find((node) => node.id === edge.from);
        const to = positioned.find((node) => node.id === edge.to);
        if (!from || !to) return "";
        return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
      })
      .join("")}
    ${positioned
      .map(
        (node) =>
          `<g><rect x="${node.x - 8}" y="${node.y - 6}" width="16" height="12" rx="2" /><text x="${node.x}" y="${node.y + 1}">${escapeHtml(node.label)}</text></g>`,
      )
      .join("")}
  </svg>`;
}

function previewToWireframe(preview: VisualQuestionPreview, label: string) {
  if (preview === "desktop" || preview === "mobile" || preview === "split") {
    return createWireframeData({
      title: label,
      viewport: preview === "mobile" ? "phone" : "desktop",
    });
  }
  return undefined;
}

function previewToDiagram(preview: VisualQuestionPreview, label: string) {
  if (preview === "flow" || preview === "diagram") {
    return createBasicDiagram(label, "Start\nChoose\nBuild");
  }
  return undefined;
}

function defaultVisualQuestions(brief: string): VisualQuestionBuilderInput[] {
  return [
    {
      id: "form-factor",
      type: "single",
      title: "What form factor should lead?",
      subtitle: "Where should the first design direction feel native?",
      options: [
        { label: "Desktop web app", preview: "desktop" },
        { label: "Mobile app", preview: "mobile" },
        { label: "Both / responsive", recommended: true, preview: "split" },
        { label: "Decide for me" },
      ],
    },
    {
      id: "aesthetic",
      type: "multi",
      title: "What aesthetic direction appeals?",
      subtitle: "Pick any signals worth exploring.",
      options: [
        { label: "Calm and minimal" },
        { label: "Dense and productive" },
        { label: "Playful and colorful" },
        { label: "Editorial / typographic" },
        { label: "Sleek dark mode" },
      ],
    },
    {
      id: "scope",
      type: "freeform",
      title: "Anything the plan must include?",
      subtitle: brief,
    },
    {
      id: "flow-complexity",
      type: "visual",
      title: "How complex should the flow be?",
      subtitle: "Choose how much canvas vs document detail the plan needs.",
      options: [
        {
          label: "One polished path",
          description: "Fastest to approve with fewer branches.",
          preview: "flow",
          recommended: true,
        },
        {
          label: "A few variations",
          description: "Useful when direction is fuzzy and tradeoffs matter.",
          preview: "diagram",
        },
      ],
    },
  ];
}

function markdownLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[-*]\s+/, "")
        .replace(/^#+\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

function markdownToHtml(value: string) {
  const lines = value.split(/\r?\n/);
  const html: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    html.push(
      `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    );
    list = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      const level = Math.min(heading[1]?.length ?? 2, 3);
      html.push(`<h${level + 1}>${escapeHtml(heading[2])}</h${level + 1}>`);
      continue;
    }
    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (listItem?.[1]) {
      list.push(listItem[1]);
      continue;
    }
    flushList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushList();
  return html.join("\n");
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CONTENT_EXPORT_CSS = `
:root { color-scheme: light dark; --bg: #fbfaf8; --canvas: #f2f1ee; --paper: #ffffff; --line: #dedbd5; --text: #191918; --muted: #68645f; --accent: #3f7cff; --code-bg: #f4f4f2; --code-text: #242321; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f1e1d; --canvas: #1c1b1a; --paper: #22211f; --line: #393735; --text: #f3f2ef; --muted: #aaa6a0; --code-bg: #171615; --code-text: #f0efeb; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
main { width: min(1120px, calc(100vw - 48px)); margin: 0 auto; padding: 72px 0 96px; }
.canvas-export { height: 70vh; min-height: 520px; overflow: hidden; background-color: var(--canvas); background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 28px 28px; border-bottom: 1px solid var(--line); }
.canvas-inner { position: relative; width: 2400px; height: 1400px; }
.canvas-frame, .canvas-note { position: absolute; }
.canvas-frame h3 { margin: 0 0 8px; font-size: 14px; }
.canvas-note { width: 280px; color: var(--muted); }
.hero { padding-bottom: 34px; border-bottom: 1px solid var(--line); }
.kicker { color: var(--muted); font-size: 12px; font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; max-width: 880px; font-size: clamp(42px, 5vw, 74px); line-height: .98; letter-spacing: -.03em; }
.lede { max-width: 880px; color: var(--muted); font-size: 22px; }
.plan-block, .callout { margin-top: 60px; padding-top: 34px; border-top: 1px solid var(--line); }
h2 { margin: 0 0 18px; font-size: clamp(28px, 4vw, 44px); letter-spacing: -.025em; }
h3 { margin: 0 0 10px; }
.copy { max-width: 840px; color: var(--muted); font-size: 18px; }
.sketch-wireframe { position: relative; height: 360px; border: 2px solid currentColor; border-radius: 18px; color: #eceae5; background: var(--paper); }
.sketch-wireframe.phone { width: 260px; height: 480px; border-radius: 38px; }
.sketch-region { position: absolute; border: 1.5px solid currentColor; border-radius: 10px; color: inherit; }
.sketch-region.emphasis { border-color: var(--accent); }
.sketch-diagram { width: 100%; max-width: 900px; min-height: 260px; color: #eceae5; }
.sketch-diagram line { stroke: var(--accent); stroke-width: 1.7; stroke-linecap: round; }
.sketch-diagram rect { fill: var(--paper); stroke: currentColor; stroke-width: 1.3; }
.sketch-diagram text { fill: currentColor; font: 4px ui-sans-serif, system-ui; text-anchor: middle; dominant-baseline: middle; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips span { border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; color: var(--muted); }
pre { overflow: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--code-bg); padding: 16px; color: var(--code-text); }
code { font-family: "SFMono-Regular", Consolas, monospace; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid var(--line); padding: 10px; text-align: left; }
`;
