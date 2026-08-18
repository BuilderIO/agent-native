import { describe, expect, it } from "vitest";

import patchVisualPlanSource from "./patch-visual-plan-source.js";
import updateVisualPlan from "./update-visual-plan.js";

type JsonSchema = {
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  const?: string;
};

function advertised(action: typeof updateVisualPlan): JsonSchema {
  return action.tool.parameters as JsonSchema;
}

function advertisedOps(action: { tool: { parameters: unknown } }) {
  const parameters = action.tool.parameters as JsonSchema;
  const patchSchema =
    parameters.properties?.contentPatches ?? parameters.properties?.patches;
  return (patchSchema?.items?.oneOf ?? patchSchema?.items?.anyOf ?? [])
    .map((option) => option.properties?.op?.const)
    .filter((op): op is string => typeof op === "string");
}

describe("Plan agent write schemas", () => {
  it("advertises incremental visual-plan edits instead of full documents", () => {
    const parameters = advertised(updateVisualPlan);
    const properties = parameters.properties ?? {};
    const ops = advertisedOps(updateVisualPlan);

    expect(properties).not.toHaveProperty("content");
    expect(properties).not.toHaveProperty("html");
    expect(properties).not.toHaveProperty("markdown");
    expect(properties).not.toHaveProperty("sections");
    expect(ops).toContain("append-block");
    expect(ops).toContain("update-rich-text");
    expect(ops).not.toContain("replace-block");
    expect(ops).not.toContain("replace-blocks");
    expect(ops).not.toContain("set-prototype");
    expect(JSON.stringify(parameters).length).toBeLessThan(16_000);
  });

  it("does not advertise full-file source writes to agents", () => {
    const ops = advertisedOps({
      tool: { parameters: patchVisualPlanSource.tool.parameters },
    });

    expect(ops).toContain("replace-markdown-block");
    expect(ops).toContain("update-component-prop");
    expect(ops).not.toContain("replace-file");
    expect(ops).not.toContain("replace-artboard");
  });
});
