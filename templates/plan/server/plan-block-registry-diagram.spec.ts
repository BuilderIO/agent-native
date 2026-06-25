import {
  BlockRegistry,
  serializeSpecBlock,
  introspect,
} from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import { registerPlanBlocks } from "../shared/plan-block-registry.js";
import { planContentSchema, type PlanContent } from "../shared/plan-content.js";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";

const diagramData = {
  nodes: [
    { id: "n1", label: "Webhook", detail: "Inbound POST", x: 10, y: 20 },
    { id: "n2", label: "Queue" },
    { id: "n3", label: "Worker" },
  ],
  edges: [
    { from: "n1", to: "n2", label: "enqueue" },
    { from: "n2", to: "n3" },
  ],
  notes: [{ id: "note1", text: "Retries 3x", x: 50, y: 5 }],
};

const htmlDiagramData = {
  html: '<div class="diagram-panel"><svg viewBox="0 0 100 40"><path d="M5 20 L95 20" /></svg></div>',
  css: ".diagram-panel { padding: 12px; }",
  caption: "The policy module owns the unstable branch.",
};

function diagramContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Registry diagram",
    brief: "Proving the block registry round-trips the plan diagram.",
    blocks: [
      {
        id: "diagram-1",
        type: "diagram",
        title: "Agent flow",
        summary: "End-to-end ingest path.",
        data: diagramData,
      },
    ],
  });
}

describe("plan block registry — diagram", () => {
  it("serializes a diagram through the registry in the legacy MDX form", () => {
    const registry = new BlockRegistry();
    registerPlanBlocks(registry);
    const spec = registry.get("diagram");
    expect(spec).toBeDefined();

    const viaSpec = serializeSpecBlock(spec!, {
      id: "diagram-1",
      title: "Agent flow",
      summary: "End-to-end ingest path.",
      data: diagramData,
    });

    // Exactly the legacy `<Diagram id title summary data={…} />` shape: base
    // attrs first, then the whole `data` object as one JSON prop, self-closing.
    expect(viaSpec).toBe(
      `<Diagram id="diagram-1" title="Agent flow" summary="End-to-end ingest path."` +
        ` data={${JSON.stringify(diagramData, null, 2)}} />`,
    );
  });

  it("round-trips a diagram through the registry MDX path (export → parse)", async () => {
    const source = diagramContent();
    const folder = await exportPlanContentToMdxFolder({
      content: source,
      title: source.title,
      brief: source.brief,
    });

    // The exported plan.mdx contains a real `<Diagram>` element with the whole
    // data object as the `data` prop. (Prettier reformats the embedded object
    // literal on export, so assert on stable substrings, not exact JSON.)
    expect(folder["plan.mdx"]).toContain("<Diagram");
    expect(folder["plan.mdx"]).toContain("data={");
    expect(folder["plan.mdx"]).toContain('"Webhook"');
    expect(folder["plan.mdx"]).toContain('"enqueue"');

    const parsed = await parsePlanMdxFolder(folder);
    const diagram = parsed.blocks.find((block) => block.type === "diagram");
    expect(diagram).toBeDefined();
    if (diagram && diagram.type === "diagram") {
      expect(diagram.id).toBe("diagram-1");
      expect(diagram.title).toBe("Agent flow");
      expect(diagram.summary).toBe("End-to-end ingest path.");
      // The whole node/edge/note graph survives the round-trip unchanged.
      expect(diagram.data).toEqual(diagramData);
    }
  });

  it("round-trips an html/svg diagram through the registry MDX path", async () => {
    const source = planContentSchema.parse({
      version: 2,
      title: "HTML diagram",
      brief: "Proving flexible diagram fragments survive.",
      blocks: [
        {
          id: "diagram-html",
          type: "diagram",
          title: "Route policy",
          data: htmlDiagramData,
        },
      ],
    });
    const folder = await exportPlanContentToMdxFolder({
      content: source,
      title: source.title,
      brief: source.brief,
    });

    expect(folder["plan.mdx"]).toContain("<Diagram");
    expect(folder["plan.mdx"]).toContain("diagram-panel");
    expect(folder["plan.mdx"]).toContain("<svg");

    const parsed = await parsePlanMdxFolder(folder);
    const diagram = parsed.blocks.find((block) => block.type === "diagram");
    expect(diagram).toBeDefined();
    if (diagram && diagram.type === "diagram") {
      expect(diagram.data).toEqual(htmlDiagramData);
    }
  });

  it("introspects diagram data as flexible html plus legacy arrays", () => {
    const registry = new BlockRegistry();
    registerPlanBlocks(registry);
    const spec = registry.get("diagram");
    const fields = introspect(spec!.schema);
    const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));
    expect(byKey.html?.kind).toBe("longtext");
    expect(byKey.css?.kind).toBe("longtext");
    expect(byKey.nodes?.kind).toBe("array");
    expect(byKey.edges?.kind).toBe("array");
  });
});
