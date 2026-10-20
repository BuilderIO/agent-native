// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OVERVIEW_FRAME_WIDTH } from "../app/components/design/multi-screen/overview-layout";
import type { MultiScreenCanvasGroupedProps } from "../app/components/design/multi-screen/types";
import { DEVICE_FRAME_VIEWPORTS } from "../app/components/design/types";
import { getOverviewZoomScale } from "../app/pages/design-editor/overview-camera";
import { readRuntimeZoomSnapshot } from "./_runtime-budget-zoom-snapshot";
import { measureRuntimeZoom } from "./runtime-budget-zoom";

const config = {
  defaultFrameWidth: OVERVIEW_FRAME_WIDTH,
  defaultSourceWidth: 1280,
  deviceWidths: Object.fromEntries(
    Object.entries(DEVICE_FRAME_VIEWPORTS).map(([name, size]) => [
      name,
      size.width,
    ]),
  ),
};
const readSnapshot = () =>
  readRuntimeZoomSnapshot({
    ...config,
    readout: document.querySelector("button"),
  });
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  roots.forEach((root) => flushSync(() => root.unmount()));
  roots.length = 0;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function fixture() {
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      a: number;
      constructor(transform: string) {
        this.a = Number(/scale\(([^)]+)\)/.exec(transform)![1]);
      }
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function Canvas(props: MultiScreenCanvasGroupedProps) {
    return createElement(
      "div",
      null,
      createElement("div", {
        "data-multi-screen-canvas-world": "",
        style: { transform: `translate(5px, 10px) scale(${props.zoom / 100})` },
      }),
      createElement("button", null, "60%"),
    );
  }
  const props = {
    screens: [
      { id: "a", filename: "a.html", content: "", width: 1280 },
      { id: "b", filename: "b.html", content: "", width: 768 },
    ],
    activeId: "a",
    onPick: () => {},
    zoom: 60 / 1.125,
    previewDeviceFrame: "none",
    geometry: { geometryById: { a: { width: 1440 }, b: { width: 460.8 } } },
  } as MultiScreenCanvasGroupedProps;
  let canvas = createElement(Canvas, props);
  let sibling = 0;
  const renderParent = () =>
    flushSync(() =>
      root.render(
        createElement(
          "section",
          null,
          canvas,
          createElement("span", null, sibling),
        ),
      ),
    );
  return Object.assign(
    (update: Partial<MultiScreenCanvasGroupedProps> = {}) => {
      canvas = createElement(Canvas, { ...props, ...update });
      renderParent();
    },
    {
      rerenderSibling: () => {
        sibling++;
        renderParent();
      },
    },
  );
}

describe("atomic runtime zoom snapshot", () => {
  it("reads committed camera/basis across alternating real React commits while the route lags", () => {
    const render = fixture();
    window.history.replaceState(null, "", "?zoom=2.33");
    render();
    const before = readSnapshot()!;
    expect(before.basis.scale).toBe(
      getOverviewZoomScale({ frameWidth: 1440, sourceWidth: 1280 }),
    );
    expect(measureRuntimeZoom(before, 60).failedChecks).toEqual(["route"]);
    window.history.replaceState(null, "", "?zoom=60");
    for (let i = 0; i < 4; i++) {
      render({ activeId: "b", zoom: 100 + i });
      const changed = readSnapshot()!;
      expect(changed.sampleRevision).toBeGreaterThan(before.sampleRevision);
      expect(changed.basis.screenId).toBe("b");
      expect(changed.basis.scale).toBeCloseTo(0.6);
      expect(changed.camera.scale).toBeCloseTo(100 + i);
      expect(changed.committedCanvasScale).toBe(100 + i);
    }
  });

  it("keeps the committed basis readable when ancestors update around a bailed-out canvas", () => {
    const render = fixture();
    render();
    const before = readSnapshot()!;
    for (let i = 0; i < 4; i++) {
      render.rerenderSibling();
      const after = readSnapshot()!;
      expect(after).not.toBeNull();
      expect(after.renderRevision).toBe(before.renderRevision);
      expect(after.basis.scale).toBe(before.basis.scale);
    }
  });

  it("detects a DOM camera that has not applied the committed request", () => {
    fixture()();
    window.history.replaceState(null, "", "?zoom=60");
    document.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    )!.style.transform = "scale(0.02)";
    expect(measureRuntimeZoom(readSnapshot(), 60).failedChecks).toEqual([
      "camera",
      "committedCamera",
    ]);
  });

  it("rejects a disconnected stale fiber even when its return pointer reaches the current root", () => {
    fixture()();
    const world = document.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    )!;
    const key = Object.keys(world).find((key) =>
      key.startsWith("__reactFiber$"),
    )!;
    const host = (world as unknown as Record<string, object>)[key]!;
    Object.defineProperty(world, key, {
      value: { ...host, alternate: null },
      configurable: true,
    });
    expect(readSnapshot()).toBeNull();
  });

  it("measures board-only and device normalization without route-derived scale", () => {
    const render = fixture();
    render({ screens: [], activeId: null, zoom: 60 });
    expect(readSnapshot()!.basis.scale).toBe(1);
    render({ previewDeviceFrame: "mobile" });
    expect(readSnapshot()!.basis.scale).toBe(
      1440 / DEVICE_FRAME_VIEWPORTS.mobile.width,
    );
    render({
      geometry: {},
      screens: [{ id: "a", filename: "a.html", content: "" }],
    });
    expect(readSnapshot()!.basis.scale).toBe(
      getOverviewZoomScale({ frameWidth: undefined, sourceWidth: undefined }),
    );
  });

  it("samples the exact toolbar element selected by the interaction locator", () => {
    fixture()();
    const selected = document.querySelector("button")!;
    const hidden = document.createElement("button");
    hidden.hidden = true;
    hidden.textContent = "8%";
    document.body.prepend(hidden);
    expect(
      readRuntimeZoomSnapshot({ ...config, readout: selected })!.label,
    ).toBe("60%");
    selected.remove();
    expect(
      readRuntimeZoomSnapshot({ ...config, readout: selected })!.label,
    ).toBeNull();
  });

  it.each([0, -1, Number.NaN])(
    "matches production dimension fallback for %s",
    (width) => {
      const render = fixture();
      render({
        screens: [{ id: "a", filename: "a.html", content: "", width }],
      });
      expect(readSnapshot()!.basis.scale).toBe(
        getOverviewZoomScale({ frameWidth: 1440, sourceWidth: width }),
      );
      render({ geometry: { geometryById: { a: { width } } } });
      expect(readSnapshot()!.basis.scale).toBe(
        getOverviewZoomScale({ frameWidth: width, sourceWidth: 1280 }),
      );
    },
  );

  it("waits for an effective active screen instead of guessing the editor's default file", () => {
    const render = fixture();
    render({ activeId: null });
    expect(readSnapshot()).toBeNull();
    render({ activeId: "removed-screen" });
    expect(readSnapshot()).toBeNull();
    render({ activeId: "styles.css" });
    expect(readSnapshot()).toBeNull();
    render({ activeId: "b", zoom: 100 });
    expect(readSnapshot()!.basis.screenId).toBe("b");
    expect(readSnapshot()!.basis.scale).toBeCloseTo(0.6);
    render({ activeId: "board", board: { boardFileId: "board" } });
    expect(readSnapshot()!.basis.screenId).toBe("a");
  });

  it("fails loudly when the React measurement contract is unavailable", () => {
    document.body.innerHTML =
      '<div data-multi-screen-canvas-world style="transform:scale(1)"></div>';
    expect(() => readSnapshot()).toThrow("requires React host fibers");
  });
});
