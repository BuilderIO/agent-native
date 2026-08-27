import { describe, expect, it, vi } from "vitest";

const actionQuery = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, error: null },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ ...actionQuery.result, refetch: vi.fn() }),
}));

import {
  isViewerDefaultDesignSystem,
  useDesignSystems,
} from "./use-design-systems.js";

function summary(overrides: Record<string, unknown>) {
  return {
    id: "ds",
    title: "Design system",
    description: null,
    data: "{}",
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Parameters<typeof isViewerDefaultDesignSystem>[0] & { id: string };
}

describe("isViewerDefaultDesignSystem", () => {
  it("accepts the viewer's own default", () => {
    expect(
      isViewerDefaultDesignSystem(
        summary({ isDefault: true, accessRole: "owner" }),
      ),
    ).toBe(true);
  });

  it("rejects another member's default", () => {
    for (const accessRole of [
      "viewer",
      "commenter",
      "editor",
      "admin",
      undefined,
    ]) {
      expect(
        isViewerDefaultDesignSystem(summary({ isDefault: true, accessRole })),
      ).toBe(false);
    }
  });

  it("rejects a system the viewer owns that is not flagged", () => {
    expect(
      isViewerDefaultDesignSystem(
        summary({ isDefault: false, accessRole: "owner" }),
      ),
    ).toBe(false);
  });
});

describe("useDesignSystems defaultSystem", () => {
  it("ignores an org member's default and picks the viewer's own", () => {
    actionQuery.result = {
      data: {
        designSystems: [
          summary({
            id: "teammate_default",
            isDefault: true,
            accessRole: "editor",
          }),
          summary({ id: "mine", isDefault: true, accessRole: "owner" }),
        ],
      },
      isLoading: false,
      error: null,
    };

    expect(useDesignSystems().defaultSystem?.id).toBe("mine");
  });

  it("reports no default when only another member's system is flagged", () => {
    actionQuery.result = {
      data: {
        designSystems: [
          summary({
            id: "teammate_default",
            isDefault: true,
            accessRole: "viewer",
          }),
        ],
      },
      isLoading: false,
      error: null,
    };

    expect(useDesignSystems().defaultSystem).toBeUndefined();
  });
});
