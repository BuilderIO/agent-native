import { describe, expect, it } from "vitest";

import { isElementInfoPayload } from "./design-canvas/element-payload";
import {
  getEmbeddedFrameDocumentContent,
  getEmbeddedFrameBackgroundStyle,
  getEmbeddedIframeBackgroundColor,
} from "./design-canvas/embedded-frame";
import {
  getDesignCanvasIframeSandbox,
  liveEditEndpointUrl,
  resolveLiveEditPreviewUrl,
  sanitizeLocalhostSourceSnapshotHtml,
  shouldFetchExternalSourceSnapshot,
} from "./design-canvas/external-preview";

describe("DesignCanvas embedded frame backgrounds", () => {
  it("lets transparentBackground override an embedded frame background", () => {
    expect(
      getEmbeddedIframeBackgroundColor({
        embeddedFrameBackground: "white",
        transparentBackground: true,
      }),
    ).toBe("transparent");
    expect(
      getEmbeddedFrameBackgroundStyle({
        embeddedFrameBackground: "white",
        transparentBackground: true,
      }),
    ).toContain("background:transparent");
  });

  it("uses the embedded frame background when transparency is not requested", () => {
    expect(
      getEmbeddedIframeBackgroundColor({
        embeddedFrameBackground: "hsl(0 0% 10%)",
      }),
    ).toBe("hsl(0 0% 10%)");
    expect(
      getEmbeddedFrameBackgroundStyle({
        embeddedFrameBackground: "hsl(0 0% 10%)",
      }),
    ).toContain("hsl(0 0% 10%)");
  });

  it("preserves embedded frame styles for live document replacement", () => {
    const content = getEmbeddedFrameDocumentContent({
      content:
        '<!DOCTYPE html><html><head></head><body><div data-agent-native-node-id="rect"></div></body></html>',
      embeddedFrameBackground: "hsl(0 0% 10%)",
      contentOffsetX: -100,
      contentOffsetY: -200,
    });

    expect(content).toContain("data-agent-native-frame-background");
    expect(content).toContain("background:hsl(0 0% 10%)");
    expect(content).toContain("data-agent-native-content-offset");
    expect(content).toContain("translate:-100px -200px");
    expect(content).toContain('data-agent-native-node-id="rect"');
  });

  it("scopes the content offset to direct body children so nested board nodes are never double-shifted", () => {
    const content = getEmbeddedFrameDocumentContent({
      content:
        '<!DOCTYPE html><html><head></head><body><div data-agent-native-node-id="parent"><div data-agent-native-node-id="child"></div></div></body></html>',
      contentOffsetX: 65536,
      contentOffsetY: 65536,
    });

    // translate compounds per matched element — a blanket
    // [data-agent-native-node-id] rule would shift the nested child by the
    // surface offset a second time (+65536px), rendering it off-world even
    // with correct parent-relative left/top. The rule must match top-level
    // board children only.
    expect(content).toContain(
      "body > [data-agent-native-node-id]{translate:65536px 65536px;}",
    );
    expect(content).not.toMatch(
      /<style[^>]*data-agent-native-content-offset[^>]*>\[data-agent-native-node-id\]/,
    );
  });
});

describe("DesignCanvas bridge payload validation", () => {
  it("accepts complete element info payloads from the live edit bridge", () => {
    expect(
      isElementInfoPayload({
        tagName: "section",
        selector: "[data-agent-native-node-id='hero']",
        sourceId: "hero",
        classes: ["hero"],
        computedStyles: { color: "rgb(15, 23, 42)" },
        inlineStyles: {},
        boundingRect: { x: 10, y: 20, width: 300, height: 120 },
        isFlexChild: false,
        isFlexContainer: true,
      }),
    ).toBe(true);
  });

  it("rejects partial style-change payloads before they reach inspector state", () => {
    expect(
      isElementInfoPayload({
        tagName: "section",
        selector: "[data-agent-native-node-id='hero']",
        sourceId: "hero",
        classes: ["hero"],
        computedStyles: { width: "320px" },
        isFlexChild: false,
        isFlexContainer: true,
      }),
    ).toBe(false);
  });
});

