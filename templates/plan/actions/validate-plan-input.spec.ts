import { describe, expect, it } from "vitest";
import { z } from "zod";

import { rejectMixedPlanSources } from "./validate-plan-input.js";

const schema = z
  .object({
    content: z.unknown().optional(),
    screens: z.array(z.string()).default([]),
    transitions: z.array(z.string()).default([]),
  })
  .superRefine(rejectMixedPlanSources);

describe("visual plan input sources", () => {
  it("rejects convenience screens beside a complete content payload", () => {
    expect(() =>
      schema.parse({
        content: { version: 2, blocks: [] },
        screens: ["intro"],
      }),
    ).toThrow(/complete visual-plan replacement.*screens/i);
  });

  it("allows either complete content or convenience arrays", () => {
    expect(() =>
      schema.parse({ content: { version: 2, blocks: [] } }),
    ).not.toThrow();
    expect(() =>
      schema.parse({ screens: ["intro"], transitions: ["next"] }),
    ).not.toThrow();
  });
});
