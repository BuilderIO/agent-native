import { afterEach, describe, expect, it, vi } from "vitest";

import { observeNextPage } from "./infinite-pagination";

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
});
