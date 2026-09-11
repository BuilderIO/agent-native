// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  dismiss: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "lifecycle-toast"),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import { useSonnerLifecycleToast } from "./use-sonner-lifecycle-toast";

function Probe() {
  const lifecycle = useSonnerLifecycleToast();
  return (
    <div>
      <button type="button" onClick={() => lifecycle.start("Uploading")}>
        start
      </button>
      <button type="button" onClick={() => lifecycle.start("Processing")}>
        update
      </button>
      <button type="button" onClick={() => lifecycle.success("Ready")}>
        finish
      </button>
    </div>
  );
}

describe("useSonnerLifecycleToast", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.clearAllMocks();
  });

  it("updates one loading toast and resolves it instead of stacking notifications", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<Probe />));

    const buttons = container.querySelectorAll("button");
    act(() => (buttons[0] as HTMLButtonElement).click());
    act(() => (buttons[1] as HTMLButtonElement).click());
    act(() => (buttons[2] as HTMLButtonElement).click());

    expect(toast.loading).toHaveBeenCalledTimes(2);
    expect(toast.loading).toHaveBeenNthCalledWith(1, "Uploading", {
      duration: Number.POSITIVE_INFINITY,
    });
    expect(toast.loading).toHaveBeenNthCalledWith(2, "Processing", {
      duration: Number.POSITIVE_INFINITY,
      id: "lifecycle-toast",
    });
    expect(toast.success).toHaveBeenCalledWith("Ready", {
      duration: 6_000,
      id: "lifecycle-toast",
    });
  });
});
