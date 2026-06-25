import {
  BlockRegistry,
  serializeSpecBlock,
  introspect,
  calloutSchema,
} from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import {
  registerPlanBlocks,
  describePlanBlocksForAgent,
  renderPlanBlockVocabulary,
} from "../shared/plan-block-registry.js";
import {
  applyPlanContentPatches,
  planContentSchema,
  type PlanContent,
} from "../shared/plan-content.js";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";

function calloutContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Registry callout",
    brief: "Proving the block registry round-trips the callout.",
    blocks: [
      {
        id: "callout-1",
        type: "callout",
        data: {
          tone: "risk",
          body: "Watch out for **edge cases** in checkout.",
        },
      },
    ],
  });
}

describe("plan block registry — callout", () => {
  it("serializes a callout through the registry in the legacy MDX form", () => {
    const registry = new BlockRegistry();
    registerPlanBlocks(registry);
    const spec = registry.get("callout");
    expect(spec).toBeDefined();

    const mdx = serializeSpecBlock(spec!, {
      id: "callout-1",
      data: { tone: "risk", body: "Watch out for **edge cases**." },
    });

    // Exactly the legacy `<Callout id tone>…body…</Callout>` shape: id first,
    // then tone attribute, then the trimmed markdown body as MDX children.
    expect(mdx).toBe(
      [
        '<Callout id="callout-1" tone="risk">',
        "",
        "Watch out for **edge cases**.",
        "",
        "</Callout>",
      ].join("\n"),
    );
  });

  it("round-trips a callout through the registry MDX path (export → parse)", async () => {
    const source = calloutContent();
    const folder = await exportPlanContentToMdxFolder({
      content: source,
      title: source.title,
      brief: source.brief,
    });

    // The exported plan.mdx contains a real `<Callout>` element with the tone
    // attribute and the body as prose children.
    expect(folder["plan.mdx"]).toContain("<Callout");
    expect(folder["plan.mdx"]).toContain('tone="risk"');
    expect(folder["plan.mdx"]).toContain("edge cases");

    const parsed = await parsePlanMdxFolder(folder);
    const callout = parsed.blocks.find((block) => block.type === "callout");
    expect(callout).toBeDefined();
    if (callout && callout.type === "callout") {
      expect(callout.id).toBe("callout-1");
      expect(callout.data.tone).toBe("risk");
      expect(callout.data.body).toContain("edge cases");
    }
  });

  it("exposes the callout body as a markdown() field so the auto-editor uses the rich editor", () => {
    const fields = introspect(calloutSchema);
    const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));
    // tone → select; body → the shared rich-markdown editor (inline editing).
    expect(byKey.tone?.kind).toBe("enum");
    expect(byKey.tone?.enumValues).toEqual([
      "info",
      "decision",
      "risk",
      "warning",
      "success",
    ]);
    expect(byKey.body?.kind).toBe("markdown");
  });

  it("edits a callout through the schema-editor persistence path (update-block)", () => {
    const content = calloutContent();

    // The auto-editor commits `{ ...block, data: nextData }`; PlanContentRenderer
    // routes that to an `update-block` patch (shallow data merge). Simulate both
    // the tone select and the markdown body edit.
    const patched = applyPlanContentPatches(content, [
      {
        op: "update-block",
        blockId: "callout-1",
        patch: {
          data: {
            tone: "success",
            body: "Now the **happy path** is covered.",
          },
        },
      },
    ]);

    const callout = patched.blocks.find((block) => block.type === "callout");
    expect(callout).toBeDefined();
    if (callout && callout.type === "callout") {
      expect(callout.data.tone).toBe("success");
      expect(callout.data.body).toContain("happy path");
    }
  });
});

describe("plan block agent vocabulary export", () => {
  it("describes every registered plan block with type, MDX tag, and schema", () => {
    const docs = describePlanBlocksForAgent();
    const byType = Object.fromEntries(docs.map((doc) => [doc.type, doc]));
    // Each converted block the `get-plan-blocks` action exposes to the agent.
    for (const type of [
      "callout",
      "checklist",
      "code-tabs",
      "custom-html",
      "diagram",
      "mermaid",
      "api-endpoint",
      "openapi-spec",
      "data-model",
      "diff",
      "file-tree",
      "json-explorer",
      "annotated-code",
      "question-form",
      "visual-questions",
      "table",
      "tabs",
      "columns",
      "wireframe",
    ]) {
      expect(byType[type], `missing block ${type}`).toBeDefined();
      expect(byType[type].mdxTag.length).toBeGreaterThan(0);
      expect(byType[type].description.length).toBeGreaterThan(0);
    }
    // tabs is the one block that can also be placed inline.
    expect(byType.tabs.placement).toContain("inline");
  });

  it("renders a markdown vocabulary reference covering every block", () => {
    const ref = renderPlanBlockVocabulary();
    expect(ref).toContain("| type | mdx tag | placement |");
    expect(ref).toContain("`callout`");
    expect(ref).toContain("`<Callout>`");
    expect(ref).toContain("`wireframe`");
    expect(ref).toContain("`<WireframeBlock>`");
    expect(ref).toContain("`question-form`");
    expect(ref).toContain("`<QuestionForm>`");
    // Every described block appears as a row.
    for (const doc of describePlanBlocksForAgent()) {
      expect(ref).toContain(`\`${doc.type}\``);
    }
  });
});
