import { describe, expect, it } from "vitest";

import {
  readAutomationDisplayName,
  resolveAutomationDisplayName,
  setAutomationFrontmatterField,
} from "./factory-scope.js";

describe("factory automation display names", () => {
  it("falls back to the automation name when displayName is absent", () => {
    expect(
      resolveAutomationDisplayName(
        "factories/acme/factory-slack-feedback",
        "---\nenabled: true\n---\n",
      ),
    ).toBe("factories/acme/factory-slack-feedback");
  });

  it("reads and writes displayName frontmatter", () => {
    const content = "---\nenabled: true\n---\nBody";
    const updated = setAutomationFrontmatterField(
      content,
      "displayName",
      "My Slack triage",
    );
    expect(readAutomationDisplayName(updated)).toBe("My Slack triage");
    expect(
      resolveAutomationDisplayName(
        "factories/acme/factory-github-issues",
        updated,
      ),
    ).toBe("My Slack triage");
  });
});
