// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useDeckVisibility } from "./use-deck-visibility";

const SHARES_KEY = [
  "action",
  "list-resource-shares",
  { resourceType: "deck", resourceId: "deck-1" },
] as const;

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => cleanup());

describe("useDeckVisibility", () => {
  it("uses the deck's visibility until the share record has loaded", () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useDeckVisibility("deck-1", "private"),
      { wrapper },
    );

    expect(result.current).toBe("private");
  });

  it("follows an access change the Share panel writes to the share record", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(SHARES_KEY, { visibility: "private", shares: [] });
    const { result } = renderHook(
      () => useDeckVisibility("deck-1", "private"),
      { wrapper },
    );
    expect(result.current).toBe("private");

    act(() => {
      queryClient.setQueryData(SHARES_KEY, {
        visibility: "public",
        shares: [],
      });
    });

    await waitFor(() => expect(result.current).toBe("public"));
  });

  it("falls back to the deck when the share record has no visibility", () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(SHARES_KEY, { visibility: null, shares: [] });
    const { result } = renderHook(() => useDeckVisibility("deck-1", "org"), {
      wrapper,
    });

    expect(result.current).toBe("org");
  });

  it("does not read another deck's share record", () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(
      [
        "action",
        "list-resource-shares",
        { resourceType: "deck", resourceId: "deck-2" },
      ],
      { visibility: "public", shares: [] },
    );
    const { result } = renderHook(
      () => useDeckVisibility("deck-1", "private"),
      { wrapper },
    );

    expect(result.current).toBe("private");
  });
});
