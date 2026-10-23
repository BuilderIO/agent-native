// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MultiScreenCanvasProps } from "./multi-screen/types";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("MultiScreenCanvas screen title label", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        right: 800,
        bottom: 600,
        left: 0,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  async function renderScreen(
    props: Partial<Pick<MultiScreenCanvasProps, "onRenameScreen">> = {},
  ) {
    const onPick = vi.fn();
    const onEdit = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "Home.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          creation={{ activeTool: "move" }}
          activeId="screen-a"
          selection={{ selectedScreenIds: [] }}
          geometry={{
            geometryById: {
              "screen-a": { x: 0, y: 0, width: 320, height: 640 },
            },
          }}
          onPick={onPick}
          onEdit={onEdit}
          {...props}
        />,
      );
    });
    const label = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-a"] [data-frame-label]',
    );
    expect(label).not.toBeNull();
    return { label: label!, onPick, onEdit };
  }

  it("right-click selects the screen before the canvas menu opens", async () => {
    const { label, onPick } = await renderScreen();
    const reachedMenuTrigger = vi.fn();
    container.addEventListener("contextmenu", reachedMenuTrigger);

    await act(async () => {
      label.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 20,
          clientY: 10,
        }),
      );
    });

    expect(onPick).toHaveBeenCalledWith("screen-a");
    expect(reachedMenuTrigger).toHaveBeenCalledTimes(1);
  });

  it("double-click renames the screen inline instead of zooming into it", async () => {
    const onRenameScreen = vi.fn();
    const { label, onEdit } = await renderScreen({ onRenameScreen });

    await act(async () => {
      label.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    expect(onEdit).not.toHaveBeenCalled();
    const input = container.querySelector<HTMLInputElement>(
      '[data-frame-id="screen-a"] input[data-frame-title-input]',
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Home");

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(input, "Mobile");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onRenameScreen).toHaveBeenCalledWith("screen-a", "Mobile");
    expect(
      container.querySelector('[data-frame-id="screen-a"] input'),
    ).toBeNull();
  });

  it("Escape cancels an inline rename", async () => {
    const onRenameScreen = vi.fn();
    const { label } = await renderScreen({ onRenameScreen });

    await act(async () => {
      label.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      "input[data-frame-title-input]",
    );
    expect(input).not.toBeNull();
    await act(async () => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onRenameScreen).not.toHaveBeenCalled();
    expect(container.querySelector("input[data-frame-title-input]")).toBeNull();
  });
});
