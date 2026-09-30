// @vitest-environment happy-dom

import React, { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recoverFromStaleChunkError = vi.hoisted(() => vi.fn(() => false));

vi.mock("@agent-native/core/client/route-chunk-recovery", () => ({
  recoverFromStaleChunkError,
}));

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";

import { LazyChunkErrorBoundary } from "./LazyChunkErrorBoundary.js";
import { LazyChunkRetryFallback } from "./LazyChunkRetryFallback.js";

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
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <>
            <div data-testid="app-content">App content</div>
            <LazyChunkErrorBoundary
              fallback={<LazyChunkRetryFallback onRetry={onRetry} />}
            >
              <Suspense fallback={<div data-testid="lazy-loading" />}>
                <FailingLazy />
              </Suspense>
            </LazyChunkErrorBoundary>
          </>
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='app-content']")).toBeTruthy();
    expect(container.querySelector("[role='alert']")?.textContent).toBeTruthy();
    const retry = container.querySelector("button");
    expect(retry?.textContent).toBe("Retry");
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(recoverFromStaleChunkError).toHaveBeenCalledWith(expect.any(Error));
  });
});
