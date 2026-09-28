import matter from "gray-matter";

import {
  PLAN_CONTENT_VERSION,
  type PlanBlock,
} from "../shared/plan-content.js";
import { exportPlanContentToMdxFolder } from "./plan-mdx.js";

export const PRIORITY_EXAMPLE_BLOCK_TYPES = [
  "columns",
  "tabs",
  "api-endpoint",
  "data-model",
  "annotated-code",
  "diff",
  "file-tree",
  "diagram",
  "wireframe",
  "code",
  "callout",
  "checklist",
  "question-form",
  "rich-text",
  "json-explorer",
  "table",
] as const;

export type PriorityExampleBlockType =
  (typeof PRIORITY_EXAMPLE_BLOCK_TYPES)[number];

export const EXAMPLE_BLOCKS: Record<PriorityExampleBlockType, PlanBlock> = {
  columns: {
    id: "example-columns",
    type: "columns",
    data: {
      columns: [
        {
          id: "example-columns-before",
          label: "Before",
          blocks: [
            {
              id: "example-columns-before-wf",
              type: "wireframe",
              data: {
                surface: "panel",
                caption: "Single Save button, no autosave indicator.",
                screen: [
                  { el: "title", text: "Editor" },
                  { el: "btn", label: "Save" },
                ],
              },
            },
          ],
        },
        {
          id: "example-columns-after",
          label: "After",
          blocks: [
            {
              id: "example-columns-after-wf",
              type: "wireframe",
              data: {
                surface: "panel",
                caption: "Autosave pill replaces the manual Save button.",
                screen: [
                  { el: "title", text: "Editor" },
                  { el: "pill", label: "Saved" },
                ],
              },
            },
          ],
        },
      ],
    },
  },

  tabs: {
    id: "example-tabs",
    type: "tabs",
    data: {
      tabs: [
        {
          id: "example-tab-content",
          label: "plan-content.ts",
          blocks: [
            {
              id: "example-tab-content-note",
              type: "rich-text",
              data: { markdown: "Added per-block salvage to the parse path." },
            },
          ],
        },
        {
          id: "example-tab-mdx",
          label: "plan-mdx.ts",
          blocks: [
            {
              id: "example-tab-mdx-note",
              type: "rich-text",
              data: { markdown: "Threads the `salvageInvalidBlocks` flag." },
            },
          ],
        },
      ],
    },
  },

  "api-endpoint": {
    id: "example-api-endpoint",
    type: "api-endpoint",
    data: {
      method: "POST",
      path: "/v1/messages",
      summary: "Create a message",
      description: "Creates a message and returns the assistant response.",
      auth: "Bearer token",
      params: [
        { name: "idempotency-key", in: "header", type: "string" },
        {
          name: "model",
          in: "body",
          type: "string",
          required: true,
          description: "Model id.",
        },
      ],
      request: {
        contentType: "application/json",
        example: '{ "model": "claude-3", "messages": [] }',
      },
      responses: [
        { status: "200", description: "OK", example: '{ "id": "msg_1" }' },
        { status: "429", description: "Rate limited" },
      ],
    },
  },

  "data-model": {
    id: "example-data-model",
    type: "data-model",
    data: {
      entities: [
        {
          id: "plans",
          name: "plans",
          fields: [
            { name: "id", type: "uuid", pk: true },
            { name: "owner_id", type: "uuid", fk: "users.id" },
            { name: "content", type: "jsonb" },
          ],
        },
        {
          id: "users",
          name: "users",
          fields: [{ name: "id", type: "uuid", pk: true }],
        },
      ],
      relations: [{ from: "plans", to: "users", kind: "1-n" }],
    },
  },

  "annotated-code": {
    id: "example-annotated-code",
    type: "annotated-code",
    data: {
      filename: "server/plan-content.ts",
      language: "ts",
      code: [
        "export function normalizePlanContent(",
        "  content: PlanContentInput | undefined,",
        "  options: { salvageInvalidBlocks?: boolean } = {},",
        ") {",
        "  const migrated = migratePlanContent(content);",
        "  return sanitizePlanContent(planContentSchema.parse(migrated));",
        "}",
      ].join("\n"),
      annotations: [
        {
          lines: "4",
          label: "Salvage flag",
          note: "Recaps pass `salvageInvalidBlocks: true`; plans stay strict.",
        },
        { lines: "5-6", note: "Migrate legacy shapes before validating." },
      ],
    },
  },

  diff: {
    id: "example-diff",
    type: "diff",
    data: {
      filename: "server/plan-content.ts",
      language: "ts",
      mode: "split",
      before: "function parse(value) {\n  return JSON.parse(value);\n}\n",
      after:
        "function parse(value) {\n  try {\n    return JSON.parse(value);\n  } catch {\n    return null;\n  }\n}\n",
      annotations: [
        {
          side: "after",
          lines: "2-5",
          label: "Fail closed",
          note: "Return null instead of throwing on malformed JSON.",
        },
      ],
    },
  },

  "file-tree": {
    id: "example-file-tree",
    type: "file-tree",
    data: {
      title: "Files touched",
      entries: [
        {
          path: "server/plan-content.ts",
          change: "modified",
          note: "Added per-block salvage.",
        },
        {
          path: "server/plan-block-examples.ts",
          change: "added",
          note: "New canonical authoring examples.",
        },
      ],
    },
  },

  diagram: {
    id: "example-diagram",
    type: "diagram",
    data: {
      caption: "Recap import flow.",
      html: '<div class="diagram-panel" data-rough><div class="diagram-node">Diff</div><div class="diagram-node">Recap blocks</div><div class="diagram-node">Published recap</div></div>',
      css: ".diagram-panel { display: flex; gap: 12px; }",
    },
  },

  wireframe: {
    id: "example-wireframe",
    type: "wireframe",
    data: {
      surface: "desktop",
      caption: "Recap detail with a Files-touched rail.",
      screen: [
        {
          el: "row",
          children: [
            {
              el: "sidebar",
              children: [
                { el: "navItem", label: "Summary" },
                { el: "navItem", label: "Files touched", active: true },
              ],
            },
            {
              el: "main",
              children: [
                { el: "title", text: "Visual recap" },
                { el: "lines", n: 3 },
              ],
            },
          ],
        },
      ],
    },
  },

  code: {
    id: "example-code",
    type: "code",
    data: {
      filename: "server/plan-block-examples.ts",
      language: "ts",
      caption: "Serialize one canonical block to its MDX authoring form.",
      code: "const mdx = await serializeBlockToMdx(EXAMPLE_BLOCKS.code);\n",
    },
  },

  callout: {
    id: "example-callout",
    type: "callout",
    data: {
      tone: "info",
      body: "This recap is informational; reviewers still inspect the diff.",
    },
  },

  checklist: {
    id: "example-checklist",
    type: "checklist",
    data: {
      items: [
        {
          id: "verify-local-check",
          label: "Run `plan local check` before serving",
          checked: true,
        },
        {
          id: "open-in-chromium",
          label: "Open local-files plans in Chrome/Chromium",
          note: "Safari can block HTTPS pages from reading an HTTP localhost bridge.",
        },
      ],
    },
  },

  "question-form": {
    id: "example-question-form",
    type: "question-form",
    data: {
      submitLabel: "Send answers",
      questions: [
        {
          id: "local-mode-browser",
          title: "Which browser should local reviewers use?",
          subtitle: "Choose the default recommendation for local-files mode.",
          mode: "single",
          required: true,
          options: [
            {
              id: "chromium",
              label: "Chrome / Chromium",
              detail: "Best support for hosted HTTPS pages reading localhost.",
              recommended: true,
            },
            {
              id: "local-plan-app",
              label: "Local Plan app",
              detail: "Use when the Plan app is running on localhost too.",
            },
          ],
        },
        {
          id: "handoff-notes",
          title: "What should the agent preserve?",
          mode: "freeform",
          placeholder: "Add constraints or review notes...",
        },
      ],
    },
  },

  "rich-text": {
    id: "example-rich-text",
    type: "rich-text",
    data: {
      markdown:
        "### Summary\n\nAdds per-block salvage so one bad block never blanks a recap.",
    },
  },

  "json-explorer": {
    id: "example-json-explorer",
    type: "json-explorer",
    data: {
      title: "Recap payload",
      json: '{\n  "ok": true,\n  "blocks": 4,\n  "salvaged": 0\n}',
      collapsedDepth: 1,
    },
  },

  table: {
    id: "example-table",
    type: "table",
    data: {
      columns: ["Field", "Type", "Note"],
      rows: [
        ["id", "uuid", "primary key"],
        ["content", "jsonb", "normalized plan blocks"],
      ],
    },
  },
};

export async function serializeExampleBlockToMdx(
  block: PlanBlock,
): Promise<string> {
  const folder = await exportPlanContentToMdxFolder({
    title: "Authoring example",
    content: {
      version: PLAN_CONTENT_VERSION,
      title: "Authoring example",
      blocks: [block],
    },
  });
  return matter(folder["plan.mdx"]).content.trim();
}

export async function renderPlanBlockAuthoringExamples(): Promise<string> {
  const sections = await Promise.all(
    PRIORITY_EXAMPLE_BLOCK_TYPES.map(async (type) => {
      const mdx = await serializeExampleBlockToMdx(EXAMPLE_BLOCKS[type]);
      return `### \`${type}\`\n\n\`\`\`mdx\n${mdx}\n\`\`\``;
    }),
  );
  return [
    "",
    "",
    "## Authoring examples",
    "",
    "Copy a working shape from these complete, valid examples instead of inferring one from the JSON schema. Each is generated from a real block and round-trips through the strict source parser, so every required field is present (tab `id`, nested child `data`, checklist item `id`, question-form question/option `id`, api-endpoint `responses[].status`, non-empty `callout` body). Keep block `id`s unique and edit the content; do not drop required fields.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}
