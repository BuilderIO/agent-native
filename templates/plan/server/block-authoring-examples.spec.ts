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

/* -------------------------------------------------------------------------- */
/* Authoring-examples corpus.                                                 */
/*                                                                            */
/* The PR Visual Recap agent kept emitting blocks with missing required       */
/* fields because the `get-plan-blocks` reference taught shapes via JSON       */
/* schemas only. We now render a concrete, COMPLETE, VALID example per key    */
/* block type into that reference. This corpus proves every example is the    */
/* exact valid authoring form: each canonical block validates, serializes to  */
/* MDX, and round-trips through the STRICT (no-salvage) source parser with no */
/* `__unknown_block__` placeholder and the expected block `type`. It also     */
/* guards against drift — the rendered reference must contain an example for  */
/* every priority block type.                                                 */
/* -------------------------------------------------------------------------- */

/** The salvage placeholder marker (see parsePlanContentWithSalvage). */
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

  // The core guarantee: the EXACT MDX shown in the reference round-trips through
  // the strict (no-salvage) source parser, yields a block of the expected type,
  // and produces NO unsupported-block placeholder. If a block's natural
  // authoring form does not round-trip cleanly, that's a real bug — it fails
  // loudly here rather than the block being silently omitted.
  for (const type of PRIORITY_EXAMPLE_BLOCK_TYPES) {
    it(`example MDX for \`${type}\` round-trips through strict parsePlanMdxFolder`, async () => {
      const exampleMdx = await serializeExampleBlockToMdx(EXAMPLE_BLOCKS[type]);
      expect(exampleMdx.length).toBeGreaterThan(0);

      // Strict parse (no salvage). A failure means the taught form is invalid.
      const parsed = await parsePlanMdxFolder(
        { "plan.mdx": `---\ntitle: Example\n---\n\n${exampleMdx}\n` },
        // strict: salvageInvalidBlocks defaults to false
      );

      // Exactly the one example block parsed back, of the expected type, with
      // no unsupported-block placeholder substituted.
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
      // Each example is labeled with a `### \`<type>\`` heading.
      expect(
        section,
        `authoring examples missing a section for "${type}"`,
      ).toContain(`### \`${type}\``);
    }
    // The generated examples are fenced as ```mdx code blocks.
    expect(section).toContain("```mdx");
  });

  it("the get-plan-blocks action reference embeds an example for every priority type", async () => {
    // The action's run only reads args; context is unused for this read-only
    // catalog action, matching how other plan action specs invoke `.run({...})`.
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
