import { describe, expect, it } from "vitest";

import { assessPlanPrompt } from "./create-plan-routing";

describe("assessPlanPrompt", () => {
  it.each([
    "Create higher fidelity mockups for this flow",
    "Make this polished, not sketchy",
    "Turn the wireframe into a production-like branded design",
    "Take this beyond the wireframe with full-fidelity screens",
  ])("routes high-fidelity design language to design: %s", (prompt) => {
    expect(assessPlanPrompt(prompt)).toEqual({ kind: "design" });
  });

  it("keeps an explicit wireframe request on the UI path", () => {
    expect(assessPlanPrompt("Wireframe the settings flow")).toEqual({
      kind: "ui",
    });
  });

  it("keeps non-UI requests on the general visual path", () => {
    expect(
      assessPlanPrompt("Plan the database migration and API contract"),
    ).toEqual({ kind: "visual" });
  });
});
