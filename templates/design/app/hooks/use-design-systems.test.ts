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

import {
  preferredOwnedDesignSystemId,
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

describe("preferredOwnedDesignSystemId", () => {
  it("never falls back to another member's org-visible system", () => {
    const designSystems = [
      summary({ id: "teammate", isDefault: false, accessRole: "editor" }),
    ];

    expect(preferredOwnedDesignSystemId(designSystems, undefined)).toBeNull();
  });

  it("falls back to the viewer's own first system when there is no default", () => {
    const designSystems = [
      summary({ id: "teammate", isDefault: false, accessRole: "editor" }),
      summary({ id: "mine", isDefault: false, accessRole: "owner" }),
    ];

    expect(preferredOwnedDesignSystemId(designSystems, undefined)).toBe("mine");
  });

  it("prefers the resolved default over the first owned system", () => {
    const designSystems = [
      summary({ id: "mine-first", isDefault: false, accessRole: "owner" }),
      summary({ id: "mine-default", isDefault: true, accessRole: "owner" }),
    ];

    expect(
      preferredOwnedDesignSystemId(designSystems, {
        id: "mine-default",
        data: "{}",
      }),
    ).toBe("mine-default");
  });

  it("skips a default still mid-index and falls back to a usable owned system", () => {
    const designSystems = [
      summary({
        id: "mine-default",
        isDefault: true,
        accessRole: "owner",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
        }),
      }),
      summary({ id: "mine-usable", isDefault: false, accessRole: "owner" }),
    ];

    expect(
      preferredOwnedDesignSystemId(designSystems, {
        id: "mine-default",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
        }),
      }),
    ).toBe("mine-usable");
  });
});
