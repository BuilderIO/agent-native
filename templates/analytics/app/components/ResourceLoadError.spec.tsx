// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResourceLoadError } from "./ResourceLoadError";

describe("ResourceLoadError", () => {
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

  it.each([false, true])(
    "shows the load failure and retries when inline is %s",
    async (inline) => {
      const onRetry = vi.fn();

      await act(async () => {
        root.render(
          <ResourceLoadError
            message="Some results couldn't be loaded."
            retryLabel="Retry"
            onRetry={onRetry}
            inline={inline}
          />,
        );
      });

      expect(container.textContent).toContain(
        "Some results couldn't be loaded.",
      );

      await act(async () => {
        container.querySelector("button")?.click();
      });

      expect(onRetry).toHaveBeenCalledOnce();
    },
  );
});
