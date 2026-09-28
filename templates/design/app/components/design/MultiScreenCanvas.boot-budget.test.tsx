// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME,
  OVERVIEW_LIVE_SCREEN_BUDGET,
} from "./multi-screen/culling";
import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LARGE_BOARD_SCREEN_COUNT = OVERVIEW_LIVE_SCREEN_BUDGET + 1;

describe("MultiScreenCanvas live boot budget", () => {
  let container: HTMLDivElement;
  let root: Root;
  const liveScreenIds = () =>
    [...container.querySelectorAll("[data-live-screen]")].map((node) =>
      node.getAttribute("data-live-screen"),
    );

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
  it("boots a large board's inline editors through the budget and shows static previews meanwhile", async () => {
    const screens = inlineScreens(LARGE_BOARD_SCREEN_COUNT);
    const readyById = new Map<string, () => void>();

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
          renderScreenContent={(screen, _metadata, _geometry, options) => {
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
      expect(
        container.querySelectorAll("iframe[data-screen-iframe-id]"),
      ).toHaveLength(LARGE_BOARD_SCREEN_COUNT - 4);
    });
    expect(container.querySelector("[data-screen-placeholder]")).toBeNull();

    await act(async () => readyById.values().next().value?.());
    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-live-screen]")).toHaveLength(5);
    });
  });

  it("renders a large board's zoomed-out inline screens as static previews, except the active one", async () => {
    const screens = inlineScreens(LARGE_BOARD_SCREEN_COUNT);
    const renderCalls: string[] = [];

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={10}
          activeId="inline-1"
          activeTool="move"
          geometryById={Object.fromEntries(
            screens.map((screen, index) => [
              screen.id,
              { x: index * 1500, y: 0, width: 1440, height: 900 },
            ]),
          )}
          renderScreenContent={(screen) => {
            renderCalls.push(screen.id);
            return <div data-live-screen={screen.id} />;
          }}
          onPick={() => {}}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(liveScreenIds()).toEqual(["inline-1"]);
      const staticIds = [
        ...container.querySelectorAll("iframe[data-screen-static-preview]"),
      ].map((node) => node.getAttribute("data-screen-iframe-id"));
      expect(staticIds).toContain("inline-0");
      expect(staticIds).toContain("inline-2");
    });
    expect(new Set(renderCalls)).toEqual(new Set(["inline-1"]));
  });

  it("renders static previews with the editor's frame fit and tweak values", async () => {
    const screens = inlineScreens(LARGE_BOARD_SCREEN_COUNT);
    const render = (tweakValues: Record<string, string>) => (
      <MultiScreenCanvas
        screens={screens}
        zoom={10}
        activeId="inline-1"
        activeTool="move"
        tweakValues={tweakValues}
        geometryById={Object.fromEntries(
          screens.map((screen, index) => [
            screen.id,
            { x: index * 1500, y: 0, width: 1440, height: 900 },
          ]),
        )}
        metadataById={{ "inline-2": { heightMode: "hug" } }}
        renderScreenContent={(screen) => <div data-live-screen={screen.id} />}
        onPick={() => {}}
      />
    );
    await act(async () => root.render(render({ "--accent": "red" })));

    const staticPreview = (id: string) =>
      container.querySelector<HTMLIFrameElement>(
        `iframe[data-screen-static-preview][data-screen-iframe-id="${id}"]`,
      )!;
    await vi.waitFor(() => {
      expect(staticPreview("inline-0")).not.toBeNull();
      expect(staticPreview("inline-2")).not.toBeNull();
    });
    expect(staticPreview("inline-0").srcdoc).toContain(
      "data-agent-native-frame-fit",
    );
    expect(staticPreview("inline-0").srcdoc).toContain(
      "data-agent-native-tweak-bridge",
    );
    expect(staticPreview("inline-2").srcdoc).not.toContain(
      "data-agent-native-frame-fit",
    );

    const post = vi.spyOn(
      staticPreview("inline-0").contentWindow!,
      "postMessage",
    );
    await act(async () => {
      staticPreview("inline-0").dispatchEvent(new Event("load"));
    });
    expect(post).toHaveBeenLastCalledWith(
      { type: "tweak-values", values: { "--accent": "red" } },
      "*",
    );
    await act(async () => root.render(render({ "--accent": "blue" })));
    expect(post).toHaveBeenLastCalledWith(
      { type: "tweak-values", values: { "--accent": "blue" } },
      "*",
    );
  });

  it("keeps an editor for every screen of a board that fits the live pool", async () => {
    const screens = inlineScreens(4);
    const mounts: string[] = [];
    const unmounts: string[] = [];
    const render = (activeId: string) => (
      <MultiScreenCanvas
        screens={screens}
        zoom={45}
        activeId={activeId}
        selectedScreenIds={[activeId]}
        activeTool="move"
        geometryById={Object.fromEntries(
          screens.map((screen, index) => [
            screen.id,
            { x: index * 430, y: 0, width: 390, height: 844 },
          ]),
        )}
        renderScreenContent={(screen) => (
          <TrackedEditor id={screen.id} mounts={mounts} unmounts={unmounts} />
        )}
        onPick={() => {}}
      />
    );

    await act(async () => root.render(render("inline-0")));
    await vi.waitFor(() => {
      expect(liveScreenIds()).toHaveLength(4);
    });
    expect(
      container.querySelector("iframe[data-screen-static-preview]"),
    ).toBeNull();

    await act(async () => root.render(render("inline-1")));
    await act(async () => root.render(render("inline-2")));
    expect(liveScreenIds()).toHaveLength(4);
    expect(unmounts).toEqual([]);
    expect(new Set(mounts)).toEqual(new Set(screens.map((s) => s.id)));
  });

  it("keeps a large board's screens as editors in global interact mode", async () => {
    const screens = inlineScreens(LARGE_BOARD_SCREEN_COUNT);
    const readyById = new Map<string, () => void>();

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={10}
          activeId="inline-1"
          interactMode
          activeTool="move"
          geometryById={Object.fromEntries(
            screens.map((screen, index) => [
              screen.id,
              { x: index * 1500, y: 0, width: 1440, height: 900 },
            ]),
          )}
          renderScreenContent={(screen, _metadata, _geometry, options) => {
            if (options?.onBootReady) {
              readyById.set(screen.id, options.onBootReady);
            }
            return <div data-live-screen={screen.id} />;
          }}
          onPick={() => {}}
        />,
      );
    });

    for (let round = 0; round < LARGE_BOARD_SCREEN_COUNT; round += 1) {
      const pending = [...readyById.values()];
      readyById.clear();
      if (pending.length === 0) break;
      await act(async () => pending.forEach((ready) => ready()));
    }
    await vi.waitFor(() => {
      expect(liveScreenIds()).toHaveLength(OVERVIEW_LIVE_SCREEN_BUDGET);
    });
  });

  it("holds a drill-in on a promoted screen until its editor is ready", async () => {
    const screens = inlineScreens(LARGE_BOARD_SCREEN_COUNT);
    const readyById = new Map<string, () => void>();
    const onLayerMarqueeSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={10}
          activeId="inline-1"
          selectedScreenIds={["inline-0"]}
          activeTool="move"
          geometryById={Object.fromEntries(
            screens.map((screen, index) => [
              screen.id,
              { x: index * 1500, y: 0, width: 1440, height: 900 },
            ]),
          )}
          metadataById={Object.fromEntries(
            screens.map((screen) => [screen.id, { width: 1440, height: 900 }]),
          )}
          renderScreenContent={(screen, _metadata, _geometry, options) => {
            if (options?.onBootReady) {
              readyById.set(screen.id, options.onBootReady);
            }
            return (
              <iframe
                data-live-screen={screen.id}
                data-screen-iframe-id={screen.id}
              />
            );
          }}
          onPick={() => {}}
          onLayerMarqueeSelectionChange={onLayerMarqueeSelectionChange}
        />,
      );
    });

    const editor = container.querySelector<HTMLIFrameElement>(
      'iframe[data-live-screen="inline-0"]',
    );
    expect(editor?.contentWindow).toBeTruthy();
    const requests: string[] = [];
    vi.spyOn(editor!.contentWindow!, "postMessage").mockImplementation(
      (message: unknown) => {
        const data = message as { type?: string; correlationId?: string };
        if (data?.type !== "agent-native:collect-selectable-rects") return;
        requests.push(data.correlationId!);
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selectable-rects-result",
              correlationId: data.correlationId,
              payload: [
                {
                  tagName: "section",
                  sourceId: "inline-0-layer",
                  boundingRect: { x: 0, y: 0, width: 400, height: 400 },
                },
              ],
            },
            source: editor!.contentWindow,
          }),
        );
      },
    );
    const card = container.querySelector<HTMLElement>(
      '[data-frame-id="inline-0"] [data-screen-card]',
    );
    expect(card).not.toBeNull();

    const transform = container
      .querySelector<HTMLElement>("[data-multi-screen-canvas-world]")!
      .style.transform.match(
        /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/,
      )!;
    const [, panX, panY, scale] = transform.map(Number);
    await act(async () => {
      card!.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          clientX: panX + (SURFACE_PADDING + 100) * scale,
          clientY: panY + (SURFACE_PADDING + 100) * scale,
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(requests).toEqual([]);

    await act(async () => readyById.get("inline-0")?.());
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
      expect(onLayerMarqueeSelectionChange).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            screenId: "inline-0",
            info: expect.objectContaining({ sourceId: "inline-0-layer" }),
          }),
        ],
        expect.anything(),
      );
    });
  });

  it("mounts a zoomed-out large board's previews a few per frame without delaying the active editor", async () => {
    const screens = inlineScreens(LARGE_BOARD_SCREEN_COUNT);
    const staticPreviewCount = () =>
      container.querySelectorAll("iframe[data-screen-static-preview]").length;
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const runFrame = () =>
      act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(performance.now()));
      });

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={10}
          activeId="inline-1"
          activeTool="move"
          geometryById={Object.fromEntries(
            screens.map((screen, index) => [
              screen.id,
              { x: index * 1500, y: 0, width: 1440, height: 900 },
            ]),
          )}
          renderScreenContent={(screen) => <div data-live-screen={screen.id} />}
          onPick={() => {}}
        />,
      );
    });

    expect(liveScreenIds()).toEqual(["inline-1"]);
    expect(staticPreviewCount()).toBe(0);
    const counts: number[] = [];
    for (let frame = 0; frame < LARGE_BOARD_SCREEN_COUNT; frame += 1) {
      await runFrame();
      counts.push(staticPreviewCount());
    }
    const settled = counts[counts.length - 1];
    expect(settled).toBeGreaterThan(OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME * 2);
    counts.forEach((count, frame) =>
      expect(count).toBe(
        Math.min(settled, (frame + 1) * OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME),
      ),
    );
  });

  it("keeps demoted editors on zoom-out until their previews are admitted", async () => {
    const screens = inlineScreens(LARGE_BOARD_SCREEN_COUNT);
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const runFrame = () =>
      act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(performance.now()));
      });
    const readyById = new Map<string, () => void>();
    const mounts: string[] = [];
    const unmounts: string[] = [];
    const render = (zoom: number) => (
      <MultiScreenCanvas
        screens={screens}
        zoom={zoom}
        activeId="inline-0"
        activeTool="move"
        geometryById={Object.fromEntries(
          screens.map((screen, index) => [
            screen.id,
            {
              x: (index % 6) * 320,
              y: Math.floor(index / 6) * 220,
              width: 300,
              height: 200,
            },
          ]),
        )}
        renderScreenContent={(screen, _metadata, _geometry, options) => {
          if (options?.onBootReady) {
            readyById.set(screen.id, options.onBootReady);
          }
          return (
            <TrackedEditor id={screen.id} mounts={mounts} unmounts={unmounts} />
          );
        }}
        onPick={() => {}}
      />
    );

    await act(async () => root.render(render(100)));
    for (let round = 0; round < LARGE_BOARD_SCREEN_COUNT; round += 1) {
      const pending = [...readyById.values()];
      readyById.clear();
      await runFrame();
      if (pending.length === 0) break;
      await act(async () => pending.forEach((ready) => ready()));
    }
    const editors = liveScreenIds();
    expect(editors.length).toBeGreaterThan(
      OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME * 2,
    );

    await act(async () => root.render(render(50)));
    expect(liveScreenIds()).toEqual(editors);
    expect(unmounts).toEqual([]);

    const remaining: number[] = [];
    while (frames.size > 0 && remaining.length < LARGE_BOARD_SCREEN_COUNT) {
      await runFrame();
      remaining.push(liveScreenIds().length);
    }
    expect(liveScreenIds()).toEqual(["inline-0"]);
    expect(container.querySelector("[data-screen-placeholder]")).toBeNull();
    remaining.forEach((count, frame) =>
      expect(count).toBeGreaterThanOrEqual(
        editors.length - (frame + 1) * OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME,
      ),
    );
  });

  it("mounts every preview of a small board in its first frame", async () => {
    const screens = inlineScreens(3);

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={10}
          activeTool="move"
          geometryById={Object.fromEntries(
            screens.map((screen, index) => [
              screen.id,
              { x: index * 1500, y: 0, width: 1440, height: 900 },
            ]),
          )}
          onPick={() => {}}
        />,
      );
    });

    expect(
      container.querySelectorAll("iframe[data-screen-static-preview]"),
    ).toHaveLength(3);
    expect(container.querySelector("[data-screen-placeholder]")).toBeNull();
  });
});

function inlineScreens(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `inline-${index}`,
    filename: `inline-${index}.html`,
    content: "<!doctype html><html><body>inline</body></html>",
  }));
}

function TrackedEditor({
  id,
  mounts,
  unmounts,
}: {
  id: string;
  mounts: string[];
  unmounts: string[];
}) {
  useEffect(() => {
    mounts.push(id);
    return () => {
      unmounts.push(id);
    };
  }, [id, mounts, unmounts]);
  return <div data-live-screen={id} />;
}
