import { describe, expect, it, vi } from "vitest";

import { parsePlanMdxFolder } from "./plan-mdx.js";

// Plan's local bridge (app/lib/plan-local-bridge.ts) parses MDX in the
// browser, where Vite stands in an empty module for Node built-ins.
vi.mock("node:crypto", () => ({}));

const IDLESS_CALLOUT = `<Callout tone="info">

Hello

</Callout>
`;

describe("parsePlanMdxFolder without Node built-ins", () => {
  it("gives an idless block the same stable id the server gives it", async () => {
    const content = await parsePlanMdxFolder(
      { "plan.mdx": IDLESS_CALLOUT },
      { allowStoredLegacyDefaults: true, salvageInvalidBlocks: true },
    );

    expect(content.blocks).toHaveLength(1);
    expect(content.blocks[0]).toMatchObject({
      type: "callout",
      id: "source-837a42b248d55f6604e25b77",
    });
  });
});
