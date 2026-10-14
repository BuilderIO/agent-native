// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callActionMock = vi.hoisted(() => vi.fn());
const useActionQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: callActionMock,
  usePinchZoom: () => {},
  useActionQuery: useActionQueryMock,
}));

import { i18nCatalog } from "../../i18n";
import * as externalPreview from "./design-canvas/external-preview";
import { DesignCanvas } from "./DesignCanvas";

// What Edit injects into a markup screen. Interact carries none of it: the page
// runs as it would in a tab, plus the theme bridge and the links bridge.
const EDITOR_ONLY_MARKERS = [
  "data-agent-native-editor-chrome-bridge",
  "data-agent-native-hit-test-bridge",
  "data-agent-native-embedded-wheel-bridge",
  "data-agent-native-zoom-bridge",
  "data-agent-native-nav-bridge",
  "data-agent-native-tweak-bridge",
  "data-agent-native-motion-preview-bridge",
  "data-agent-native-shader-fill-preview-bridge",
  "data-agent-native-shader-runtime",
  "data-agent-native-source-provenance",
  "data-agent-native-editor-theme",
  "data-agent-native-content-size-bridge",
];

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Home</title></head><body><h1>Home</h1><a href="/pricing">Pricing</a></body></html>`;

let container: HTMLDivElement;
let root: Root;
const queryClient = new QueryClient();

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
  const render = root.render.bind(root);
  root.render = (children) =>
    render(
      <QueryClientProvider client={queryClient}>
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          {children}
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    );
  queryClient.clear();
  callActionMock.mockReset();
  useActionQueryMock.mockReset();
  useActionQueryMock.mockReturnValue({ data: undefined });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function canvas(props: {
  interactMode: boolean;
  content?: string;
  sourceType?: "inline" | "localhost";
  embedded?: boolean;
}) {
  const localhost = props.sourceType === "localhost";
  return (
    <DesignCanvas
      content={props.content ?? PAGE}
      contentKey="screen-home"
      screenId="screen-home"
      sourceType={props.sourceType}
      bridgeUrl={localhost ? "http://127.0.0.1:7331" : undefined}
      connectionId={localhost ? "localhost_connection" : undefined}
      previewToken={localhost ? "preview-token" : undefined}
      liveEditCapability={localhost ? "live-edit-capability" : undefined}
      registerRuntimeBridge
      embeddedFrame={
        props.embedded
          ? {
              viewportWidth: 390,
              viewportHeight: 844,
              displayWidth: 390,
              displayHeight: 844,
            }
          : undefined
      }
      zoom={100}
      deviceFrame="none"
      editMode={!props.interactMode}
      interactMode={props.interactMode}
      onElementSelect={() => {}}
      onElementHover={() => {}}
      tweakValues={{}}
    />
  );
}

function previewIframe(): HTMLIFrameElement | null {
  return container.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
}

function scriptMarkers(html: string): string[] {
  return html.match(/<script\b[^>]*>/gi) ?? [];
}

describe("DesignCanvas in Interact: a markup screen", () => {
  it("carries the theme bridge and the links bridge, and no editor bridge", async () => {
    await act(async () => root.render(canvas({ interactMode: true })));

    const srcdoc = previewIframe()?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<h1>Home</h1>");
    expect(srcdoc).toContain("data-agent-native-preview-theme-bridge");
    expect(srcdoc).toContain("data-agent-native-interact-links-bridge");
    for (const marker of EDITOR_ONLY_MARKERS) {
      expect(srcdoc, marker).not.toContain(marker);
    }
    expect(
      scriptMarkers(srcdoc).filter((tag) => tag.includes("-bridge")),
    ).toEqual([
      "<script data-agent-native-preview-theme-bridge>",
      "<script data-agent-native-interact-links-bridge>",
    ]);
  });

  it("carries no editor bridge in an embedded frame either, where the overview hosts it", async () => {
    await act(async () =>
      root.render(canvas({ interactMode: true, embedded: true })),
    );

    const srcdoc = previewIframe()?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("data-agent-native-interact-links-bridge");
    for (const marker of EDITOR_ONLY_MARKERS) {
      expect(srcdoc, marker).not.toContain(marker);
    }
  });

  it("leaves Edit with every editor bridge, including the ones Interact drops", async () => {
    await act(async () => root.render(canvas({ interactMode: false })));

    const srcdoc = previewIframe()?.getAttribute("srcdoc") ?? "";
    for (const marker of EDITOR_ONLY_MARKERS.filter(
      (marker) => marker !== "data-agent-native-content-size-bridge",
    )) {
      expect(srcdoc, marker).toContain(marker);
    }
    expect(srcdoc).toContain("data-agent-native-preview-theme-bridge");
  });

  it("loads a fresh document when the mode changes, so no editor bridge outlives Edit", async () => {
    await act(async () => root.render(canvas({ interactMode: false })));
    const edit = previewIframe();
    expect(edit?.getAttribute("srcdoc")).toContain(
      "data-agent-native-editor-chrome-bridge",
    );

    await act(async () => root.render(canvas({ interactMode: true })));
    const interact = previewIframe();
    expect(interact).not.toBe(edit);
    expect(interact?.getAttribute("srcdoc")).not.toContain(
      "data-agent-native-editor-chrome-bridge",
    );

    await act(async () => root.render(canvas({ interactMode: false })));
    expect(previewIframe()?.getAttribute("srcdoc")).toContain(
      "data-agent-native-editor-chrome-bridge",
    );
  });

  it("builds Edit's document for Edit when the canvas first opened in Interact", async () => {
    await act(async () => root.render(canvas({ interactMode: true })));
    await act(async () => root.render(canvas({ interactMode: false })));

    const srcdoc = previewIframe()?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toMatch(/var interactionMode = false;/);
    expect(srcdoc).toMatch(/var editingSafetyEnabled = true;/);
  });
});

describe("DesignCanvas when the mode swaps a markup document", () => {
  const replacedFrame = () =>
    container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-replaced]",
    );
  const dispatchEvent = HTMLIFrameElement.prototype.dispatchEvent;

  // The test decides when a frame has loaded, so the document's own load
  // events are held back.
  beforeEach(() => {
    vi.spyOn(HTMLIFrameElement.prototype, "dispatchEvent").mockImplementation(
      function (this: HTMLIFrameElement, event: Event) {
        return event.type === "load" || dispatchEvent.call(this, event);
      },
    );
  });

  it("keeps the document being replaced underneath, untouched, until the new one has loaded", async () => {
    await act(async () => root.render(canvas({ interactMode: false })));
    const edit = previewIframe()!;
    const editDocument = edit.getAttribute("srcdoc");

    await act(async () => root.render(canvas({ interactMode: true })));
    const interact = previewIframe()!;

    expect(interact).not.toBe(edit);
    expect(replacedFrame()).toBe(edit);
    expect(replacedFrame()?.getAttribute("srcdoc")).toBe(editDocument);
    expect(
      replacedFrame()!.compareDocumentPosition(interact) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(replacedFrame()?.hasAttribute("data-design-preview-iframe")).toBe(
      false,
    );
    expect(replacedFrame()?.getAttribute("aria-hidden")).toBe("true");

    vi.mocked(HTMLIFrameElement.prototype.dispatchEvent).mockRestore();
    await act(async () => {
      interact.dispatchEvent(new Event("load"));
    });
    await vi.waitFor(() => expect(replacedFrame()).toBeNull());
    expect(previewIframe()).toBe(interact);
  });

  it("lets go of the replaced document when the new one never reports loading", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => root.render(canvas({ interactMode: false })));
      await act(async () => root.render(canvas({ interactMode: true })));
      expect(replacedFrame()).not.toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(2100);
      });

      expect(replacedFrame()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps nothing underneath when the content changes and the mode does not", async () => {
    await act(async () =>
      root.render(canvas({ interactMode: false, content: PAGE })),
    );
    await act(async () =>
      root.render(
        canvas({
          interactMode: false,
          content: PAGE.replace("Home", "Home, edited"),
        }),
      ),
    );

    expect(replacedFrame()).toBeNull();
  });
});

describe("DesignCanvas in Interact: a screen served from a URL", () => {
  it("loads a running app straight from its address, with no bridge registered for it", async () => {
    vi.spyOn(
      externalPreview,
      "getLocalNetworkAccessPermissionState",
    ).mockResolvedValue("granted");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ bridgeInstanceId: "bridge-instance" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () =>
      root.render(
        canvas({
          interactMode: true,
          sourceType: "localhost",
          content: "http://localhost:5173/account",
        }),
      ),
    );

    const iframe = previewIframe();
    expect(iframe?.getAttribute("src")).toBe("http://localhost:5173/account");
    expect(iframe?.hasAttribute("srcdoc")).toBe(false);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/live-edit-bridge"),
      ),
    ).toEqual([]);
  });

  it("routes a running app through the editor bridge in Edit, which is what Interact skips", async () => {
    vi.spyOn(
      externalPreview,
      "getLocalNetworkAccessPermissionState",
    ).mockResolvedValue("granted");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ bridgeInstanceId: "bridge-instance" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () =>
      root.render(
        canvas({
          interactMode: false,
          sourceType: "localhost",
          content: "http://localhost:5173/account",
        }),
      ),
    );

    await vi.waitFor(() => {
      expect(previewIframe()?.getAttribute("src")).toContain("/live-edit?");
    });
  });

  it("goes back to the raw address when Interact opens on a screen Edit had bridged", async () => {
    vi.spyOn(
      externalPreview,
      "getLocalNetworkAccessPermissionState",
    ).mockResolvedValue("granted");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ bridgeInstanceId: "bridge-instance" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const localhost = (interactMode: boolean) =>
      canvas({
        interactMode,
        sourceType: "localhost",
        content: "http://localhost:5173/account",
      });

    await act(async () => root.render(localhost(false)));
    await vi.waitFor(() => {
      expect(previewIframe()?.getAttribute("src")).toContain("/live-edit?");
    });

    await act(async () => root.render(localhost(true)));
    await vi.waitFor(() => {
      expect(previewIframe()?.getAttribute("src")).toBe(
        "http://localhost:5173/account",
      );
    });
  });

  it("does not hand the editor bridge to a page served from another origin", async () => {
    const url = "http://127.0.0.1:1/app";
    const installs = async (interactMode: boolean) => {
      await act(async () =>
        root.render(canvas({ interactMode, content: url })),
      );
      const iframe = previewIframe();
      const target = iframe?.contentWindow;
      expect(target).toBeTruthy();
      const post = vi.spyOn(target!, "postMessage");
      await act(async () => {
        iframe!.dispatchEvent(new Event("load"));
      });
      return post.mock.calls.filter(
        ([message]) =>
          (message as { type?: string } | null)?.type ===
          "agentNative.installBridge",
      );
    };

    expect(await installs(false)).toHaveLength(1);
    expect(await installs(true)).toEqual([]);
  });
});
