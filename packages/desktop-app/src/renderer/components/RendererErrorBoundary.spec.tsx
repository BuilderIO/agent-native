// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/electron/renderer", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { RendererErrorBoundary } from "./RendererErrorBoundary.js";

function Thrower(): never {
  throw new Error("boom");
}

describe("RendererErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    captureException.mockClear();
    // React logs the caught error to console.error itself; silence that noise
    // without hiding an assertion failure from this test's own expectations.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it("renders the fallback instead of unmounting when a child throws", () => {
    act(() => {
      root.render(
        <RendererErrorBoundary>
          <Thrower />
        </RendererErrorBoundary>,
      );
    });

    expect(
      container.querySelector("[data-renderer-error-boundary]"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Something went wrong");
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("renders children normally when nothing throws", () => {
    act(() => {
      root.render(
        <RendererErrorBoundary>
          <p>All good</p>
        </RendererErrorBoundary>,
      );
    });

    expect(container.textContent).toContain("All good");
    expect(
      container.querySelector("[data-renderer-error-boundary]"),
    ).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("lets 'Try again' re-render the children without a full reload", () => {
    let shouldThrow = true;
    function MaybeThrow() {
      if (shouldThrow) throw new Error("boom");
      return <p>Recovered</p>;
    }

    act(() => {
      root.render(
        <RendererErrorBoundary>
          <MaybeThrow />
        </RendererErrorBoundary>,
      );
    });
    expect(
      container.querySelector("[data-renderer-error-boundary]"),
    ).not.toBeNull();

    shouldThrow = false;
    const tryAgain = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    expect(tryAgain).toBeDefined();
    act(() => tryAgain?.click());

    expect(container.textContent).toContain("Recovered");
  });
});
