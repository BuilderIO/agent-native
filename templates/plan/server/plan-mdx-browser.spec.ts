import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({}));
vi.mock("node:util", () => ({}));

describe("plan-mdx without node builtins", () => {
  it("parses a plan folder the way the browser local-plan bridge does", async () => {
    const { parsePlanMdxFolder } = await import("./plan-mdx");
    const parsed = await parsePlanMdxFolder({
      "plan.mdx":
        '---\ntitle: Local\n---\n\n<Callout tone="risk">\nWatch out\n</Callout>\n',
    });
    expect(parsed.blocks[0]?.id).toMatch(/^source-[0-9a-f]{24}$/);
  });
});
