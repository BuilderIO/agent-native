// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutoFocusSelect } from "./use-auto-focus-select";

function RenameInput({ enabled }: { enabled: boolean }) {
  const inputRef = useAutoFocusSelect<HTMLInputElement>(enabled);
  return <input ref={inputRef} defaultValue="Revenue dashboard" />;
}

describe("useAutoFocusSelect", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("focuses and selects the full value when renaming starts", async () => {
    await act(async () => {
      root.render(<RenameInput enabled />);
    });

    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe("Revenue dashboard".length);
  });
});
