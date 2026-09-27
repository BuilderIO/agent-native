// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BlurControl, ShadowNumberControl } from "./effects-properties";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("effect number controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function enterAndCommit(
    ariaLabel: string,
    value: string,
    onChange: ReturnType<typeof vi.fn>,
  ) {
    const input = container.querySelector<HTMLInputElement>(
      `input[aria-label="${ariaLabel}"]`,
    );
    expect(input).not.toBeNull();

    await act(async () => {
      input!.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(input!.value).toBe(value);
    expect(onChange).toHaveBeenLastCalledWith(Number(value), {
      phase: "preview",
    });

    await act(async () => input!.blur());
    expect(onChange).toHaveBeenLastCalledWith(Number(value), {
      phase: "commit",
    });
  }

  it("keeps a background blur draft when preview does not update the prop", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(BlurControl, {
          label: "Background blur",
          value: 8,
          onChange,
        }),
      );
    });

    await enterAndCommit("Background blur value", "17", onChange);
  });

  it("commits the edited shadow value instead of the stale projected prop", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(ShadowNumberControl, {
          label: "Blur",
          ariaLabel: "Blur",
          value: 12,
          min: 0,
          onChange,
        }),
      );
    });

    await enterAndCommit("Blur value", "24", onChange);
  });
});
