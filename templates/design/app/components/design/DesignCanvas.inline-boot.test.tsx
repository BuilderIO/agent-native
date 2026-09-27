// @vitest-environment happy-dom

import { SESSION_REPLAY_IFRAME_PROBE } from "@agent-native/core/client/host";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DesignCanvas inline boot", () => {
  it("reports an inline srcdoc document booted once it loads", async () => {
    const onBootReady = vi.fn();
    await act(async () => {
      root.render(
        <DesignCanvas
          content="<!doctype html><html><body><h1>Inline</h1></body></html>"
          contentKey="screen-inline"
          screenId="screen-inline"
          onBootReady={onBootReady}
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });

    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    expect(iframe?.getAttribute("srcdoc")).toContain("Inline");

    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
    });
    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
    });
    expect(onBootReady).toHaveBeenCalledTimes(1);
  });

  it("reports an inline document booted when its editor bridge is ready, before load", async () => {
    const dispatchEvent = HTMLIFrameElement.prototype.dispatchEvent;
    vi.spyOn(HTMLIFrameElement.prototype, "dispatchEvent").mockImplementation(
      function (this: HTMLIFrameElement, event: Event) {
        return event.type === "load" || dispatchEvent.call(this, event);
      },
    );
    const onBootReady = vi.fn();
    await act(async () => {
      root.render(
        <DesignCanvas
          content="<!doctype html><html><body><h1>Inline</h1></body></html>"
          contentKey="screen-inline"
          screenId="screen-inline"
          onBootReady={onBootReady}
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });
    const iframeWindow = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )?.contentWindow;
    expect(iframeWindow).toBeTruthy();
    const post = async (type: string) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type },
            origin: "null",
            source: iframeWindow,
          }),
        );
      });

    expect(onBootReady).not.toHaveBeenCalled();
    await post(SESSION_REPLAY_IFRAME_PROBE);
    expect(onBootReady).not.toHaveBeenCalled();
    await post("agent-native:editor-chrome-ready");
    expect(onBootReady).toHaveBeenCalledTimes(1);
  });
});
