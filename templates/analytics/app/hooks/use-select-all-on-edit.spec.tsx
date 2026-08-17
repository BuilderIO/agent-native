// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSelectAllOnEdit } from "./use-select-all-on-edit";

describe("useSelectAllOnEdit", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback): number => {
        cb(0);
        return 0;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function Probe({ isEditing }: { isEditing: boolean }) {
    const ref = useSelectAllOnEdit<HTMLInputElement>(isEditing);
    return <input ref={ref} defaultValue="Existing title" />;
  }

  it("selects the input's text once editing starts", async () => {
    await act(async () => {
      root.render(<Probe isEditing={true} />);
    });

    const input = container.querySelector("input")!;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Existing title".length);
  });

  it("does nothing while not editing", async () => {
    await act(async () => {
      root.render(<Probe isEditing={false} />);
    });

    const input = container.querySelector("input")!;
    expect(input.selectionStart).toBe(input.selectionEnd);
  });
});
