import { describe, expect, it } from "vitest";
import { parsePlanMdxFolder } from "./plan-mdx.js";

const frontmatter = `---
title: "Alias + fail-loud coverage"
version: 2
---
`;

function plan(body: string) {
  return parsePlanMdxFolder({ "plan.mdx": `${frontmatter}\n${body}\n` });
}

describe("plan-mdx forgiving aliases", () => {
  it("parses <JsonExplorer> as a Json block (alias)", async () => {
    const parsed = await plan(
      `<JsonExplorer id="state-shape" title="State" data={{ foo: 1, bar: [2, 3] }} />`,
    );
    const block = parsed.blocks.find((b) => b.id === "state-shape");
    expect(block?.type).toBe("json-explorer");
    expect((block?.data as { json?: string } | undefined)?.json).toBe(
      JSON.stringify({ foo: 1, bar: [2, 3] }),
    );
    expect(parsed.blocks.every((b) => b.type !== "rich-text")).toBe(true);
  });

  it("parses <Tabs> as a TabsBlock (alias)", async () => {
    const parsed = await plan(
      `<Tabs id="key-tabs" tabs={[{ id: "t1", label: "One", blocks: [] }]} />`,
    );
    const block = parsed.blocks.find((b) => b.id === "key-tabs");
    expect(block?.type).toBe("tabs");
  });

  it("parses <ApiEndpoint> as an Endpoint block (alias)", async () => {
    const parsed = await plan(
      `<ApiEndpoint id="ep-create" method="POST" path="/api/tasks" summary="Create" />`,
    );
    const block = parsed.blocks.find((b) => b.id === "ep-create");
    expect(block?.type).toBe("api-endpoint");
  });

  it("parses <DiffBlock> as a Diff block (alias)", async () => {
    const parsed = await plan(
      `<DiffBlock id="diff-1" filename="a.ts" before="const a = 1" after="const a = 2" />`,
    );
    const block = parsed.blocks.find((b) => b.id === "diff-1");
    expect(block?.type).toBe("diff");
  });

  it("parses <AnnotatedCodeBlock> and <Wireframe> aliases", async () => {
    const parsed = await plan(
      `<AnnotatedCodeBlock id="ac-1" code="const x = 1;" language="ts" />

<Wireframe id="wf-1">
  <Screen surface="browser" html={'<div>Hi</div>'} />
</Wireframe>`,
    );
    expect(parsed.blocks.find((b) => b.id === "ac-1")?.type).toBe(
      "annotated-code",
    );
    expect(parsed.blocks.find((b) => b.id === "wf-1")?.type).toBe("wireframe");
  });
});

describe("plan-mdx fail-loud on unknown blocks", () => {
  it("throws a helpful error for an unknown capitalized block tag", async () => {
    await expect(
      plan(`<TotallyFakeBlock id="x" title="Nope" />`),
    ).rejects.toThrow(/Unknown plan block <TotallyFakeBlock>/);
  });

  it("lists known blocks and suggests a near match", async () => {
    let message = "";
    try {
      await plan(`<Jsonn id="x" data={{ a: 1 }} />`);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Did you mean <Json>/);
    expect(message).toMatch(/Known blocks:/);
    expect(message).toContain("Endpoint");
    expect(message).toContain("TabsBlock");
  });

  it("suggests TabsBlock for a stray <Tab> (no real nested tab child exists)", async () => {
    await expect(plan(`<Tab id="x" label="One" />`)).rejects.toThrow(
      /Did you mean <TabsBlock>/,
    );
  });
});

describe("plan-mdx lowercase HTML inside prose still parses", () => {
  it("keeps inline HTML in a RichText block without false positives", async () => {
    const parsed = await plan(
      `Here is some prose with <span style="color:red">inline html</span> and a <br /> break and <code>inlineCode()</code>.

Another paragraph with a <div>block-ish div</div> element.`,
    );
    expect(parsed.blocks.length).toBeGreaterThan(0);
    expect(parsed.blocks[0]?.type).toBe("rich-text");
    if (parsed.blocks[0]?.type !== "rich-text")
      throw new Error("Expected rich-text");
    const markdown = parsed.blocks[0].data.markdown;
    expect(markdown).toContain("inline html");
    expect(markdown).toContain("<code>");
  });

  it("allows lowercase inline HTML inside a RichText element body", async () => {
    const parsed = await plan(
      `<RichText id="rt-1" title="Notes">

Body with <strong>bold</strong> and <em>em</em> and <a href="/x">a link</a>.

</RichText>`,
    );
    const block = parsed.blocks.find((b) => b.id === "rt-1");
    expect(block?.type).toBe("rich-text");
  });
});
