// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const approvals = vi.hoisted(() => [] as readonly string[]);
const connectWorker = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./use-native-shader-approvals", () => ({
  useNativeShaderApprovals: () => ({
    syncFrame: () => undefined,
    approvedDefinitionHashes: approvals,
  }),
}));
vi.mock("./design-canvas/native-public-worker-preview", () => ({
  prepareNativePublicWorkerPreviewDocument: (html: string) => ({
    html: `${html}<meta name="worker-preview">`,
    nonce: "worker-preview-nonce",
  }),
  connectNativePublicWorkerPreview: connectWorker,
}));
vi.mock("./design-canvas/native-public-asset-preview", () => ({
  prepareNativePublicAssetPreviewDocument: (html: string) => ({
    html: `${html}<meta name="asset-preview">`,
    nonce: "asset-preview-nonce",
    urls: [],
  }),
  connectNativePublicAssetPreview: () => () => undefined,
}));

import { DesignCanvas } from "./DesignCanvas";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DesignCanvas public worker preview lifecycle", () => {
  it("keeps the primary worker connection when only the replaced frame retires", async () => {
    const dispatchEvent = HTMLIFrameElement.prototype.dispatchEvent;
    const dispatch = vi
      .spyOn(HTMLIFrameElement.prototype, "dispatchEvent")
      .mockImplementation(function (this: HTMLIFrameElement, event: Event) {
        return event.type === "load" || dispatchEvent.call(this, event);
      });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const cleanups = new Map<HTMLIFrameElement, ReturnType<typeof vi.fn>[]>();
    connectWorker.mockImplementation((frame: HTMLIFrameElement) => {
      const cleanup = vi.fn();
      cleanups.set(frame, [...(cleanups.get(frame) ?? []), cleanup]);
      return cleanup;
    });
    const render = (interactMode: boolean) =>
      root.render(
        <DesignCanvas
          content="<!doctype html><html><body><p>Preview</p></body></html>"
          contentKey={`public-worker-lifecycle-${interactMode ? "interact" : "edit"}`}
          screenId="screen"
          zoom={100}
          deviceFrame="none"
          readOnly
          editMode={!interactMode}
          interactMode={interactMode}
          registerRuntimeBridge={false}
          onElementSelect={() => undefined}
          onElementHover={() => undefined}
          tweakValues={{}}
        />,
      );

    try {
      await act(async () => render(false));
      await act(async () => render(true));
      const primary = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const replaced = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-replaced]",
      );
      expect(primary).not.toBeNull();
      expect(replaced).not.toBeNull();
      expect(primary?.getAttribute("srcdoc")).toContain("worker-preview");
      expect(primary?.getAttribute("srcdoc")).toContain("asset-preview");
      const primaryConnections = cleanups.get(primary!) ?? [];
      expect(primaryConnections.length).toBeGreaterThan(0);
      const primarySrcdoc = primary!.srcdoc;
      const primaryCleanupCount = primaryConnections.reduce(
        (count, cleanup) => count + cleanup.mock.calls.length,
        0,
      );

      dispatch.mockRestore();
      await act(async () => {
        primary!.dispatchEvent(new Event("load"));
      });
      await vi.waitFor(() =>
        expect(
          container.querySelector("iframe[data-design-preview-replaced]"),
        ).toBeNull(),
      );

      expect(primary!.srcdoc).toBe(primarySrcdoc);
      expect(cleanups.get(primary!)).toEqual(primaryConnections);
      expect(
        primaryConnections.reduce(
          (count, cleanup) => count + cleanup.mock.calls.length,
          0,
        ),
      ).toBe(primaryCleanupCount);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      connectWorker.mockReset();
    }
  });
});
