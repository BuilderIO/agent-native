import { describe, expect, it } from "vitest";

import { dispatchIntegrationRoutingHint } from "./dispatch-routing.js";

describe("dispatchIntegrationRoutingHint", () => {
  it.each([
    "File a security review request for the platform team",
    "Add this hiring ask to the intake board",
    "Add two design tasks for the launch page",
    "Create a design task for the new onboarding flow",
    "Create a vendor request form with the required fields",
    "What is currently in the editorial requests queue?",
  ])(
    "resolves structured intake through workspace capabilities: %s",
    (text) => {
      const hint = dispatchIntegrationRoutingHint(text);
      expect(hint?.targetAgent).toBeUndefined();
      expect(hint?.instruction).toContain("workspace instructions/resources");
      expect(hint?.instruction).toContain("do not assume a particular app");
    },
  );

  it.each([
    "Design a homepage for the launch",
    "Create a visual mockup for this settings screen",
    "Redesign the product UI",
  ])("routes visual output to Design: %s", (text) => {
    expect(dispatchIntegrationRoutingHint(text)).toMatchObject({
      targetAgent: "design",
    });
  });

  it("lets unrelated domain questions use normal agent discovery", () => {
    expect(
      dispatchIntegrationRoutingHint(
        "What were the reasons for closed-lost deals this quarter?",
      ),
    ).toBeUndefined();
  });

  it("leaves organization-specific shorthand to learned workspace instructions", () => {
    expect(dispatchIntegrationRoutingHint("Apoorva queue")).toBeUndefined();
  });
});
