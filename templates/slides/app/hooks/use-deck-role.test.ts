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

  it("prefers the scoped widget role over share details", () => {
    mocks.useActionQuery.mockReturnValue({
      data: { role: "viewer" },
      isLoading: false,
    });

    const { result } = renderHook(() => useDeckRole("deck-1", false, "editor"));

    expect(result.current.role).toBe("editor");
    expect(result.current.canEdit).toBe(true);
  });

  it("keeps ordinary editor role resolution on the share response", () => {
    mocks.useActionQuery.mockReturnValue({
      data: { role: "editor" },
      isLoading: false,
    });

    const { result } = renderHook(() => useDeckRole("deck-1"));

    expect(result.current.role).toBe("editor");
    expect(result.current.canEdit).toBe(true);
  });

  it("uses the scoped role without querying resource shares in a directory widget", () => {
    const { result } = renderHook(() =>
      useDeckRole("deck-1", true, "editor", true),
    );

    expect(result.current.canEdit).toBe(true);
    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "list-resource-shares",
      { resourceType: "deck", resourceId: "deck-1" },
      { enabled: false },
    );
  });

  it("fails closed while a directory widget has no scoped role", () => {
    const { result } = renderHook(() =>
      useDeckRole("deck-1", true, undefined, true),
    );

    expect(result.current.canEdit).toBe(false);
    expect(result.current.canComment).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});
