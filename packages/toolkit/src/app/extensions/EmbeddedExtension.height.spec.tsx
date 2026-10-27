// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbeddedExtension } from "./EmbeddedExtension.js";

vi.mock("./extension-links.js", () => ({
  extensionFrameNameWithLinkNonce: (nonce: string) => `frame-${nonce}`,
  // No nonce leaves the frame without a src, so nothing loads.
  useExternalExtensionLinks: () => null,
}));

describe("EmbeddedExtension height reports", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "extension-1",
          name: "Status",
          updatedAt: "1",
        }),
      })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("sizes the iframe to each reported height and passes it on", async () => {
    const onHeightChange = vi.fn();
    const onReady = vi.fn();
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <EmbeddedExtension
            extensionId="extension-1"
            slotId="dashboard-panel-status"
            initialHeight={180}
            onReady={onReady}
            onHeightChange={onHeightChange}
          />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.querySelector("iframe")).not.toBeNull();
    });

    const iframe = container.querySelector("iframe");
    expect(iframe?.style.height).toBe("180px");

    const report = (data: unknown) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe?.contentWindow,
            data,
          }),
        );
      });

    await report({ type: "agent-native-extension-resize", height: 63.4 });
    expect(iframe?.style.height).toBe("64px");
    expect(onHeightChange).toHaveBeenLastCalledWith(64);
    expect(onReady).toHaveBeenCalledTimes(1);

    await report({ type: "agent-native-extension-resize", height: 0 });
    expect(iframe?.style.height).toBe("64px");
    expect(onHeightChange).toHaveBeenCalledTimes(1);

    await report({ type: "agent-native-extension-resize", height: 612 });
    expect(iframe?.style.height).toBe("612px");
    expect(onHeightChange).toHaveBeenLastCalledWith(612);
  });
});
