import { describe, expect, it } from "vitest";

import { planContentSchema, type PlanContent } from "../shared/plan-content.js";
import {
  applyPlanMdxSourcePatches,
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";

/**
 * Deep round-trip / adversarial coverage for the MDX source-sync surface.
 *
 * Strategy: build a plan content with a given block, export to MDX, parse back,
 * and assert SEMANTIC equality of the round-tripped block data. Any divergence
 * is data loss/drift. We also probe byte-stability of repeated export, patch
 * targeting by stable id, and malformed/partial import handling.
 */

async function roundTrip(content: PlanContent): Promise<PlanContent> {
  const parsed = planContentSchema.parse(content);
  const folder = await exportPlanContentToMdxFolder({
    content: parsed,
    title: parsed.title ?? "Plan",
  });
  return parsePlanMdxFolder(folder);
}

function findBlock(content: PlanContent, id: string) {
  return content.blocks.find((block) => block.id === id);
}

describe("plan MDX round-trip fidelity per block type", () => {
  it("prototype.mdx: round-trips live prototype screens and transitions", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Prototype source",
      brief: "Click through the review flow.",
      prototype: {
        title: "Review prototype",
        brief: "Does the review flow feel right?",
        surface: "browser",
        initialScreenId: "start",
        screens: [
          {
            id: "start",
            title: "Start",
            summary: "Reviewer sees the request.",
            surface: "browser",
            renderMode: "design",
            html: '<div><h1>Request</h1><button data-goto="approved">Approve</button></div>',
            css: ".request-shell { color: #111827; }",
            state: [{ label: "Mode", value: "Review" }],
          },
          {
            id: "approved",
            title: "Approved",
            surface: "browser",
            html: "<div><h1>Approved</h1></div>",
          },
        ],
        transitions: [
          {
            from: "start",
            to: "approved",
            label: "Approve",
            trigger: "Click Approve",
          },
        ],
      },
      blocks: [
        {
          id: "summary",
          type: "rich-text",
          data: { markdown: "Prototype notes." },
        },
      ],
    };

    const folder = await exportPlanContentToMdxFolder({
      content,
      title: content.title ?? "Prototype source",
    });
    expect(folder["prototype.mdx"]).toContain("<Prototype");
    expect(folder["prototype.mdx"]).toContain("PrototypeScreen");

    const result = await parsePlanMdxFolder(folder);
    expect(result.prototype?.initialScreenId).toBe("start");
    expect(result.prototype?.screens[0]?.html).toContain(
      'data-goto="approved"',
    );
    expect(result.prototype?.screens[0]?.state?.[0]?.value).toBe("Review");
    expect(result.prototype?.screens[0]?.renderMode).toBe("design");
    expect(result.prototype?.screens[0]?.css).toBe(
      ".request-shell { color: #111827; }",
    );
    expect(result.prototype?.transitions?.[0]).toMatchObject({
      from: "start",
      to: "approved",
      label: "Approve",
    });
  });

  it("HTML wireframe: round-trips the html/css/skeleton fields without loss", async () => {
    const content: PlanContent = {
      version: 2,
      title: "HTML wireframe plan",
      blocks: [
        {
          id: "html-wf",
          type: "wireframe",
          title: "HTML mockup",
          data: {
            surface: "desktop",
            caption: "An HTML mockup screen",
            skeleton: false,
            renderMode: "design",
            html: '<div class="grid"><h1>Dashboard</h1><p>Welcome back</p></div>',
            css: ".grid { display: grid; gap: 8px; }",
          },
        },
      ],
    };

    const result = await roundTrip(content);
    const block = findBlock(result, "html-wf");
    expect(block?.type).toBe("wireframe");
    if (block?.type !== "wireframe") throw new Error("expected wireframe");
    // These three assertions pin the core data-loss bug for new html wireframes.
    expect(block.data.html).toBe(
      '<div class="grid"><h1>Dashboard</h1><p>Welcome back</p></div>',
    );
    expect(block.data.css).toBe(".grid { display: grid; gap: 8px; }");
    expect(block.data.caption).toBe("An HTML mockup screen");
    expect(block.data.renderMode).toBe("design");
  });

  it("skeleton wireframe: round-trips skeleton:true flag", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Skeleton plan",
      blocks: [
        {
          id: "skeleton-wf",
          type: "wireframe",
          title: "Loading state",
          data: {
            surface: "mobile",
            skeleton: true,
            screen: [{ id: "s", el: "screen", children: [] }],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "skeleton-wf");
    if (block?.type !== "wireframe") throw new Error("expected wireframe");
    expect(block.data.skeleton).toBe(true);
  });

  it("kit-tree wireframe: round-trips surface, caption, and nested nodes", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Kit wireframe",
      blocks: [
        {
          id: "kit-wf",
          type: "wireframe",
          data: {
            surface: "popover",
            caption: "Popover state",
            screen: [
              {
                id: "screen-1",
                el: "screen",
                children: [
                  { id: "title-1", el: "title", text: "Hello" },
                  {
                    id: "btn-1",
                    el: "btn",
                    label: "Submit",
                    tone: "accent",
                    solid: true,
                  },
                  {
                    id: "lines-1",
                    el: "lines",
                    n: 3,
                    widths: [80, 60, 40],
                  },
                  {
                    id: "chips-1",
                    el: "chips",
                    items: [
                      { label: "A", active: true, count: 3 },
                      { label: "B", dot: true },
                    ],
                  },
                  {
                    id: "kv-1",
                    el: "kv",
                    rows: [
                      { k: "Status", v: "Open" },
                      { k: "Owner", v: "Sam" },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "kit-wf");
    if (block?.type !== "wireframe") throw new Error("expected wireframe");
    expect(block.data.surface).toBe("popover");
    expect(block.data.caption).toBe("Popover state");
    const screen = block.data.screen?.[0];
    expect(screen?.children?.[0]?.text).toBe("Hello");
    expect(screen?.children?.[1]?.label).toBe("Submit");
    expect(screen?.children?.[1]?.tone).toBe("accent");
    expect(screen?.children?.[1]?.solid).toBe(true);
    expect(screen?.children?.[2]?.n).toBe(3);
    expect(screen?.children?.[2]?.widths).toEqual([80, 60, 40]);
    expect(screen?.children?.[3]?.items).toEqual([
      { label: "A", active: true, count: 3 },
      { label: "B", dot: true },
    ]);
    expect(screen?.children?.[4]?.rows).toEqual([
      { k: "Status", v: "Open" },
      { k: "Owner", v: "Sam" },
    ]);
  });

  it("callout: round-trips tone and body", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Callout",
      blocks: [
        {
          id: "callout-1",
          type: "callout",
          title: "Heads up",
          data: { tone: "risk", body: "This is a **risky** change." },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "callout-1");
    if (block?.type !== "callout") throw new Error("expected callout");
    expect(block.data.tone).toBe("risk");
    expect(block.data.body).toContain("risky");
  });

  it("checklist: round-trips items including checked + note", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Checklist",
      blocks: [
        {
          id: "check-1",
          type: "checklist",
          data: {
            items: [
              { id: "a", label: "Do thing", checked: true, note: "Done it" },
              { id: "b", label: "Other thing" },
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "check-1");
    if (block?.type !== "checklist") throw new Error("expected checklist");
    expect(block.data.items).toEqual([
      { id: "a", label: "Do thing", checked: true, note: "Done it" },
      { id: "b", label: "Other thing" },
    ]);
  });

  it("table: round-trips columns and rows", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Table",
      blocks: [
        {
          id: "table-1",
          type: "table",
          data: {
            columns: ["Name", "Value"],
            rows: [
              ["alpha", "1"],
              ["beta", "2"],
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "table-1");
    if (block?.type !== "table") throw new Error("expected table");
    expect(block.data.columns).toEqual(["Name", "Value"]);
    expect(block.data.rows).toEqual([
      ["alpha", "1"],
      ["beta", "2"],
    ]);
  });

  it("code-tabs: round-trips tabs with language, code, caption", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Code tabs",
      blocks: [
        {
          id: "code-1",
          type: "code-tabs",
          data: {
            tabs: [
              {
                id: "t1",
                label: "file.ts",
                language: "ts",
                code: "const x = 1;\nconsole.log(x);",
                caption: "A file",
              },
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "code-1");
    if (block?.type !== "code-tabs") throw new Error("expected code-tabs");
    expect(block.data.tabs).toEqual([
      {
        id: "t1",
        label: "file.ts",
        language: "ts",
        code: "const x = 1;\nconsole.log(x);",
        caption: "A file",
      },
    ]);
  });

  it("implementation-map: round-trips files with snippet", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Impl map",
      blocks: [
        {
          id: "impl-1",
          type: "implementation-map",
          data: {
            files: [
              {
                path: "src/foo.ts",
                title: "Foo",
                note: "Edit foo",
                language: "ts",
                snippet: "export const foo = () => 1;",
              },
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "impl-1");
    if (block?.type !== "implementation-map") {
      throw new Error("expected implementation-map");
    }
    expect(block.data.files).toEqual([
      {
        path: "src/foo.ts",
        title: "Foo",
        note: "Edit foo",
        language: "ts",
        snippet: "export const foo = () => 1;",
      },
    ]);
  });

  it("diagram: round-trips nodes, edges, notes", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Diagram",
      blocks: [
        {
          id: "diag-1",
          type: "diagram",
          data: {
            nodes: [
              { id: "n1", label: "Start", detail: "begin", x: 10, y: 20 },
              { id: "n2", label: "End" },
            ],
            edges: [{ from: "n1", to: "n2", label: "go" }],
            notes: [{ id: "note1", text: "remember", x: 5, y: 5 }],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "diag-1");
    if (block?.type !== "diagram") throw new Error("expected diagram");
    expect(block.data.nodes).toEqual([
      { id: "n1", label: "Start", detail: "begin", x: 10, y: 20 },
      { id: "n2", label: "End" },
    ]);
    expect(block.data.edges).toEqual([{ from: "n1", to: "n2", label: "go" }]);
    expect(block.data.notes).toEqual([
      { id: "note1", text: "remember", x: 5, y: 5 },
    ]);
  });

  it("image: round-trips url, alt, caption, fit", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Image",
      blocks: [
        {
          id: "img-1",
          type: "image",
          data: {
            url: "https://example.com/x.png",
            alt: "An image",
            caption: "Caption text",
            fit: "cover",
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "img-1");
    if (block?.type !== "image") throw new Error("expected image");
    expect(block.data.url).toBe("https://example.com/x.png");
    expect(block.data.alt).toBe("An image");
    expect(block.data.caption).toBe("Caption text");
    expect(block.data.fit).toBe("cover");
  });

  it("custom-html: round-trips html, css, caption", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Custom HTML",
      blocks: [
        {
          id: "chtml-1",
          type: "custom-html",
          data: {
            html: '<div class="card">Hello</div>',
            css: ".card { padding: 4px; }",
            caption: "A custom fragment",
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "chtml-1");
    if (block?.type !== "custom-html") throw new Error("expected custom-html");
    expect(block.data.html).toBe('<div class="card">Hello</div>');
    expect(block.data.css).toBe(".card { padding: 4px; }");
    expect(block.data.caption).toBe("A custom fragment");
  });

  it("tabs: round-trips nested blocks including a wireframe child", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Tabs",
      blocks: [
        {
          id: "tabs-1",
          type: "tabs",
          data: {
            tabs: [
              {
                id: "tab-a",
                label: "Notes",
                blocks: [
                  {
                    id: "tab-a-rt",
                    type: "rich-text",
                    data: { markdown: "Tab A content" },
                  },
                ],
              },
              {
                id: "tab-b",
                label: "Wireframe",
                blocks: [
                  {
                    id: "tab-b-wf",
                    type: "wireframe",
                    data: {
                      surface: "desktop",
                      screen: [
                        {
                          id: "tab-b-screen",
                          el: "screen",
                          children: [
                            {
                              id: "tab-b-title",
                              el: "title",
                              text: "Inside tab",
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "tabs-1");
    if (block?.type !== "tabs") throw new Error("expected tabs");
    expect(block.data.tabs[0]?.label).toBe("Notes");
    const tabARt = block.data.tabs[0]?.blocks[0];
    expect(tabARt?.type).toBe("rich-text");
    if (tabARt?.type === "rich-text") {
      expect(tabARt.data.markdown).toContain("Tab A content");
    }
    const tabBWf = block.data.tabs[1]?.blocks[0];
    expect(tabBWf?.type).toBe("wireframe");
    if (tabBWf?.type === "wireframe") {
      expect(tabBWf.data.screen?.[0]?.children?.[0]?.text).toBe("Inside tab");
    }
  });

  it("tabs: round-trips a nested HTML wireframe child without losing html", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Tabs html",
      blocks: [
        {
          id: "tabs-html",
          type: "tabs",
          data: {
            tabs: [
              {
                id: "tab-html",
                label: "Mockup",
                blocks: [
                  {
                    id: "tab-html-wf",
                    type: "wireframe",
                    data: {
                      surface: "desktop",
                      html: "<section><h2>Inside tab html</h2></section>",
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "tabs-html");
    if (block?.type !== "tabs") throw new Error("expected tabs");
    const wf = block.data.tabs[0]?.blocks[0];
    if (wf?.type !== "wireframe") throw new Error("expected wireframe child");
    expect(wf.data.html).toBe("<section><h2>Inside tab html</h2></section>");
  });

  it("columns: round-trips nested blocks in side-by-side panes", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Columns",
      blocks: [
        {
          id: "columns-1",
          type: "columns",
          title: "Before and after",
          data: {
            columns: [
              {
                id: "col-before",
                label: "Before",
                blocks: [
                  {
                    id: "col-before-text",
                    type: "rich-text",
                    data: { markdown: "Old behavior" },
                  },
                ],
              },
              {
                id: "col-after",
                label: "After",
                blocks: [
                  {
                    id: "col-after-model",
                    type: "data-model",
                    data: {
                      entities: [
                        {
                          id: "plans",
                          name: "plans",
                          fields: [
                            { name: "id", type: "text", pk: true },
                            { name: "visibility", type: "text" },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const folder = await exportPlanContentToMdxFolder({
      content,
      title: content.title ?? "Columns",
    });
    expect(folder["plan.mdx"]).toContain("<Columns");
    expect(folder["plan.mdx"]).toContain("<Column");
    expect(folder["plan.mdx"]).toContain('contentId="col-before-text"');
    expect(folder["plan.mdx"]).toContain("Old behavior");

    const result = await parsePlanMdxFolder(folder);
    const block = findBlock(result, "columns-1");
    if (block?.type !== "columns") throw new Error("expected columns");
    expect(block.data.columns[0]?.label).toBe("Before");
    const before = block.data.columns[0]?.blocks[0];
    expect(before?.id).toBe("col-before-text");
    expect(before?.type).toBe("rich-text");
    if (before?.type === "rich-text") {
      expect(before.data.markdown).toContain("Old behavior");
    }
    const after = block.data.columns[1]?.blocks[0];
    expect(after?.type).toBe("data-model");
    if (after?.type === "data-model") {
      expect(after.data.entities[0]?.fields.map((field) => field.name)).toEqual(
        ["id", "visibility"],
      );
    }
  });

  it("columns: still parses the generated JSON-attribute MDX form", async () => {
    const result = await parsePlanMdxFolder({
      "plan.mdx": [
        "---",
        'title: "Generated columns"',
        "version: 2",
        "---",
        "",
        '<Columns id="cols-generated" columns={[{"id":"before","label":"Before","blocks":[{"id":"before-text","type":"rich-text","data":{"markdown":"Old generated form"}}]},{"id":"after","label":"After","blocks":[{"id":"after-text","type":"rich-text","data":{"markdown":"New generated form"}}]}]} />',
      ].join("\n"),
    });
    const block = findBlock(result, "cols-generated");
    if (block?.type !== "columns") throw new Error("expected columns");
    expect(block.data.columns[0]?.blocks[0]?.type).toBe("rich-text");
    const after = block.data.columns[1]?.blocks[0];
    if (after?.type !== "rich-text") throw new Error("expected rich-text");
    expect(after.data.markdown).toBe("New generated form");
  });

  it("visual-questions: round-trips questions, options, embedded wireframe/diagram", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Visual questions",
      blocks: [
        {
          id: "vq-1",
          type: "visual-questions",
          data: {
            submitLabel: "Send",
            questions: [
              {
                id: "q1",
                title: "Pick a layout",
                subtitle: "Choose one",
                mode: "single",
                options: [
                  {
                    id: "opt-a",
                    label: "Grid",
                    detail: "A grid layout",
                    recommended: true,
                    wireframe: {
                      surface: "desktop",
                      html: "<div>grid preview</div>",
                    },
                  },
                  {
                    id: "opt-b",
                    label: "Flow",
                    diagram: {
                      nodes: [{ id: "a", label: "A" }],
                      edges: [],
                    },
                  },
                ],
              },
              {
                id: "q2",
                title: "Free response",
                mode: "freeform",
              },
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "vq-1");
    if (block?.type !== "visual-questions") {
      throw new Error("expected visual-questions");
    }
    expect(block.data.submitLabel).toBe("Send");
    expect(block.data.questions[0]?.title).toBe("Pick a layout");
    expect(block.data.questions[0]?.options?.[0]?.recommended).toBe(true);
    // The embedded wireframe option preview must survive the round-trip.
    expect(block.data.questions[0]?.options?.[0]?.wireframe?.html).toBe(
      "<div>grid preview</div>",
    );
    expect(block.data.questions[0]?.options?.[1]?.diagram?.nodes?.[0]?.id).toBe(
      "a",
    );
    expect(block.data.questions[1]?.mode).toBe("freeform");
  });

  it("question-form: round-trips reusable questions and optional answer fields", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Question form",
      blocks: [
        {
          id: "question-form-1",
          type: "question-form",
          title: "Open Questions",
          data: {
            submitLabel: "Send answers",
            questions: [
              {
                id: "q1",
                title: "Which integration path should we optimize?",
                subtitle: "Pick all that apply.",
                mode: "multi",
                allowOther: true,
                placeholder: "Describe another path...",
                required: true,
                options: [
                  {
                    id: "opt-api",
                    label: "API-first",
                    detail: "Document endpoints before UI work.",
                    recommended: true,
                    wireframe: {
                      surface: "desktop",
                      html: "<main><h1>Desktop</h1></main>",
                    },
                  },
                  {
                    id: "opt-flow",
                    label: "Flow diagram",
                    diagram: {
                      nodes: [{ id: "start", label: "Start" }],
                      edges: [],
                    },
                  },
                ],
              },
              {
                id: "q2",
                title: "What constraints should the agent preserve?",
                mode: "freeform",
                placeholder: "Add constraints...",
              },
            ],
          },
        },
      ],
    };

    const result = await roundTrip(content);
    const block = findBlock(result, "question-form-1");
    if (block?.type !== "question-form") {
      throw new Error("expected question-form");
    }
    expect(block.title).toBe("Open Questions");
    expect(block.data.submitLabel).toBe("Send answers");
    expect(block.data.questions[0]?.allowOther).toBe(true);
    expect(block.data.questions[0]?.required).toBe(true);
    expect(block.data.questions[0]?.placeholder).toBe(
      "Describe another path...",
    );
    expect(block.data.questions[0]?.options?.[0]?.recommended).toBe(true);
    expect(block.data.questions[0]?.options?.[0]?.wireframe?.html).toBe(
      "<main><h1>Desktop</h1></main>",
    );
    expect(block.data.questions[0]?.options?.[1]?.diagram?.nodes[0]?.id).toBe(
      "start",
    );
    expect(block.data.questions[1]?.mode).toBe("freeform");
  });

  it("legacy-wireframe: round-trips region data", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Legacy wireframe",
      blocks: [
        {
          id: "legacy-1",
          type: "legacy-wireframe",
          data: {
            viewport: "phone",
            caption: "Legacy screen",
            regions: [
              {
                id: "r1",
                kind: "header",
                label: "Top",
                x: 0,
                y: 0,
                width: 100,
                height: 10,
              },
              { id: "r2", kind: "list", x: 0, y: 12, width: 100, height: 80 },
            ],
          },
        },
      ],
    };
    const result = await roundTrip(content);
    const block = findBlock(result, "legacy-1");
    if (block?.type !== "legacy-wireframe") {
      throw new Error("expected legacy-wireframe");
    }
    expect(block.data.viewport).toBe("phone");
    expect(block.data.caption).toBe("Legacy screen");
    expect(block.data.regions).toHaveLength(2);
    expect(block.data.regions[0]?.kind).toBe("header");
  });
});

describe("canvas (Artboard/Section/Annotation/Connector) round-trip", () => {
  it("round-trips an HTML-mockup artboard without losing the html", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Canvas html",
      canvas: {
        title: "Board",
        frames: [
          {
            id: "ab-html",
            label: "HTML artboard",
            surface: "desktop",
            x: 0,
            y: 0,
            wireframe: {
              surface: "desktop",
              html: "<main><h1>Artboard HTML</h1></main>",
              css: "main { color: red; }",
            },
          },
        ],
      },
      blocks: [
        {
          id: "rt",
          type: "rich-text",
          data: { markdown: "body" },
        },
      ],
    };
    const result = await roundTrip(content);
    const frame = result.canvas?.frames.find((f) => f.id === "ab-html");
    expect(frame?.wireframe?.html).toBe("<main><h1>Artboard HTML</h1></main>");
    expect(frame?.wireframe?.css).toBe("main { color: red; }");
  });

  it("round-trips sections, connectors, annotation type/points/style/placement", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Canvas",
      canvas: {
        title: "Board",
        viewport: { zoom: 0.5, pan: { x: 10, y: 20 } },
        sections: [
          {
            id: "sec-1",
            title: "Flow",
            subtitle: "main flow",
            artboardIds: ["ab-1", "ab-2"],
          },
        ],
        frames: [
          {
            id: "ab-1",
            label: "One",
            surface: "desktop",
            x: 0,
            y: 0,
            wireframe: {
              surface: "desktop",
              screen: [{ id: "s1", el: "screen", children: [] }],
            },
          },
          {
            id: "ab-2",
            label: "Two",
            surface: "mobile",
            x: 400,
            y: 0,
            wireframe: {
              surface: "mobile",
              screen: [{ id: "s2", el: "screen", children: [] }],
            },
          },
        ],
        flow: [{ from: "ab-1", to: "ab-2", label: "Next" }],
        annotations: [
          {
            id: "anno-1",
            type: "arrow",
            title: "Look here",
            text: "Pointing at one",
            targetId: "ab-1",
            placement: "top-right",
            x: 5,
            y: 5,
            points: [
              { x: 1, y: 2 },
              { x: 3, y: 4 },
            ],
            style: { tone: "warn", stroke: "dashed", width: 3 },
          },
        ],
      },
      blocks: [{ id: "rt", type: "rich-text", data: { markdown: "x" } }],
    };
    const result = await roundTrip(content);
    expect(result.canvas?.sections?.[0]?.title).toBe("Flow");
    expect(result.canvas?.sections?.[0]?.subtitle).toBe("main flow");
    expect(result.canvas?.sections?.[0]?.artboardIds).toEqual(["ab-1", "ab-2"]);
    expect(result.canvas?.flow).toEqual([
      { from: "ab-1", to: "ab-2", label: "Next" },
    ]);
    const anno = result.canvas?.annotations?.find((a) => a.id === "anno-1");
    expect(anno?.type).toBe("arrow");
    expect(anno?.title).toBe("Look here");
    expect(anno?.targetId).toBe("ab-1");
    expect(anno?.placement).toBe("top-right");
    expect(anno?.points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(anno?.style).toEqual({ tone: "warn", stroke: "dashed", width: 3 });
    expect(result.canvas?.frames.find((f) => f.id === "ab-2")?.surface).toBe(
      "mobile",
    );
  });

  it("round-trips artboard geometry (x/y/width/height/order)", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Geometry",
      canvas: {
        title: "Board",
        frames: [
          {
            id: "ab-geo",
            label: "Geo",
            surface: "desktop",
            x: 123,
            y: 456,
            width: 789,
            height: 321,
            order: 2,
            wireframe: {
              surface: "desktop",
              screen: [{ id: "g", el: "screen", children: [] }],
            },
          },
        ],
      },
      blocks: [{ id: "rt", type: "rich-text", data: { markdown: "x" } }],
    };
    const result = await roundTrip(content);
    const frame = result.canvas?.frames.find((f) => f.id === "ab-geo");
    expect(frame?.x).toBe(123);
    expect(frame?.y).toBe(456);
    expect(frame?.width).toBe(789);
    expect(frame?.height).toBe(321);
    expect(frame?.order).toBe(2);
  });
});

describe("byte stability and malformed import handling", () => {
  it("repeated export is byte-stable (export -> parse -> export === first)", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Stability",
      canvas: {
        title: "Board",
        frames: [
          {
            id: "ab-1",
            label: "One",
            surface: "desktop",
            x: 0,
            y: 0,
            wireframe: {
              surface: "desktop",
              caption: "cap",
              screen: [
                {
                  id: "s1",
                  el: "screen",
                  children: [{ id: "t1", el: "title", text: "Hi" }],
                },
              ],
            },
          },
        ],
        annotations: [
          { id: "anno-1", type: "note", text: "note", targetId: "ab-1" },
        ],
      },
      blocks: [
        {
          id: "rt",
          type: "rich-text",
          title: "Summary",
          data: { markdown: "## Heading\n\nBody text." },
        },
        {
          id: "callout-1",
          type: "callout",
          data: { tone: "info", body: "An info callout." },
        },
      ],
    };
    const first = await exportPlanContentToMdxFolder({
      content: planContentSchema.parse(content),
      title: "Stability",
    });
    const reparsed = await parsePlanMdxFolder(first);
    const second = await exportPlanContentToMdxFolder({
      content: reparsed,
      title: "Stability",
    });
    expect(second["plan.mdx"]).toBe(first["plan.mdx"]);
    expect(second["canvas.mdx"]).toBe(first["canvas.mdx"]);
  });

  it("rejects a folder missing plan.mdx", async () => {
    await expect(
      parsePlanMdxFolder({ "plan.mdx": "" } as never),
    ).rejects.toThrow();
  });

  it("does not crash on malformed canvas.mdx (no DesignBoard)", async () => {
    const parsed = await parsePlanMdxFolder({
      "plan.mdx": `---\ntitle: "x"\nversion: 2\n---\n\n<RichText id="r">hi</RichText>\n`,
      "canvas.mdx": `Just some loose text, no board here.`,
    });
    // No DesignBoard => canvas should be absent, not a crash.
    expect(parsed.canvas).toBeUndefined();
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it("throws a clear error on invalid .plan-state.json", async () => {
    await expect(
      parsePlanMdxFolder({
        "plan.mdx": `---\ntitle: "x"\nversion: 2\n---\n\n<RichText id="r">hi</RichText>\n`,
        ".plan-state.json": `{ not valid json `,
      }),
    ).rejects.toThrow(/plan-state\.json is not valid/);
  });

  it("captures loose intro prose alongside a block-level RichText", async () => {
    const parsed = await parsePlanMdxFolder({
      "plan.mdx": `---\ntitle: "x"\nversion: 2\n---\n\nSome intro prose.\n\n<RichText id="known">\n\nReal block\n\n</RichText>\n`,
    });
    expect(parsed.blocks.some((b) => b.id === "known")).toBe(true);
    // The loose intro prose should be captured as a rich-text block.
    const proseBlock = parsed.blocks.find(
      (b) => b.type === "rich-text" && b.id !== "known",
    );
    expect(proseBlock).toBeDefined();
  });

  it("exports plain top-level rich text as bare markdown with a stable state id", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Bare prose",
      blocks: [
        {
          id: "intro",
          type: "rich-text",
          data: { markdown: "## Intro\n\nPlain MDX prose." },
        },
      ],
    };

    const folder = await exportPlanContentToMdxFolder({
      content,
      title: "Bare prose",
    });
    expect(folder["plan.mdx"]).not.toContain("<RichText");
    expect(folder["plan.mdx"]).toContain("## Intro");
    expect(JSON.parse(folder[".plan-state.json"] ?? "{}")).toMatchObject({
      markdownBlockIds: ["intro"],
    });

    const parsed = await parsePlanMdxFolder(folder);
    const block = parsed.blocks.find((candidate) => candidate.id === "intro");
    expect(block?.type).toBe("rich-text");
    if (block?.type === "rich-text") {
      expect(block.data.markdown).toContain("Plain MDX prose.");
    }

    const second = await exportPlanContentToMdxFolder({
      content: parsed,
      title: "Bare prose",
    });
    expect(second["plan.mdx"]).toBe(folder["plan.mdx"]);
    expect(second[".plan-state.json"]).toBe(folder[".plan-state.json"]);
  });

  it("recovers unchanged bare markdown ids by hash when hand edits add a new run", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: {
        version: 2,
        title: "Hand edited prose",
        blocks: [
          {
            id: "lead-checklist",
            type: "checklist",
            data: {
              items: [
                {
                  id: "lead-item",
                  label: "Lead with structure",
                  checked: false,
                },
              ],
            },
          },
          {
            id: "intro",
            type: "rich-text",
            data: { markdown: "Intro prose." },
          },
          {
            id: "middle-checklist",
            type: "checklist",
            data: {
              items: [
                {
                  id: "middle-item",
                  label: "Separate runs",
                  checked: false,
                },
              ],
            },
          },
          {
            id: "tail",
            type: "rich-text",
            data: { markdown: "Tail prose." },
          },
        ],
      },
      title: "Hand edited prose",
    });

    const editedFolder = {
      ...folder,
      "plan.mdx": folder["plan.mdx"].replace(
        /---\n\n/,
        "---\n\nNew leading prose.\n\n",
      ),
    };

    const parsed = await parsePlanMdxFolder(editedFolder);
    const richTextBlocks = parsed.blocks.filter(
      (
        block,
      ): block is Extract<
        PlanContent["blocks"][number],
        { type: "rich-text" }
      > => block.type === "rich-text",
    );
    expect(
      richTextBlocks.find((block) => block.id === "intro")?.data.markdown,
    ).toBe("Intro prose.");
    expect(
      richTextBlocks.find((block) => block.id === "tail")?.data.markdown,
    ).toBe("Tail prose.");
    const inserted = richTextBlocks.find(
      (block) => block.data.markdown === "New leading prose.",
    );
    expect(inserted?.id).toBeTruthy();
    expect(inserted?.id).not.toBe("intro");
    expect(inserted?.id).not.toBe("tail");
  });

  it("recovers reordered bare markdown ids by hash when the run count stays the same", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: {
        version: 2,
        title: "Reordered prose",
        blocks: [
          {
            id: "lead-checklist",
            type: "checklist",
            data: {
              items: [
                {
                  id: "lead-item",
                  label: "Lead with structure",
                  checked: false,
                },
              ],
            },
          },
          {
            id: "intro",
            type: "rich-text",
            data: { markdown: "Intro prose." },
          },
          {
            id: "middle-checklist",
            type: "checklist",
            data: {
              items: [
                {
                  id: "middle-item",
                  label: "Separate runs",
                  checked: false,
                },
              ],
            },
          },
          {
            id: "tail",
            type: "rich-text",
            data: { markdown: "Tail prose." },
          },
        ],
      },
      title: "Reordered prose",
    });

    const editedFolder = {
      ...folder,
      "plan.mdx": folder["plan.mdx"]
        .replace("Intro prose.", "TEMP_REORDERED_PROSE")
        .replace("Tail prose.", "Intro prose.")
        .replace("TEMP_REORDERED_PROSE", "Tail prose."),
    };

    const parsed = await parsePlanMdxFolder(editedFolder);
    const richTextBlocks = parsed.blocks.filter(
      (
        block,
      ): block is Extract<
        PlanContent["blocks"][number],
        { type: "rich-text" }
      > => block.type === "rich-text",
    );

    expect(
      richTextBlocks.find((block) => block.id === "intro")?.data.markdown,
    ).toBe("Intro prose.");
    expect(
      richTextBlocks.find((block) => block.id === "tail")?.data.markdown,
    ).toBe("Tail prose.");
  });

  it("keeps rich-text wrappers when prose carries metadata or external references", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Wrapped prose",
      blocks: [
        {
          id: "with-title",
          type: "rich-text",
          title: "Notes",
          summary: "Review notes",
          editable: true,
          data: { markdown: "Titled prose." },
        },
        {
          id: "commented",
          type: "rich-text",
          data: { markdown: "Commented prose." },
        },
      ],
    };

    const folder = await exportPlanContentToMdxFolder({
      content,
      title: "Wrapped prose",
      referencedBlockIds: new Set(["commented"]),
    });

    expect(folder["plan.mdx"]).toContain('<RichText id="with-title"');
    expect(folder["plan.mdx"]).toContain('title="Notes"');
    expect(folder["plan.mdx"]).toContain('summary="Review notes"');
    expect(folder["plan.mdx"]).toContain('<RichText id="commented"');
    expect(JSON.parse(folder[".plan-state.json"] ?? "{}")).not.toHaveProperty(
      "markdownBlockIds",
    );

    const parsed = await parsePlanMdxFolder(folder);
    expect(
      parsed.blocks.find((block) => block.id === "with-title"),
    ).toMatchObject({
      id: "with-title",
      type: "rich-text",
      title: "Notes",
      summary: "Review notes",
      editable: true,
    });
  });

  it("rejects malformed plan content that cannot normalize (duplicate block ids)", async () => {
    await expect(
      parsePlanMdxFolder({
        "plan.mdx": `---\ntitle: "x"\nversion: 2\n---\n\n<RichText id="dup">\n\nA\n\n</RichText>\n\n<RichText id="dup">\n\nB\n\n</RichText>\n`,
      }),
    ).rejects.toThrow(/Duplicate block id/);
  });

  // EDGE (low severity, documented): a single-line inline <RichText ...>...</RichText>
  // not separated by blank lines parses as an MDX *text* element and is silently
  // merged into the surrounding prose, losing its stable block id. Hand-authored
  // or LLM-emitted MDX that puts a block on one line without blank-line padding
  // silently loses the block boundary. This pins current behavior.
  it("EDGE: inline single-line RichText is swallowed into prose (block id lost)", async () => {
    const parsed = await parsePlanMdxFolder({
      "plan.mdx": `---\ntitle: "x"\nversion: 2\n---\n\nSome intro prose.\n\n<RichText id="known">Real block</RichText>\n`,
    });
    // Documenting the lossy behavior: the explicit id "known" does NOT survive.
    expect(parsed.blocks.some((b) => b.id === "known")).toBe(false);
  });
});

describe("patch-by-stable-id targeting", () => {
  async function htmlWireframeFolder() {
    return exportPlanContentToMdxFolder({
      content: planContentSchema.parse({
        version: 2,
        title: "Patch target",
        blocks: [
          {
            id: "rt-summary",
            type: "rich-text",
            title: "Summary",
            data: { markdown: "Old summary" },
          },
        ],
      }),
      title: "Patch target",
    });
  }

  it("replace-markdown-block updates the targeted block by id", async () => {
    const folder = await htmlWireframeFolder();
    const patched = await applyPlanMdxSourcePatches(folder, [
      {
        op: "replace-markdown-block",
        blockId: "rt-summary",
        markdown: "New summary text",
      },
    ]);
    const parsed = await parsePlanMdxFolder(patched);
    const block = parsed.blocks.find((b) => b.id === "rt-summary");
    if (block?.type !== "rich-text") throw new Error("expected rich-text");
    expect(block.data.markdown).toContain("New summary text");
  });

  it("replace-markdown-block updates bare markdown runs by state-mapped id", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: {
        version: 2,
        title: "Bare patch",
        blocks: [
          {
            id: "intro",
            type: "rich-text",
            data: { markdown: "Old intro." },
          },
          {
            id: "todo",
            type: "checklist",
            data: {
              items: [
                {
                  id: "keep-structured-block",
                  label: "Keep structured block",
                  checked: false,
                },
              ],
            },
          },
          {
            id: "tail",
            type: "rich-text",
            data: { markdown: "Tail prose." },
          },
        ],
      },
      title: "Bare patch",
    });
    expect(folder["plan.mdx"]).not.toContain("<RichText");

    const patched = await applyPlanMdxSourcePatches(folder, [
      {
        op: "replace-markdown-block",
        blockId: "intro",
        markdown: "New intro.",
      },
    ]);

    expect(patched["plan.mdx"]).toContain("New intro.");
    expect(patched["plan.mdx"]).not.toContain("<RichText");
    expect(JSON.parse(patched[".plan-state.json"] ?? "{}")).toMatchObject({
      markdownBlockIds: ["intro", "tail"],
    });
    const parsed = await parsePlanMdxFolder(patched);
    const intro = parsed.blocks.find((block) => block.id === "intro");
    const tail = parsed.blocks.find((block) => block.id === "tail");
    expect(intro?.type).toBe("rich-text");
    expect(tail?.type).toBe("rich-text");
    if (intro?.type === "rich-text") {
      expect(intro.data.markdown).toBe("New intro.");
    }
    if (tail?.type === "rich-text") {
      expect(tail.data.markdown).toBe("Tail prose.");
    }
  });

  it("replace-markdown-block wraps bare prose when metadata is added without shifting later ids", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: {
        version: 2,
        title: "Bare patch title",
        blocks: [
          {
            id: "intro",
            type: "rich-text",
            data: { markdown: "Old intro." },
          },
          {
            id: "todo",
            type: "checklist",
            data: {
              items: [
                {
                  id: "keep-structured-block",
                  label: "Keep structured block",
                  checked: false,
                },
              ],
            },
          },
          {
            id: "tail",
            type: "rich-text",
            data: { markdown: "Tail prose." },
          },
        ],
      },
      title: "Bare patch title",
    });

    const patched = await applyPlanMdxSourcePatches(folder, [
      {
        op: "replace-markdown-block",
        blockId: "intro",
        markdown: "New titled intro.",
        title: "Intro",
      },
    ]);

    expect(patched["plan.mdx"]).toContain('<RichText id="intro"');
    expect(patched["plan.mdx"]).toContain('title="Intro"');
    expect(JSON.parse(patched[".plan-state.json"] ?? "{}")).toMatchObject({
      markdownBlockIds: ["tail"],
    });

    const parsed = await parsePlanMdxFolder(patched);
    const intro = parsed.blocks.find((block) => block.id === "intro");
    const tail = parsed.blocks.find((block) => block.id === "tail");
    expect(intro).toMatchObject({ id: "intro", title: "Intro" });
    expect(tail?.id).toBe("tail");
  });

  it("replace-markdown-block clears sidecar ids when deleting the last bare prose run", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: {
        version: 2,
        title: "Delete bare prose",
        blocks: [
          {
            id: "intro",
            type: "rich-text",
            data: { markdown: "Old intro." },
          },
        ],
      },
      title: "Delete bare prose",
    });

    const patched = await applyPlanMdxSourcePatches(folder, [
      {
        op: "replace-markdown-block",
        blockId: "intro",
        markdown: "",
      },
    ]);

    expect(patched["plan.mdx"]).not.toContain("Old intro.");
    const state = JSON.parse(patched[".plan-state.json"] ?? "{}");
    expect(state.markdownBlockIds).toBeUndefined();
    expect(state.markdownBlocks).toBeUndefined();
    const parsed = await parsePlanMdxFolder(patched);
    expect(parsed.blocks.find((block) => block.id === "intro")).toBeUndefined();
  });

  it("replace-markdown-block throws for a missing block id", async () => {
    const folder = await htmlWireframeFolder();
    await expect(
      applyPlanMdxSourcePatches(folder, [
        {
          op: "replace-markdown-block",
          blockId: "does-not-exist",
          markdown: "x",
        },
      ]),
    ).rejects.toThrow(/not found/);
  });

  it("update-component-prop throws for a missing component id", async () => {
    const folder = await htmlWireframeFolder();
    await expect(
      applyPlanMdxSourcePatches(folder, [
        {
          op: "update-component-prop",
          file: "plan.mdx",
          componentId: "nope",
          prop: "title",
          value: "x",
        },
      ]),
    ).rejects.toThrow(/not found/);
  });

  it("update-wireframe-node throws for a missing node id", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: planContentSchema.parse({
        version: 2,
        title: "Has wireframe",
        blocks: [
          {
            id: "wf",
            type: "wireframe",
            data: {
              surface: "desktop",
              screen: [
                {
                  id: "scr",
                  el: "screen",
                  children: [{ id: "real-node", el: "btn", label: "Hi" }],
                },
              ],
            },
          },
        ],
      }),
      title: "Has wireframe",
    });
    await expect(
      applyPlanMdxSourcePatches(folder, [
        {
          op: "update-wireframe-node",
          nodeId: "missing-node",
          patch: { text: "x" },
        },
      ]),
    ).rejects.toThrow(/not found/);
  });
});
