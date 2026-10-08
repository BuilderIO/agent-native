// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTENT_SIZE_REPORT_MESSAGE_TYPE } from "./design-canvas/content-size-report";
import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("frame hit-testing uses rendered (content-fit) geometry", () => {
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
    rectSpy.mockRestore();
    container.remove();
  });

  it("does not select a screen via a marquee that only encloses its stale, pre-measurement geometry", async () => {
    const onSelectionChange = vi.fn();
    const onPrimaryContentHeightChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "a",
              filename: "a.html",
              content: "<!doctype html><html><body></body></html>",
            },
            {
              id: "b",
              filename: "b.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          geometryById={{
            a: { x: 0, y: 0, width: 400, height: 200 },
            b: { x: 600, y: 0, width: 400, height: 100 },
          }}
          onPick={() => {}}
          onSelectionChange={onSelectionChange}
          onPrimaryContentHeightChange={onPrimaryContentHeightChange}
        />,
      );
    });

    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();

    const iframeB = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="b"]',
    );
    expect(iframeB).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: CONTENT_SIZE_REPORT_MESSAGE_TYPE,
            height: 950,
            width: 400,
            viewportHeight: 950,
          },
          source: iframeB!.contentWindow as unknown as Window,
        }),
      );
    });

    const worldLayer = surface!.firstElementChild as HTMLElement;
    const transformMatch = worldLayer.style.transform.match(
      /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/,
    );
    expect(transformMatch).not.toBeNull();
    const [, panXStr, panYStr, scaleStr] = transformMatch!;
    const panX = Number.parseFloat(panXStr);
    const panY = Number.parseFloat(panYStr);
    const scale = Number.parseFloat(scaleStr);
    const clientPointForCanvas = (canvasX: number, canvasY: number) => ({
      clientX: panX + (SURFACE_PADDING + canvasX) * scale,
      clientY: panY + (SURFACE_PADDING + canvasY) * scale,
    });

    const start = clientPointForCanvas(590, -40);
    const end = clientPointForCanvas(1010, 150);

    const dispatch = (
      target: EventTarget,
      type: "mousedown" | "mousemove" | "mouseup",
      clientX: number,
      clientY: number,
    ) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === "mouseup" ? 0 : 1,
          clientX,
          clientY,
        }),
      );

    await act(async () => {
      dispatch(surface!, "mousedown", start.clientX, start.clientY);
      dispatch(window, "mousemove", end.clientX, end.clientY);
      dispatch(window, "mouseup", end.clientX, end.clientY);
    });

    expect(onSelectionChange).not.toHaveBeenCalledWith(["b"]);
    expect(onPrimaryContentHeightChange).toHaveBeenCalledWith("b", 950);
  });

  it("preserves URL origin across fallback previews without changing inline isolation", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "remote-settings",
              filename: "settings.html",
              content: "https://preview.builderio.xyz/settings",
              sourceType: "fusion",
              breakpointWidths: [390],
            },
            {
              id: "remote-library",
              filename: "library.html",
              content: "https://preview.builderio.xyz/library",
              sourceType: "fusion",
            },
            {
              id: "localhost-settings",
              filename: "localhost-settings.html",
              content: "http://localhost:8081/settings",
              sourceType: "localhost",
            },
            {
              id: "same-origin",
              filename: "editor-owned.html",
              content: `${window.location.origin}/editor-owned`,
              sourceType: "localhost",
            },
            {
              id: "hostile-fusion",
              filename: "fusion.attacker.html",
              content: "https://fusion.attacker.example/landing",
            },
            {
              id: "inline",
              filename: "inline.html",
              content: "<!doctype html><html><body>Inline</body></html>",
              breakpointWidths: [390],
            },
          ]}
          zoom={100}
          activeTool="move"
          readOnly
          selectedScreenIds={[
            "remote-settings",
            "remote-library",
            "localhost-settings",
            "same-origin",
            "hostile-fusion",
            "inline",
          ]}
          geometryById={{
            "remote-settings": { x: 0, y: 0, width: 400, height: 300 },
            "remote-library": { x: 500, y: 0, width: 400, height: 300 },
            "localhost-settings": { x: 1000, y: 0, width: 400, height: 300 },
            "same-origin": { x: 0, y: 400, width: 400, height: 300 },
            "hostile-fusion": { x: 500, y: 400, width: 400, height: 300 },
            inline: { x: 1000, y: 0, width: 400, height: 300 },
          }}
          onPick={() => {}}
        />,
      );
    });

    const primaryFrames = Array.from(
      container.querySelectorAll<HTMLIFrameElement>(
        "iframe[data-screen-iframe-id]",
      ),
    );
    const primarySandboxById = new Map(
      primaryFrames.map((iframe) => [
        iframe.dataset.screenIframeId,
        iframe.getAttribute("sandbox"),
      ]),
    );
    expect(primarySandboxById.get("remote-settings")).toContain(
      "allow-same-origin",
    );
    expect(primarySandboxById.get("remote-library")).toContain(
      "allow-same-origin",
    );
    expect(primarySandboxById.get("localhost-settings")).not.toContain(
      "allow-same-origin",
    );
    expect(primarySandboxById.get("same-origin")).not.toContain(
      "allow-same-origin",
    );
    expect(primarySandboxById.get("hostile-fusion")).not.toContain(
      "allow-same-origin",
    );
    expect(primarySandboxById.get("inline")).not.toContain("allow-same-origin");

    const breakpointFrames = Array.from(
      container.querySelectorAll<HTMLIFrameElement>(
        "[data-breakpoint-frame] iframe[data-screen-iframe-id]",
      ),
    );
    expect(breakpointFrames).toHaveLength(2);
    expect(
      breakpointFrames
        .find((iframe) =>
          iframe.dataset.screenIframeId?.startsWith("remote-settings"),
        )
        ?.getAttribute("sandbox"),
    ).toContain("allow-same-origin");
    expect(
      breakpointFrames
        .find((iframe) => iframe.dataset.screenIframeId?.startsWith("inline"))
        ?.getAttribute("sandbox"),
    ).not.toContain("allow-same-origin");
  });
});
