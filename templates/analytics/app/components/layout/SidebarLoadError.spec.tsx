// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarLoadError } from "./SidebarLoadError";

describe("SidebarLoadError", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the action failure and lets the user retry", async () => {
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <SidebarLoadError
          message="Couldn't load dashboards"
          retryLabel="Retry"
          onRetry={onRetry}
        />,
      );
    });

    expect(container.textContent).toContain("Couldn't load dashboards");

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
