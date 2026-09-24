import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existing: [] as { id: string }[],
  inserted: vi.fn(),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => undefined,
  getRequestUserEmail: () => "owner@example.test",
  getRequestOrgId: () => "test-org",
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => mocks.existing }) }),
    }),
    insert: () => ({ values: mocks.inserted }),
  }),
  schema: { designSystems: {} },
}));
import action from "./create-design-system";

const data = JSON.stringify({
  colors: Object.fromEntries(
    [
      "primary",
      "secondary",
      "accent",
      "background",
      "surface",
      "text",
      "textMuted",
    ].map((key) => [key, "test-color"]),
  ),
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    headingWeight: "600",
    bodyWeight: "400",
  },
});
beforeEach(() => {
  mocks.existing = [];
  mocks.inserted.mockReset();
});
describe("prompt-created design systems", () => {
  it("does not change workspace defaults when created from a prompt", async () => {
    const result = await action.run({
      title: "Prompt brand",
      data,
      makeDefaultIfFirst: false,
    });
    expect(result.isDefault).toBe(false);
    expect(mocks.inserted).toHaveBeenCalledWith(
      expect.objectContaining({
        isDefault: false,
        ownerEmail: "owner@example.test",
        orgId: "test-org",
      }),
    );
  });
  it("preserves legacy first-system defaults when not opted out", async () => {
    expect((await action.run({ title: "First brand", data })).isDefault).toBe(
      true,
    );
  });
  it("never replaces an existing default", async () => {
    mocks.existing = [{ id: "existing" }];
    expect((await action.run({ title: "Next brand", data })).isDefault).toBe(
      false,
    );
  });
});
