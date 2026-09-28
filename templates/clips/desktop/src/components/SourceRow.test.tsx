// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SourceRow } from "./SourceRow";

describe("SourceRow", () => {
  it("labels the deferred window picker as Window", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    const onChooseWindow = vi.fn();

    act(() => {
      root.render(
        <SourceRow
          value="full-screen"
          onChange={onChange}
          onChooseWindow={onChooseWindow}
        />,
      );
    });

    const trigger = host.querySelector(
      'button[aria-label="Choose capture source: Full screen"]',
    );
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });

    expect(document.querySelector('[role="separator"]')).toBeNull();

    const windowItem = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Window");
    expect(windowItem).not.toBeUndefined();
    expect(document.body.textContent).not.toContain("Choose window");
    expect(document.body.textContent).not.toContain("Select window");

    act(() => {
      (windowItem as HTMLElement).click();
    });

    expect(onChange).toHaveBeenCalledWith("window");
    expect(onChooseWindow).toHaveBeenCalledOnce();

    act(() => root.unmount());
    host.remove();
  });
});
