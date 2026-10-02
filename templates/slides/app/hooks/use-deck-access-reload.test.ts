// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeckReloadStatus } from "@/context/DeckContext";

import { useDeckAccessReload } from "./use-deck-access-reload";

afterEach(cleanup);

const KEY = "deck-1|org-1";
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mirrors DeckContext: `reloadDecksWithStatus` flips the shared `loading`
 * flag around the fetch, and the hook reads that flag, so every reload
 * re-runs the hook's effect mid-flight.
 */
function renderWithLoadingReload(
  statuses: DeckReloadStatus[],
  orgId: string | null = "org-1",
) {
  const reload = vi.fn<() => Promise<DeckReloadStatus>>();
  const { result } = renderHook(() => {
    const [loading, setLoading] = useState(false);
    reload.mockImplementation(async () => {
      setLoading(true);
      await tick();
      setLoading(false);
      return statuses[
        Math.min(reload.mock.calls.length - 1, statuses.length - 1)
      ];
    });
    return useDeckAccessReload({
      accessKey: KEY,
      deckFound: false,
      loading,
      orgId,
      orgLoading: false,
      reload,
    });
  });
  return { reload, result };
}

describe("useDeckAccessReload", () => {
  it("reloads an unopenable deck once instead of looping on its own loading flip", async () => {
    const { reload, result } = renderWithLoadingReload(["loaded"]);

    await waitFor(() => expect(result.current).toBe(KEY));
    await act(() => tick(80));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("retries a superseded reload, then settles", async () => {
    const { reload, result } = renderWithLoadingReload([
      "stale",
      "stale",
      "loaded",
    ]);

    await waitFor(() => expect(result.current).toBe(KEY));
    await act(() => tick(80));

    expect(reload).toHaveBeenCalledTimes(3);
  });

  it("settles without a reload when there is no organization", async () => {
    const { reload, result } = renderWithLoadingReload(["loaded"], null);

    await waitFor(() => expect(result.current).toBe(KEY));

    expect(reload).not.toHaveBeenCalled();
  });
});
