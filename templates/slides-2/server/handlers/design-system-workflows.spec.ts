import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
}));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: mocks.enabled,
}));

import { DESIGN_SYSTEM_WORKFLOWS } from "../../shared/design-flags.js";
import { assertDesignSystemWorkflowsEnabled } from "../lib/design-system-workflows.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(false);
});

describe("design system setup gates", () => {
  it("declares a default-off app flag", () => {
    expect(DESIGN_SYSTEM_WORKFLOWS).toMatchObject({
      key: "design-system-workflows",
      defaultValue: false,
    });
  });
  it("passes authenticated identity to flag evaluation", async () => {
    mocks.enabled.mockResolvedValue(true);
    await runWithRequestContext(
      { userEmail: "member@example.com", orgId: "org-example" },
      assertDesignSystemWorkflowsEnabled,
    );
    expect(mocks.enabled).toHaveBeenCalledWith(DESIGN_SYSTEM_WORKFLOWS, {
      userEmail: "member@example.com",
      orgId: "org-example",
    });
  });
});
