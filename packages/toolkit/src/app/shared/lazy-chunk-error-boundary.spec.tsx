// @vitest-environment happy-dom

import React, { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recoverFromStaleChunkError = vi.hoisted(() => vi.fn(() => false));

vi.mock("@agent-native/core/client/route-chunk-recovery", () => ({
  recoverFromStaleChunkError,
}));

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";

import { createToolkitI18nCatalog } from "../i18n.js";
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

  it("handles only the tagged import rejection and preserves its error identity", async () => {
    const error = new Error("Failed to fetch dynamically imported module");
    const onError = vi.fn();
    const errors = new Set<unknown>();
    const Panel = lazy(() =>
      Promise.reject(error).catch((error) => {
        errors.add(error);
        throw error;
      }),
    );
    await act(async () => {
      root.render(
        <LazyChunkErrorBoundary
          shouldHandleError={(error) => errors.has(error)}
          onError={onError}
          fallback={<div>Import failed</div>}
        >
          <Suspense fallback={null}>
            <Panel />
          </Suspense>
        </LazyChunkErrorBoundary>,
      );
    });
    expect(container.textContent).toBe("Import failed");
    expect(recoverFromStaleChunkError).toHaveBeenCalledWith(error);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("does not report a rejected error from the catch lifecycle", () => {
    const error = new Error("Panel render failed");
    const onError = vi.fn();
    const boundary = new LazyChunkErrorBoundary({
      children: null,
      fallback: null,
      shouldHandleError: () => false,
      onError,
    });
    recoverFromStaleChunkError.mockClear();
    boundary.componentDidCatch(error, { componentStack: "Panel" });
    expect(onError).not.toHaveBeenCalled();
    expect(recoverFromStaleChunkError).not.toHaveBeenCalled();
  });

  it("lets ordinary panel render errors reach the outer boundary", async () => {
    const error = new Error("Panel render failed");
    const caught = vi.fn();
    const onError = vi.fn();
    class OuterBoundary extends React.Component<
      { children: React.ReactNode },
      { error: unknown }
    > {
      state = { error: null as unknown };
      static getDerivedStateFromError(error: unknown) {
        return { error };
      }
      componentDidCatch(error: unknown) {
        caught(error);
      }
      render() {
        return this.state.error ? <div>Panel failed</div> : this.props.children;
      }
    }
    function Panel(): React.ReactNode {
      throw error;
    }
    recoverFromStaleChunkError.mockClear();
    await act(async () => {
      root.render(
        <OuterBoundary>
          <LazyChunkErrorBoundary
            shouldHandleError={() => false}
            onError={onError}
            fallback={<div>Import failed</div>}
          >
            <Panel />
          </LazyChunkErrorBoundary>
        </OuterBoundary>,
      );
    });
    expect(container.textContent).toBe("Panel failed");
    expect(caught).toHaveBeenCalledWith(error);
    expect(onError).not.toHaveBeenCalled();
    expect(recoverFromStaleChunkError).not.toHaveBeenCalled();
  });

  it("keeps sibling app content mounted when a lazy loader rejects", async () => {
    const onRetry = vi.fn();
    const onError = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={createToolkitI18nCatalog({ messages: {} })}
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <>
            <div data-testid="app-content">App content</div>
            <LazyChunkErrorBoundary
              fallback={<LazyChunkRetryFallback onRetry={onRetry} />}
              onError={onError}
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
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
  });
});
