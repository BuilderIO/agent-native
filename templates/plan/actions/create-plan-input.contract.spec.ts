import { describe, expect, it } from "vitest";
import type { z } from "zod";

import createPlanDesign from "./create-plan-design.js";
import createPrototypePlan from "./create-prototype-plan.js";
import createUiPlan from "./create-ui-plan.js";

const content = { version: 2, blocks: [] };

describe("visual plan create actions", () => {
  it.each([
    [createPlanDesign, { screens: [{ title: "Intro" }] }],
    [createPrototypePlan, { screens: [{ title: "Intro" }] }],
    [createUiPlan, { states: [{ name: "Intro", description: "Start" }] }],
  ])("rejects mixed full-content and convenience inputs", (action, extra) => {
    const schema = action.schema as z.ZodType;

    expect(() =>
      schema.parse({
        brief: "Review the visual direction.",
        content,
        ...extra,
      }),
    ).toThrow(/complete visual-plan replacement/i);
  });
});