describe("DesignCanvas live-edit URLs", () => {
  it("removes Vite and React Refresh injections from writable source snapshots", () => {
    const source = sanitizeLocalhostSourceSnapshotHtml(`<!doctype html>
<html><head>
<script type="module" src="/@vite/client"></script>
<script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.__vite_plugin_react_preamble_installed__ = true;
</script>
</head><body>
<script type="module" src="/src/main.tsx"></script>
<script>window.appBoot = true;</script>
</body></html>`);

    expect(source).not.toContain("/@vite/client");
    expect(source).not.toContain("/@react-refresh");
    expect(source).not.toContain("__vite_plugin_react_preamble_installed__");
    expect(source).toContain('src="/src/main.tsx"');
    expect(source).toContain("window.appBoot = true");
  });

  it("fails closed instead of loading a localhost URL without a preview token", () => {
    expect(
      resolveLiveEditPreviewUrl({
        sourceType: "localhost",
        bridgeUrl: "http://127.0.0.1:7331",
        previewToken: undefined,
        previewUrl: "http://localhost:5173/forms",
        bridgeKey: "screen-a",
        registeredBridgeKey: null,
      }),
    ).toBeNull();
  });

  it("hydrates source HTML in parallel whenever an authenticated consumer is present", () => {
    expect(
      shouldFetchExternalSourceSnapshot({
        sourceType: "localhost",
        bridgeUrl: "http://127.0.0.1:7331",
        previewToken: "example-preview-token",
        previewUrl: "http://localhost:5173/forms",
        hasSnapshotConsumer: true,
      }),
    ).toBe(true);
    expect(
      shouldFetchExternalSourceSnapshot({
        sourceType: "localhost",
        bridgeUrl: "http://127.0.0.1:7331",
        previewToken: undefined,
        previewUrl: "http://localhost:5173/forms",
        hasSnapshotConsumer: true,
      }),
    ).toBe(false);
  });

  it("can request the bridge proxy without editor chrome for Interact mode", () => {
    const url = liveEditEndpointUrl(
      "http://127.0.0.1:7331",
      "http://localhost:5173/forms",
      { previewToken: "example-preview-token", includeEditorBridge: false },
    );

    expect(url).toBe(
      "http://127.0.0.1:7331/live-edit?url=http%3A%2F%2Flocalhost%3A5173%2Fforms&previewToken=example-preview-token&bridge=0",
    );
  });

  it("waits for a keyed gesture bridge before loading Interact mode", () => {
    const args = {
      sourceType: "localhost",
      bridgeUrl: "http://127.0.0.1:7331",
      previewToken: "example-preview-token",
      previewUrl: "http://localhost:5173/forms",
      bridgeKey: "pan-only:screen-a",
      registeredBridgeKey: null as string | null,
    };

    expect(resolveLiveEditPreviewUrl(args)).toBeNull();
    expect(
      resolveLiveEditPreviewUrl({
        ...args,
        registeredBridgeKey: "pan-only:screen-a",
      }),
    ).toBe(
      "http://127.0.0.1:7331/live-edit?url=http%3A%2F%2Flocalhost%3A5173%2Fforms&previewToken=example-preview-token&bridgeKey=pan-only%3Ascreen-a",
    );
  });

  it("keys editor bridge URLs so parallel screens cannot race on one global script", () => {
    const url = liveEditEndpointUrl(
      "http://127.0.0.1:7331",
      "http://localhost:5173/forms",
      { previewToken: "example-preview-token", bridgeKey: "1234:screen-a" },
    );

    expect(url).toBe(
      "http://127.0.0.1:7331/live-edit?url=http%3A%2F%2Flocalhost%3A5173%2Fforms&previewToken=example-preview-token&bridgeKey=1234%3Ascreen-a",
    );
  });
});

describe("DesignCanvas iframe sandbox policy", () => {
  it("does not grant same-origin access to read-only inline previews", () => {
    const sandbox = getDesignCanvasIframeSandbox({
      externalPreview: false,
      readOnly: true,
    });

    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("retains same-origin only for URL apps and editable live-DOM workflows", () => {
    expect(
      getDesignCanvasIframeSandbox({
        externalPreview: false,
        readOnly: false,
      }),
    ).toContain("allow-same-origin");
    expect(
      getDesignCanvasIframeSandbox({
        externalPreview: true,
        readOnly: true,
      }),
    ).toContain("allow-same-origin");
  });
});
