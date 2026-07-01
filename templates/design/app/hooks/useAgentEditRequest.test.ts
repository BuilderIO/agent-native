import { describe, expect, it } from "vitest";

import { buildEditContext, buildFullPrompt } from "./useAgentEditRequest";

describe("useAgentEditRequest prompt context", () => {
  it("includes localhost route source files for local visual-edit handoff", () => {
    const context = buildEditContext({
      message: "Make this button primary",
      designId: "design-123",
      fileId: "file-abc",
      filename: "/pricing",
      selector: '[data-agent-native-node-id="cta"]',
      sourceId: "cta",
      routeSourceFile: "src/routes/pricing.tsx",
    });

    expect(context).toContain('Design id: "design-123".');
    expect(context).toContain(
      'Localhost source file to route edits through: "src/routes/pricing.tsx".',
    );
    expect(context).toContain(
      "Route edits through the agent code editing surface",
    );

    expect(
      buildFullPrompt({
        message: "Make this button primary",
        routeSourceFile: "src/routes/pricing.tsx",
      }),
    ).toContain("src/routes/pricing.tsx");
  });
});
