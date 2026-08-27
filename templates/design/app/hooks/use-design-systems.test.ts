import { describe, expect, it, vi } from "vitest";

const actionQuery = vi.hoisted(() => ({
  data: undefined as unknown,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: actionQuery.data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { useDesignSystems } from "./use-design-systems.js";

function summary(overrides: Record<string, unknown>) {
  return {
    id: "ds",
    title: "Design system",
    description: null,
    data: "{}",
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("useDesignSystems defaultSystem", () => {
  it("ignores an org member's default and picks the viewer's own", () => {
    actionQuery.data = {
      designSystems: [
        summary({
          id: "teammate_default",
          isDefault: true,
          accessRole: "editor",
        }),
        summary({ id: "mine", isDefault: true, accessRole: "owner" }),
      ],
    };

    expect(useDesignSystems().defaultSystem?.id).toBe("mine");
  });

  it("reports no default when only another member's system is flagged", () => {
    actionQuery.data = {
      designSystems: [
        summary({
          id: "teammate_default",
          isDefault: true,
          accessRole: "viewer",
        }),
      ],
    };

    expect(useDesignSystems().defaultSystem).toBeUndefined();
  });
});
