import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({}));
vi.mock("node:util", () => ({}));

describe("plan-mdx without node builtins", () => {
  it("parses a plan folder the way the browser local-plan bridge does", async () => {
    const { parsePlanMdxFolder } = await import("./plan-mdx");
    const files = {
      "plan.mdx": "---\ntitle: Local\n---\n\n# Hello\n\nBody text.\n",
    };
    const parsed = await parsePlanMdxFolder(files as never);
    expect(parsed).toBeTruthy();
  });
});
