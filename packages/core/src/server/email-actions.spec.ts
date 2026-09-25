import { describe, expect, it } from "vitest";

import { createCoreEmailActionEntries } from "./email-actions.js";

describe("core-send-email action guidance", () => {
  it("keeps interactive email sends draft-first", () => {
    const description =
      createCoreEmailActionEntries()["core-send-email"].tool.description;

    expect(description).toContain("DRAFT-FIRST SAFETY RULE");
    expect(description).not.toContain("unattended automation run");
  });

  it("authorizes delivery for unattended automation runs", () => {
    const description = createCoreEmailActionEntries({ unattended: true })[
      "core-send-email"
    ].tool.description;

    expect(description).toContain(
      "explicitly authorized unattended automation",
    );
    expect(description).toContain(
      "without asking for an interactive confirmation",
    );
    expect(description).not.toContain("DRAFT-FIRST SAFETY RULE");
  });
});
