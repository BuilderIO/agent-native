// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("MultiScreenCanvas initial keyboard focus", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy?.mockRestore();
    rectSpy = undefined;
    container.remove();
  });

  it("keeps focus on the canvas while multiple live previews become ready", async () => {
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

    await act(async () =>
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "library",
              filename: "Library",
              content: "http://localhost:3102/library",
            },
            {
              id: "settings",
              filename: "Settings",
              content: "http://localhost:3102/settings",
            },
          ]}
          zoom={100}
          editableScreenIds={new Set(["library", "settings"])}
          renderScreenContent={(screen) => (
            <iframe data-screen-iframe-id={screen.id} />
          )}
          onPick={() => {}}
        />,
      ),
    );

    const surface = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-surface]",
    );
    const libraryFrame = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="library"]',
    );
    const settingsFrame = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="settings"]',
    );
    expect(surface).not.toBeNull();
    expect(libraryFrame).not.toBeNull();
    expect(settingsFrame).not.toBeNull();
    expect(document.activeElement).toBe(surface);

    libraryFrame!.focus();
    expect(document.activeElement).toBe(surface);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      settingsFrame!.focus();
      settingsFrame!.dispatchEvent(new Event("load"));
    });
    expect(document.activeElement).toBe(surface);
  });

  it("leaves live-frame focus alone in Interact mode", async () => {
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

    await act(async () =>
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "library",
              filename: "Library",
              content: "http://localhost:3102/library",
            },
          ]}
          zoom={100}
          interactMode
          editableScreenIds={new Set(["library"])}
          renderScreenContent={(screen) => (
            <iframe data-screen-iframe-id={screen.id} />
          )}
          onPick={() => {}}
        />,
      ),
    );

    const frame = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="library"]',
    );
    expect(frame).not.toBeNull();
    frame!.focus();
    expect(document.activeElement).toBe(frame);
  });
});
