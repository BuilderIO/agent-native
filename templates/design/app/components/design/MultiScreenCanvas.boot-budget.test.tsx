// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MultiScreenCanvas } from "./MultiScreenCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("MultiScreenCanvas live boot budget", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 2000,
      bottom: 1400,
      left: 0,
      width: 2000,
      height: 1400,
      toJSON: () => ({}),
    });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    container.remove();
  });

  it("mounts four live screens, shows snapshots for deferred screens, and frees a slot on ready", async () => {
    const screens = Array.from({ length: 8 }, (_, index) => ({
      id: `live-${index}`,
      filename: `live-${index}.html`,
      content: "<!doctype html><html><body>live</body></html>",
      source: "localhost",
      sourceType: "localhost",
      previewUrl: `http://127.0.0.1:8084/route-${index}`,
    }));
    const readyById = new Map<string, () => void>();
    const renderCalls: string[] = [];

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={100}
          activeTool="move"
          geometryById={Object.fromEntries(
            screens.map((screen, index) => [
              screen.id,
              { x: index * 10, y: 0, width: 320, height: 640 },
            ]),
          )}
          screenSnapshotsById={Object.fromEntries(
            screens.map((screen) => [screen.id, { html: "<p>snapshot</p>" }]),
          )}
          renderScreenContent={(screen, _metadata, _geometry, options) => {
            renderCalls.push(screen.id);
            if (options?.onBootReady) {
              readyById.set(screen.id, options.onBootReady);
            }
            return <div data-live-screen={screen.id} />;
          }}
          onPick={() => {}}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-live-screen]")).toHaveLength(4);
      expect(container.querySelectorAll("[data-screen-snapshot]")).toHaveLength(
        4,
      );
    });
    expect(renderCalls).toHaveLength(4);

    expect(readyById.size).toBe(4);
    const firstReady = readyById.values().next().value as
      | (() => void)
      | undefined;
    expect(firstReady).toBeTypeOf("function");
    await act(async () => firstReady?.());

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-live-screen]")).toHaveLength(5);
    });
    expect(renderCalls).toContain("live-4");
  });

  it("keeps a deferred screen deferred when a ready frame starts a new document", async () => {
    const screens = Array.from({ length: 6 }, (_, index) => ({
      id: `live-${index}`,
      filename: `live-${index}.html`,
      content: "<!doctype html><html><body>live</body></html>",
      source: "localhost",
      sourceType: "localhost",
      previewUrl: `http://127.0.0.1:8084/route-${index}`,
    }));
    const readyById = new Map<string, () => void>();
    const startById = new Map<string, () => void>();

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={100}
          activeTool="move"
          geometryById={Object.fromEntries(
            screens.map((screen, index) => [
              screen.id,
              { x: index * 10, y: 0, width: 320, height: 640 },
            ]),
          )}
          screenSnapshotsById={Object.fromEntries(
            screens.map((screen) => [screen.id, { html: "<p>snapshot</p>" }]),
          )}
          renderScreenContent={(screen, _metadata, _geometry, options) => {
            if (options?.onBootReady) {
              readyById.set(screen.id, options.onBootReady);
            }
            if (options?.onBootStart) {
              startById.set(screen.id, options.onBootStart);
            }
            return <div data-live-screen={screen.id} />;
          }}
          onPick={() => {}}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-live-screen]")).toHaveLength(4);
      expect(container.querySelectorAll("[data-screen-snapshot]")).toHaveLength(
        2,
      );
    });

    const firstScreenId = readyById.keys().next().value as string;
    await act(async () => readyById.get(firstScreenId)?.());
    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-live-screen]")).toHaveLength(5);
      expect(container.querySelectorAll("[data-screen-snapshot]")).toHaveLength(
        1,
      );
    });

    await act(async () => startById.get(firstScreenId)?.());
    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-live-screen]")).toHaveLength(5);
      expect(container.querySelectorAll("[data-screen-snapshot]")).toHaveLength(
        1,
      );
    });
  });
});
