import { describe, expect, it } from "vitest";

import getPlanBlocks from "../actions/get-plan-blocks.js";
import { planBlockSchema, type PlanContent } from "../shared/plan-content.js";
import {
  EXAMPLE_BLOCKS,
  PRIORITY_EXAMPLE_BLOCK_TYPES,
  renderPlanBlockAuthoringExamples,
  serializeExampleBlockToMdx,
  type PriorityExampleBlockType,
} from "./plan-block-examples.js";
import { parsePlanMdxFolder } from "./plan-mdx.js";


const UNKNOWN_MARKER = "__unknown_block__:";

function isUnknownPlaceholder(block: PlanContent["blocks"][number]): boolean {
  return (
    block.type === "callout" &&
    typeof block.data.body === "string" &&
    block.data.body.includes(UNKNOWN_MARKER)
  );
}

describe("plan block authoring examples", () => {
  it("defines an example for every priority block type", () => {
    const defined = Object.keys(EXAMPLE_BLOCKS).sort();
    const priority = [...PRIORITY_EXAMPLE_BLOCK_TYPES].sort();
    expect(defined).toEqual(priority);
  });

  it("every canonical example block validates under planBlockSchema", () => {
    for (const type of PRIORITY_EXAMPLE_BLOCK_TYPES) {
      const block = EXAMPLE_BLOCKS[type];
      expect(block.type, `example for "${type}" has the wrong type`).toBe(type);
      const result = planBlockSchema.safeParse(block);
      if (!result.success) {
        throw new Error(
          `Canonical example for "${type}" does not validate under planBlockSchema. ` +
            `Issues: ${JSON.stringify(result.error.issues.slice(0, 4))}`,
        );
      }
      expect(result.success).toBe(true);
    }
  });

  for (const type of PRIORITY_EXAMPLE_BLOCK_TYPES) {
    it(`example MDX for \`${type}\` round-trips through strict parsePlanMdxFolder`, async () => {
      const exampleMdx = await serializeExampleBlockToMdx(EXAMPLE_BLOCKS[type]);
      expect(exampleMdx.length).toBeGreaterThan(0);

      const parsed = await parsePlanMdxFolder(
        { "plan.mdx": `---\ntitle: Example\n---\n\n${exampleMdx}\n` },
        // strict: salvageInvalidBlocks defaults to false
      );

      const blocks = parsed.blocks;
      const placeholders = blocks.filter(isUnknownPlaceholder);
      expect(
        placeholders,
        `example for "${type}" produced an unsupported-block placeholder: ${JSON.stringify(
          placeholders.map((b) =>
            b.type === "callout" ? b.data.body : b.type,
          ),
        )}`,
      ).toHaveLength(0);

      const match = blocks.find((b) => b.type === type);
      expect(
        match,
        `parsing the "${type}" example did not yield a block of type "${type}"; got: ${JSON.stringify(
          blocks.map((b) => b.type),
        )}`,
      ).toBeDefined();
    });
  }
});

describe("get-plan-blocks reference includes authoring examples", () => {
  it("renders an `## Authoring examples` section with one example per priority type", async () => {
    const section = await renderPlanBlockAuthoringExamples();
    expect(section).toContain("## Authoring examples");
    for (const type of PRIORITY_EXAMPLE_BLOCK_TYPES) {
      expect(
        section,
        `authoring examples missing a section for "${type}"`,
      ).toContain(`### \`${type}\``);
    }
    expect(section).toContain("```mdx");
  });

  it("the get-plan-blocks action reference embeds an example for every priority type", async () => {
    const result = (await (
      getPlanBlocks.run as (args: { format: "reference" }) => Promise<unknown>
    )({ format: "reference" })) as { reference: string };
    const reference = result.reference;
    expect(reference).toContain("## Authoring examples");
    for (const type of PRIORITY_EXAMPLE_BLOCK_TYPES satisfies readonly PriorityExampleBlockType[]) {
      expect(
        reference,
        `get-plan-blocks reference missing an example for "${type}"`,
      ).toContain(`### \`${type}\``);
    }
  });
});
