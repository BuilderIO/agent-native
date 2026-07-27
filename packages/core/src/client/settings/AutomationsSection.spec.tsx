import { describe, expect, it } from "vitest";

import {
  AUTOMATION_CREATION_SCOPE,
  automationCreationContext,
} from "./AutomationsSection.js";

describe("automationCreationContext", () => {
  it("truthfully routes creation to the supported personal scope", () => {
    const context = automationCreationContext();

    expect(AUTOMATION_CREATION_SCOPE).toBe("personal");
    expect(context).toContain("personal automation");
    expect(context).toContain("manage-automations with action=define");
    expect(context).not.toContain("organization");
  });
});
