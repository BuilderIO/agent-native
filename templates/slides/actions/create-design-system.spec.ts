import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  db: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: mocks.enabled,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "member@example.com",
  getRequestOrgId: () => "org-example",
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mocks.db,
  schema: {
    designSystems: { id: "id", ownerEmail: "ownerEmail", orgId: "orgId" },
  },
}));
import action from "./create-design-system.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.mockReturnValue({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: () => ({ values: mocks.insert }),
  });
});
describe("create-design-system flag", () => {
  it("rejects off before reading or writing the database", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(
      action.run({ title: "Example", data: "{}" }),
    ).rejects.toMatchObject({
      errorCode: "design_system_workflows_disabled",
      statusCode: 403,
    });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("preserves owned creation and first-default behavior when on", async () => {
    mocks.enabled.mockResolvedValue(true);
    const colors = Object.fromEntries(
      [
        "primary",
        "secondary",
        "accent",
        "background",
        "surface",
        "text",
        "textMuted",
      ].map((key) => [key, "black"]),
    );
    await action.run({
      title: "Example",
      data: JSON.stringify({
        colors,
        typography: {
          headingFont: "Inter",
          bodyFont: "Inter",
          headingWeight: "600",
          bodyWeight: "400",
        },
      }),
    });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Example",
        ownerEmail: "member@example.com",
        orgId: "org-example",
        isDefault: true,
      }),
    );
  });
});
