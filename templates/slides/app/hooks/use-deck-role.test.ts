// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useActionQuery: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => mocks.useActionQuery(...args),
}));

import { useDeckRole } from "./use-deck-role";

describe("useDeckRole", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.useActionQuery.mockReset();
    mocks.useActionQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  it.each([
    ["owner", true],
    ["editor", true],
    ["viewer", false],
  ] as const)(
    "uses the scoped widget %s role when share details are unavailable",
    (role, canEdit) => {
      const { result } = renderHook(() => useDeckRole("deck-1", false, role));

      expect(result.current.role).toBe(role);
      expect(result.current.canEdit).toBe(canEdit);
    },
  );

  it("prefers the current share response over the widget fallback", () => {
    mocks.useActionQuery.mockReturnValue({
      data: { role: "viewer" },
      isLoading: false,
    });

    const { result } = renderHook(() => useDeckRole("deck-1", false, "editor"));

    expect(result.current.role).toBe("viewer");
    expect(result.current.canEdit).toBe(false);
  });
});
