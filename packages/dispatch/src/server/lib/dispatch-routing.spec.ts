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

  it.each([
    "Create a one-pager for the launch",
    "Draft a one pager about our new product",
    "Put together a one-page brief for sales",
    "Create one-pagers for sales and marketing",
    "Create a concise and compelling one-pager",
  ])("routes one-pagers to Content or inline output: %s", (text) => {
    const hint = dispatchIntegrationRoutingHint(text);

    expect(hint).toMatchObject({ targetAgent: "content" });
    expect(hint?.instruction).toContain("inline");
    expect(hint?.instruction).toContain("Do not route a one-pager to Plan");
  });

  it.each([
    "Create a one-page intake form",
    "Add a one-pager to the request queue",
  ])("preserves structured-intake routing for one-pagers: %s", (text) => {
    const hint = dispatchIntegrationRoutingHint(text);

    expect(hint?.targetAgent).toBeUndefined();
    expect(hint?.instruction).toContain("workspace instructions/resources");
  });

  it.each([
    "Design a visual one-pager for the new feature",
    "Design a one-page website for the launch",
    "Build a one-page website for the launch",
    "Prepare a one-page website for the launch",
    "Draft a one-page website for the launch",
    "Generate a visual mockup for the campaign",
  ])("preserves visual-design routing for one-pagers: %s", (text) => {
    expect(dispatchIntegrationRoutingHint(text)).toMatchObject({
      targetAgent: "design",
    });
  });

  it("lets a negated intake qualifier fall through to Content", () => {
    expect(
      dispatchIntegrationRoutingHint(
        "Create a one-pager that is not an intake form",
      ),
    ).toMatchObject({ targetAgent: "content" });
  });

  it("recognizes a later visual request after a contrastive clause", () => {
    expect(
      dispatchIntegrationRoutingHint(
        "Don't create a one-pager but rather create a visual mockup",
      ),
    ).toMatchObject({ targetAgent: "design" });
  });

  it("does not route a visually negated one-pager to Design", () => {
    expect(
      dispatchIntegrationRoutingHint(
        "Create a one-pager that is not a visual design",
      ),
    ).toMatchObject({ targetAgent: "content" });
  });

  it.each([
    "Create a one-pager without a visual design",
    "Create a one-pager with no visual design",
    "Create a one-pager, no visual design",
    "Create a one-pager without an elaborate interactive visual design",
  ])("does not route a visually excluded one-pager to Design: %s", (text) => {
    expect(dispatchIntegrationRoutingHint(text)).toMatchObject({
      targetAgent: "content",
    });
  });

  it.each([
    "Write a one-pager about the website",
    "Prepare a report about the website",
  ])("does not route prose about visual artifacts to Design: %s", (text) => {
    const hint = dispatchIntegrationRoutingHint(text);

    expect(hint?.targetAgent).not.toBe("design");
    if (text.startsWith("Write a one-pager")) {
      expect(hint).toMatchObject({ targetAgent: "content" });
    }
  });

  it.each(["Compare these one-page briefs", "Edit the one-pager copy"])(
    "leaves non-creation one-pager requests to normal discovery: %s",
    (text) => {
      expect(dispatchIntegrationRoutingHint(text)).toBeUndefined();
    },
  );

  it.each([
    "Create an interactive one-page plan for the launch",
    "Create an interactive visual plan for the launch",
    "Create an interactive, visual plan for the launch",
    "Create a visual, interactive prototype for the launch",
    "Create interactive visual prototypes for the launch",
    "Create visual recaps for the launch",
  ])("keeps explicit interactive visual plan requests on Plan: %s", (text) => {
    expect(dispatchIntegrationRoutingHint(text)).toMatchObject({
      targetAgent: "plan",
    });
  });

  it.each([
    "Compare interactive visual plan options",
    "What is an interactive prototype?",
    "Create a launch email and discuss an interactive visual plan",
  ])("does not route informational Plan mentions: %s", (text) => {
    expect(dispatchIntegrationRoutingHint(text)).toBeUndefined();
  });

  it.each([
    "How do I create a one-pager?",
    "Explain how to create an interactive visual plan",
  ])("does not route how-to questions as artifact creation: %s", (text) => {
    expect(dispatchIntegrationRoutingHint(text)).toBeUndefined();
  });

  it.each([
    "Do not create a one-pager",
    "Do not create an interactive visual plan",
    "Create no one-pager",
    "Write no one-pager",
    "Create not a one-pager",
    "Create no interactive visual plan",
    "No need to create a one-pager",
    "There is no need to create an interactive visual plan",
  ])("does not route negated requests: %s", (text) => {
    expect(dispatchIntegrationRoutingHint(text)).toBeUndefined();
  });

  it("lets an affirmative one-pager override a negated Plan mention", () => {
    for (const text of [
      "Do not create an interactive visual plan; instead create a one-pager",
      "Don't create a visual plan, create a one-pager instead",
      "Don't create a visual plan, but create a one-pager instead",
      "Do not create an interactive visual plan: create a one-pager",
      "Do not create an interactive visual plan — create a one-pager",
      "Do not use an interactive visual plan template to create a one-pager",
      "For the customer who is not available, create a one-pager",
    ]) {
      expect(dispatchIntegrationRoutingHint(text)).toMatchObject({
        targetAgent: "content",
      });
    }
  });

  it("recognizes affirmative not-only constructions", () => {
    expect(
      dispatchIntegrationRoutingHint(
        "Create not only a one-pager but also a launch email",
      ),
    ).toMatchObject({ targetAgent: "content" });
    expect(
      dispatchIntegrationRoutingHint(
        "Create not only an interactive visual plan but also a launch email",
      ),
    ).toMatchObject({ targetAgent: "plan" });
  });

  it("does not route a later negated one-pager action", () => {
    expect(
      dispatchIntegrationRoutingHint(
        "Create a plan but don't write a one-pager",
      ),
    ).toBeUndefined();
  });

  it("keeps a one-pager over an excluded Plan phrase", () => {
    expect(
      dispatchIntegrationRoutingHint(
        "Create a one-pager instead of an interactive visual plan",
      ),
    ).toMatchObject({ targetAgent: "content" });
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
