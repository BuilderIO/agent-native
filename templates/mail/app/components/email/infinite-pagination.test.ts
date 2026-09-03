import { afterEach, describe, expect, it, vi } from "vitest";

import {
  observeNextPage,
  retryNextPage,
  shouldShowPaginationRetry,
} from "./infinite-pagination";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(_element: Element): void {}

  disconnect(): void {}

  emit(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeIntersectionObserver.instances = [];
});

describe("infinite filtered pagination", () => {
  it("re-arms through two empty pages before reaching a matching page", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      FakeIntersectionObserver as unknown as typeof IntersectionObserver,
    );

    const pages = [[], [], [{ id: "matching-thread" }]];
    const loadedPages: unknown[][] = [];
    let isFetchingNextPage = false;
    let cleanup = () => {};
    const fetchNextPage = vi.fn(async () => {
      loadedPages.push(pages[loadedPages.length]);
    });

    const rearm = (hasNextPage: boolean) => {
      cleanup();
      cleanup = observeNextPage({
        element: {} as Element,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError: false,
        fetchNextPage,
      });
      return FakeIntersectionObserver.instances[
        FakeIntersectionObserver.instances.length - 1
      ];
    };

    rearm(true)?.emit(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    isFetchingNextPage = true;
    rearm(true)?.emit(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    await Promise.resolve();

    isFetchingNextPage = false;
    rearm(true)?.emit(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
    isFetchingNextPage = true;
    rearm(true)?.emit(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
    await Promise.resolve();

    isFetchingNextPage = false;
    rearm(true)?.emit(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(3);
    expect(loadedPages).toEqual(pages);
  });

  it("waits for an explicit retry after a page fetch fails", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      FakeIntersectionObserver as unknown as typeof IntersectionObserver,
    );

    const fetchNextPage = vi.fn(async () => undefined);

    observeNextPage({
      element: {} as Element,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: true,
      fetchNextPage,
    });

    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it("shows retry for a failed later page even when earlier pages have matches", () => {
    expect(
      shouldShowPaginationRetry({
        hasNextPage: true,
        isFetchingNextPage: false,
        isFetchNextPageError: true,
      }),
    ).toBe(true);
    expect(
      shouldShowPaginationRetry({
        hasNextPage: true,
        isFetchingNextPage: true,
        isFetchNextPageError: true,
      }),
    ).toBe(false);
    expect(
      shouldShowPaginationRetry({
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: true,
      }),
    ).toBe(false);
  });

  it("handles a rejected explicit retry without leaking an unhandled promise", async () => {
    const fetchNextPage = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const inFlightState = { current: false };

    await expect(
      retryNextPage(fetchNextPage, inFlightState),
    ).resolves.toBeUndefined();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(inFlightState.current).toBe(false);
  });

  it("coalesces rapid explicit retries before React updates query state", async () => {
    let resolveRequest: (() => void) | undefined;
    const fetchNextPage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const inFlightState = { current: false };

    const firstRetry = retryNextPage(fetchNextPage, inFlightState);
    const secondRetry = retryNextPage(fetchNextPage, inFlightState);

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(inFlightState.current).toBe(true);
    resolveRequest?.();
    await Promise.all([firstRetry, secondRetry]);
    expect(inFlightState.current).toBe(false);
  });
});
