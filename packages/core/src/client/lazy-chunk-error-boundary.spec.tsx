// @vitest-environment happy-dom

import React, { lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recoverFromStaleChunkError = vi.hoisted(() => vi.fn(() => false));

vi.mock("./route-chunk-recovery.js", () => ({
  recoverFromStaleChunkError,
}));

import { LazyChunkErrorBoundary } from "./lazy-chunk-error-boundary.js";

const FailingLazy = lazy(() =>
  Promise.reject(new Error("Failed to fetch dynamically imported module")),
);

describe("LazyChunkErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("keeps sibling app content mounted when a lazy loader rejects", async () => {
    await act(async () => {
      root.render(
        <>
          <div data-testid="app-content">App content</div>
          <LazyChunkErrorBoundary
            fallback={<div data-testid="lazy-fallback">Retry later</div>}
          >
            <Suspense fallback={<div data-testid="lazy-loading" />}>
              <FailingLazy />
            </Suspense>
          </LazyChunkErrorBoundary>
        </>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='app-content']")).toBeTruthy();
    expect(
      container.querySelector("[data-testid='lazy-fallback']"),
    ).toBeTruthy();
    expect(recoverFromStaleChunkError).toHaveBeenCalledWith(expect.any(Error));
  });
});
