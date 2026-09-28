// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  useActionQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => mocks);

import { useDesignSystems } from "./use-design-systems";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useDesignSystems", () => {
  it("returns the marked default instead of the first listed system", () => {
    mocks.useActionQuery.mockReturnValue({
      data: {
        designSystems: [
          { id: "updated-most-recently", isDefault: false },
          { id: "chosen-default", isDefault: true },
        ],
      },
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useDesignSystems());

    expect(result.current.defaultSystem?.id).toBe("chosen-default");
  });

  it("leaves the default unset when no system is marked default", () => {
    mocks.useActionQuery.mockReturnValue({
      data: {
        designSystems: [
          { id: "updated-most-recently", isDefault: false },
          { id: "also-available", isDefault: false },
        ],
      },
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useDesignSystems());

    expect(result.current.defaultSystem).toBeUndefined();
  });
});
