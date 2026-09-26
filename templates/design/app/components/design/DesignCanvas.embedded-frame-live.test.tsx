// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { localRuntimeUrls } from "./design-canvas/local-runtime";
import { DesignCanvas } from "./DesignCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DesignCanvas live embedded-frame offset", () => {
  it.each(["null", "security-error"] as const)(
    "does not steal cross-origin frame focus on canvas pointer entry when contentDocument is %s",
    async (contentDocumentResult) => {
      const container = document.createElement("div");
      const focusedFrame = document.createElement("iframe");
      document.body.append(container, focusedFrame);
      const root = createRoot(container);

      Object.defineProperty(focusedFrame, "contentDocument", {
        configurable: true,
        get: () => {
          if (contentDocumentResult === "null") return null;
          throw new DOMException(
            "Blocked a frame with a different origin",
            "SecurityError",
          );
        },
      });
      try {
        await act(async () =>
          root.render(
            <DesignCanvas
              content="<!doctype html><html><body></body></html>"
              contentKey="cross-origin-frame-initial-focus"
              screenId="board-file"
              zoom={100}
              deviceFrame="none"
              interactMode={false}
              editMode
              boardSurface
              registerRuntimeBridge={false}
              embeddedFrame={{
                viewportWidth: 800,
                viewportHeight: 600,
                displayWidth: 800,
                displayHeight: 600,
                fluid: true,
              }}
              onElementSelect={() => {}}
              onElementHover={() => {}}
              tweakValues={{}}
            />,
          ),
        );

        const scrollSurface =
          container.querySelector<HTMLElement>('[tabindex="-1"]');
        expect(scrollSurface).not.toBeNull();
        focusedFrame.focus();
        expect(document.activeElement).toBe(focusedFrame);

        await act(async () =>
          scrollSurface!.dispatchEvent(
            new MouseEvent("mouseover", {
              bubbles: true,
              relatedTarget: document.body,
            }),
          ),
        );
        expect(document.activeElement).toBe(focusedFrame);
      } finally {
        await act(async () => root.unmount());
        container.remove();
        focusedFrame.remove();
      }
    },
  );

  it("restores canvas focus after a URL-backed live iframe loads", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () =>
        root.render(
          <DesignCanvas
            content="http://localhost:3102/library"
            contentKey="live-url-frame-focus"
            sourceType="localhost"
            screenId="library"
            zoom={100}
            deviceFrame="none"
            interactMode={false}
            editMode
            registerRuntimeBridge={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />,
        ),
      );

      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const scrollSurface =
        container.querySelector<HTMLElement>('[tabindex="-1"]');
      expect(iframe?.getAttribute("src")).toBe("http://localhost:3102/library");
      expect(scrollSurface).not.toBeNull();

      iframe!.focus();
      expect(document.activeElement).toBe(iframe);
      await act(async () => iframe!.dispatchEvent(new Event("load")));

      expect(document.activeElement).toBe(scrollSurface);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("preserves focus inside a cross-origin live iframe after load", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () =>
        root.render(
          <DesignCanvas
            content="https://clips.example/library"
            contentKey="cross-origin-live-frame-load-focus"
            sourceType="localhost"
            screenId="library"
            zoom={100}
            deviceFrame="none"
            interactMode={false}
            editMode
            registerRuntimeBridge={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />,
        ),
      );

      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe).not.toBeNull();
      Object.defineProperty(iframe, "contentDocument", {
        configurable: true,
        get: () => {
          throw new DOMException(
            "Blocked a frame with a different origin",
            "SecurityError",
          );
        },
      });
      iframe!.focus();
      expect(document.activeElement).toBe(iframe);

      await act(async () => iframe!.dispatchEvent(new Event("load")));

      expect(document.activeElement).toBe(iframe);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("preserves toolbar focus when a delayed URL-backed iframe loads", async () => {
    const container = document.createElement("div");
    const toolbarButton = document.createElement("button");
    document.body.append(container, toolbarButton);
    const root = createRoot(container);

    try {
      await act(async () =>
        root.render(
          <DesignCanvas
            content="http://localhost:3102/library"
            contentKey="live-url-frame-delayed-focus"
            sourceType="localhost"
            screenId="library"
            zoom={100}
            deviceFrame="none"
            interactMode={false}
            editMode
            registerRuntimeBridge={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />,
        ),
      );

      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe).not.toBeNull();

      toolbarButton.focus();
      expect(document.activeElement).toBe(toolbarButton);
      await act(async () => iframe!.dispatchEvent(new Event("load")));

      expect(document.activeElement).toBe(toolbarButton);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      toolbarButton.remove();
    }
  });

  it("preserves canvas focus and never steals focus from editable preview frames", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onTextEditingStateChange = vi.fn();
    let siblingIframe: HTMLIFrameElement | null = null;

    try {
      await act(async () =>
        root.render(
          <DesignCanvas
            content="<!doctype html><html><body></body></html>"
            contentKey="board-text-edit-focus"
            screenId="board-file"
            zoom={100}
            deviceFrame="none"
            interactMode={false}
            editMode
            boardSurface
            registerRuntimeBridge={false}
            embeddedFrame={{
              viewportWidth: 800,
              viewportHeight: 600,
              displayWidth: 800,
              displayHeight: 600,
              fluid: true,
            }}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            onTextEditingStateChange={onTextEditingStateChange}
            tweakValues={{}}
          />,
        ),
      );

      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const scrollSurface =
        container.querySelector<HTMLElement>('[tabindex="-1"]');
      expect(iframe?.contentWindow).toBeTruthy();
      expect(scrollSurface).not.toBeNull();
      expect(document.activeElement).toBe(scrollSurface);

      const enterCanvas = async () =>
        act(async () =>
          scrollSurface!.dispatchEvent(
            new MouseEvent("mouseover", {
              bubbles: true,
              relatedTarget: document.body,
            }),
          ),
        );

      await enterCanvas();
      expect(document.activeElement).toBe(scrollSurface);

      const ownDocument = iframe!.contentDocument!;
      const ownEditable = ownDocument.createElement("p");
      ownEditable.setAttribute("contenteditable", "true");
      ownEditable.setAttribute("data-agent-native-text-editing", "true");
      ownDocument.body.append(ownEditable);
      ownEditable.focus();
      iframe!.focus();
      expect(ownDocument.activeElement).toBe(ownEditable);
      expect(document.activeElement).toBe(iframe);

      // reaches DesignCanvas. The DOM check must cover this short race window.
      await enterCanvas();
      expect(document.activeElement).toBe(iframe);

      siblingIframe = document.createElement("iframe");
      document.body.append(siblingIframe);
      const siblingEditable = siblingIframe.contentDocument!.createElement("p");
      siblingEditable.setAttribute("contenteditable", "true");
      siblingEditable.setAttribute("data-agent-native-text-editing", "true");
      siblingIframe.contentDocument!.body.append(siblingEditable);
      siblingEditable.focus();
      siblingIframe.focus();
      expect(siblingIframe.contentDocument!.activeElement).toBe(
        siblingEditable,
      );
      expect(document.activeElement).toBe(siblingIframe);

      await enterCanvas();
      expect(document.activeElement).toBe(siblingIframe);

      iframe!.focus();
      expect(document.activeElement).toBe(iframe);

      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "text-editing-state",
              active: true,
              selector: '[data-agent-native-node-id="text-probe"]',
              sourceId: "text-probe",
              hasRange: false,
            },
            origin: window.location.origin,
            source: iframe!.contentWindow,
          }),
        ),
      );
      expect(onTextEditingStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ active: true, sourceId: "text-probe" }),
      );

      await enterCanvas();

      expect(document.activeElement).toBe(iframe);
    } finally {
      await act(async () => root.unmount());
      siblingIframe?.remove();
      container.remove();
    }
  });

  it("keeps review overlays out of single-screen pan gestures", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () =>
        root.render(
          <DesignCanvas
            content="<!doctype html><html><body></body></html>"
            contentKey="review-overlay-pan-guard"
            screenId="screen-review"
            zoom={100}
            deviceFrame="none"
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
            editMode
            handToolActive
          />,
        ),
      );
      const scrollSurface =
        container.querySelector<HTMLElement>('[tabindex="-1"]');
      expect(scrollSurface).not.toBeNull();

      const canvasTarget = document.createElement("div");
      const reviewTarget = document.createElement("button");
      reviewTarget.dataset.reviewPopover = "";
      scrollSurface!.append(canvasTarget, reviewTarget);

      const canvasMouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      canvasTarget.dispatchEvent(canvasMouseDown);
      expect(canvasMouseDown.defaultPrevented).toBe(true);
      window.dispatchEvent(new MouseEvent("mouseup"));

      const reviewMouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      reviewTarget.dispatchEvent(reviewMouseDown);
      expect(reviewMouseDown.defaultPrevented).toBe(false);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("keeps editor shell semantic tokens out of the prototype document", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const previousRootStyle = document.documentElement.style.cssText;
    document.documentElement.style.setProperty("--background", "0 0% 100%");
    document.documentElement.style.setProperty("--foreground", "0 0% 10%");
    document.documentElement.style.setProperty("--border", "0 0% 90%");
    document.documentElement.style.setProperty(
      "--design-editor-accent-color",
      "hsl(205 100% 53%)",
    );
    const content =
      "<!doctype html><html><head><style>:root{--background:210 20% 96%;--foreground:220 20% 12%;--border:220 12% 82%}</style></head><body></body></html>";

    try {
      await act(async () =>
        root.render(
          <DesignCanvas
            content={content}
            contentKey="prototype-theme-isolation"
            screenId="screen-theme"
            zoom={100}
            deviceFrame="none"
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
            editMode
          />,
        ),
      );
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const editorThemeScript = iframe?.srcdoc.match(
        /<script data-agent-native-editor-theme>([\s\S]*?)<\/script>/,
      )?.[1];

      expect(editorThemeScript).toBeDefined();
      expect(editorThemeScript).toContain("--design-editor-accent-color");
      expect(editorThemeScript).toContain(
        "window.__anEditorBridgeThemeVars = vars",
      );
      expect(editorThemeScript).not.toContain("root.style.setProperty");
      expect(editorThemeScript).not.toContain('"--background"');
      expect(editorThemeScript).not.toContain('"--foreground"');
      expect(editorThemeScript).not.toContain('"--border"');
      expect(iframe?.srcdoc).toContain("--background:210 20% 96%");
    } finally {
      document.documentElement.style.cssText = previousRootStyle;
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("keeps the iframe identity stable when a board render window reanchors", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const content = `<!doctype html><html><body><div data-agent-native-node-id="shape" style="position:absolute;left:-165px;top:-90px;width:84px;height:76px"></div></body></html>`;

    const render = (offset: number) => (
      <DesignCanvas
        content={content}
        contentKey="board:surface"
        screenId="board"
        zoom={100}
        deviceFrame="none"
        interactMode
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
        boardSurface
        editMode={false}
        embeddedFrame={{
          viewportWidth: 8192,
          viewportHeight: 8192,
          displayWidth: 8192,
          displayHeight: 8192,
          fluid: true,
          contentOffsetX: offset,
          contentOffsetY: offset,
        }}
      />
    );

    try {
      await act(async () => root.render(render(4096)));
      const before = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(before).not.toBeNull();
      expect(before!.srcdoc).toContain("translate:4096px 4096px");

      await act(async () => root.render(render(8192)));
      const after = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(after).toBe(before);
      expect(after!.srcdoc).toContain("translate:4096px 4096px");
      const liveOffsetStyle = after!.contentDocument?.querySelector(
        "style[data-agent-native-content-offset]",
      );
      if (liveOffsetStyle) {
        expect(liveOffsetStyle.textContent).toContain(
          "translate:8192px 8192px",
        );
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("releases native wheel scrolling in embedded Interact mode", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const content =
      '<!doctype html><html><body style="min-height:900px"></body></html>';
    const render = (interactMode: boolean) => (
      <DesignCanvas
        content={content}
        contentKey="embedded-wheel-mode"
        screenId="screen-a"
        zoom={100}
        deviceFrame="none"
        interactMode={interactMode}
        editMode={!interactMode}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
        embeddedFrame={{
          viewportWidth: 400,
          viewportHeight: 300,
          displayWidth: 400,
          displayHeight: 300,
        }}
      />
    );
    try {
      await act(async () => root.render(render(false)));
      const editIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(editIframe?.contentWindow).toBeTruthy();
      const editPostMessage = vi.spyOn(
        editIframe!.contentWindow!,
        "postMessage",
      );
      const wheelEnabledMessages = () =>
        editPostMessage.mock.calls
          .map(
            (call) =>
              call[0] as
                | {
                    type?: string;
                    wheelEnabled?: boolean;
                    spaceKeyForwardingEnabled?: boolean;
                  }
                | undefined,
          )
          .filter(
            (
              message,
            ): message is {
              type: string;
              wheelEnabled?: boolean;
              spaceKeyForwardingEnabled?: boolean;
            } => message?.type === "embedded-canvas-gesture-mode",
          );
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "agent-native:editor-chrome-ready" },
            origin: window.location.origin,
            source: editIframe!.contentWindow,
          }),
        );
      });
      await vi.waitFor(() => {
        expect(wheelEnabledMessages().slice(-1)[0]).toMatchObject({
          wheelEnabled: true,
          spaceKeyForwardingEnabled: true,
        });
      });

      await act(async () => root.render(render(true)));
      const interactIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(interactIframe?.contentWindow).toBeTruthy();
      const interactPostMessage = vi.spyOn(
        interactIframe!.contentWindow!,
        "postMessage",
      );
      const interactWheelEnabledMessages = () =>
        interactPostMessage.mock.calls
          .map(
            (call) =>
              call[0] as
                | {
                    type?: string;
                    wheelEnabled?: boolean;
                    spaceKeyForwardingEnabled?: boolean;
                  }
                | undefined,
          )
          .filter(
            (
              message,
            ): message is {
              type: string;
              wheelEnabled?: boolean;
              spaceKeyForwardingEnabled?: boolean;
            } => message?.type === "embedded-canvas-gesture-mode",
          );
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "agent-native:editor-chrome-ready" },
            origin: window.location.origin,
            source: interactIframe!.contentWindow,
          }),
        );
      });
      await vi.waitFor(() => {
        expect(interactWheelEnabledMessages().slice(-1)[0]).toMatchObject({
          wheelEnabled: false,
          spaceKeyForwardingEnabled: true,
        });
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("keeps the live iframe and switches interaction ownership in place", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const content = "http://localhost:5173/forms";
    const render = (interactMode: boolean) => (
      <DesignCanvas
        content={content}
        contentKey="same-live-iframe"
        screenId="screen-a"
        sourceType="localhost"
        bridgeUrl="http://127.0.0.1:7331"
        zoom={100}
        deviceFrame="none"
        interactMode={interactMode}
        editMode={!interactMode}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
      />
    );

    try {
      await act(async () => root.render(render(false)));
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe?.contentWindow).toBeTruthy();
      const contentWindow = iframe!.contentWindow;
      let loadCount = 0;
      iframe!.addEventListener("load", () => {
        loadCount += 1;
      });
      const postMessage = vi.spyOn(iframe!.contentWindow!, "postMessage");

      await act(async () => root.render(render(true)));

      expect(
        container.querySelector("iframe[data-design-preview-iframe]"),
      ).toBe(iframe);
      expect(iframe!.contentWindow).toBe(contentWindow);
      expect(loadCount).toBe(0);
      expect(postMessage).toHaveBeenCalledWith(
        { type: "set-interaction-mode", interact: true },
        "*",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("queues and deduplicates runtime structure move requests until the bridge is ready", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const request = {
      requestId: 41,
      subject: {
        selector: ".repeated",
        sourceId: "runtime-subject",
      },
      anchor: {
        selector: ".repeated",
        sourceId: "runtime-anchor",
      },
      placement: "inside" as const,
    };
    const render = (runtimeRequest: typeof request | null) => (
      <DesignCanvas
        content="<!doctype html><html><body></body></html>"
        contentKey="runtime-structure"
        runtimeStructureMoveRequest={runtimeRequest}
        screenId="screen-a"
        zoom={100}
        deviceFrame="none"
        interactMode={false}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
        editMode
      />
    );

    try {
      await act(async () => root.render(render(null)));
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe?.contentWindow).toBeTruthy();
      const postMessage = vi.spyOn(iframe!.contentWindow!, "postMessage");

      await act(async () => root.render(render(request)));
      await act(async () => {
        iframe!.dispatchEvent(new Event("load"));
      });

      const expected = {
        type: "runtime-structure-move",
        subjectSelector: ".repeated",
        subjectSourceId: "runtime-subject",
        anchorSelector: ".repeated",
        anchorSourceId: "runtime-anchor",
        placement: "inside",
      };
      expect(postMessage).toHaveBeenCalledWith(expected, "*");

      const matchingCallsBefore = postMessage.mock.calls.filter(
        ([message]) =>
          (message as { type?: string }).type === "runtime-structure-move",
      ).length;
      await act(async () => root.render(render(request)));
      const matchingCallsAfter = postMessage.mock.calls.filter(
        ([message]) =>
          (message as { type?: string }).type === "runtime-structure-move",
      ).length;
      expect(matchingCallsAfter).toBe(matchingCallsBefore);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("replays the forced interaction state after every iframe document load", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <DesignCanvas
            content='<!doctype html><html><body><button id="save">Save</button></body></html>'
            contentKey="state-replay"
            screenId="screen-a"
            zoom={100}
            deviceFrame="none"
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
            editMode
            statePreviewTarget={{
              nodeId: "runtime-save",
              selector: "#save",
              selectorCandidates: ["#save"],
              state: "focus-visible",
              previewStyles: { outline: "2px solid rgb(59, 130, 246)" },
            }}
          />,
        );
      });
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe?.contentWindow).toBeTruthy();
      const postMessage = vi.spyOn(iframe!.contentWindow!, "postMessage");

      await act(async () => iframe!.dispatchEvent(new Event("load")));
      const firstLoadCount = postMessage.mock.calls.filter(
        ([message]) => (message as { type?: string }).type === "state-preview",
      ).length;
      expect(firstLoadCount).toBeGreaterThan(0);

      await act(async () => iframe!.dispatchEvent(new Event("load")));
      const stateMessages = postMessage.mock.calls
        .map(([message]) => message as { type?: string; state?: string })
        .filter((message) => message.type === "state-preview");
      expect(stateMessages.length).toBeGreaterThan(firstLoadCount);
      expect(stateMessages[stateMessages.length - 1]).toMatchObject({
        nodeId: "runtime-save",
        selector: "#save",
        selectorCandidates: ["#save"],
        state: "focus-visible",
        previewStyles: { outline: "2px solid rgb(59, 130, 246)" },
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("re-pushes the current editor chrome scale after every bridge-ready handshake, without any zoom change", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (contentKey: string, content: string) => (
      <DesignCanvas
        content={content}
        contentKey={contentKey}
        screenId="screen-a"
        zoom={31}
        deviceFrame="none"
        interactMode={false}
        editMode
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
      />
    );
    const dispatchReady = async (contentWindow: Window) => {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "agent-native:editor-chrome-ready" },
            origin: window.location.origin,
            source: contentWindow,
          }),
        );
      });
    };
    const lastScaleMessage = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls
        .map(
          ([message]) =>
            message as { type?: string; scaleX?: number; scaleY?: number },
        )
        .filter((message) => message.type === "set-editor-chrome-scale")
        .slice(-1)[0];

    try {
      await act(async () =>
        root.render(
          render(
            "chrome-scale-k1",
            "<!doctype html><html><body>one</body></html>",
          ),
        ),
      );
      const firstIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(firstIframe?.contentWindow).toBeTruthy();
      const firstPostMessage = vi.spyOn(
        firstIframe!.contentWindow!,
        "postMessage",
      );
      await dispatchReady(firstIframe!.contentWindow!);
      expect(lastScaleMessage(firstPostMessage)).toMatchObject({
        scaleX: 0.31,
        scaleY: 0.31,
      });

      await act(async () =>
        root.render(
          render(
            "chrome-scale-k2",
            "<!doctype html><html><body>two</body></html>",
          ),
        ),
      );
      const secondIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(secondIframe).not.toBe(firstIframe);
      expect(secondIframe?.contentWindow).toBeTruthy();
      const secondPostMessage = vi.spyOn(
        secondIframe!.contentWindow!,
        "postMessage",
      );
      await dispatchReady(secondIframe!.contentWindow!);
      expect(lastScaleMessage(secondPostMessage)).toMatchObject({
        scaleX: 0.31,
        scaleY: 0.31,
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("enters Interact mode with the latest persisted content instead of the edit-mode snapshot", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const initial =
      '<!doctype html><html><body><button data-agent-native-node-id="save">Save</button></body></html>';
    const withState = `${initial}<style data-test="state-latest">[data-agent-native-node-id="save"]:hover{opacity:.5!important}</style>`;
    const render = (content: string, interactMode: boolean) => (
      <DesignCanvas
        content={content}
        contentKey="interact-latest-content"
        screenId="screen-a"
        zoom={100}
        deviceFrame="none"
        interactMode={interactMode}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
        editMode={!interactMode}
      />
    );

    try {
      await act(async () => root.render(render(initial, false)));
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe?.srcdoc).not.toContain('data-test="state-latest"');

      await act(async () => root.render(render(withState, false)));
      expect(iframe?.srcdoc).not.toContain('data-test="state-latest"');

      await act(async () => root.render(render(withState, true)));
      const interactIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(interactIframe?.srcdoc).toContain('data-test="state-latest"');
      expect(interactIframe?.srcdoc).toContain(":hover{opacity:.5!important}");

      await act(async () => root.render(render(withState, false)));
      const refreshedEditIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(refreshedEditIframe?.srcdoc).toContain('data-test="state-latest"');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("keeps bundled runtimes in overview in-place replacements", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const runtimeScript =
      '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>';
    const initial = `<!doctype html><html><head>${runtimeScript}</head><body class="flex"><main>Initial</main></body></html>`;
    const updated = initial.replace("Initial", "Updated");
    const render = (content: string, revision: string) => (
      <DesignCanvas
        content={content}
        contentKey="overview-runtime-replacement"
        runtimeReplacementContent={content}
        runtimeReplacementKey={revision}
        screenId="screen-a"
        zoom={100}
        deviceFrame="none"
        interactMode={false}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
        editMode
      />
    );

    try {
      await act(async () => root.render(render(initial, "revision-1")));
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe?.srcdoc).toContain(`src="${localRuntimeUrls().tailwind}"`);
      const postMessage = vi.spyOn(iframe!.contentWindow!, "postMessage");

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "agent-native:editor-chrome-ready" },
            origin: window.location.origin,
            source: iframe!.contentWindow,
          }),
        );
      });

      await act(async () => root.render(render(updated, "revision-2")));

      const replacement = postMessage.mock.calls
        .map(([message]) => message as { type?: string; content?: string })
        .find((message) => message.type === "replace-document-content");
      expect(replacement?.content).toContain(
        `src="${localRuntimeUrls().tailwind}"`,
      );
      expect(replacement?.content).not.toContain(
        "cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("reloads edit mode when a runtime update introduces executable scripts", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const initial =
      "<!doctype html><html><head></head><body><main>Static direction</main></body></html>";
    const alpine =
      '<!doctype html><html><head><script>window.__runtimeStarted = true;</script><style>[x-cloak]{display:none!important}</style></head><body x-data="{ ready: true }" x-cloak><main x-show="ready">Interactive app</main></body></html>';
    const render = (content: string, revision: string) => (
      <DesignCanvas
        content={content}
        contentKey="script-aware-runtime-replacement"
        runtimeReplacementContent={content}
        runtimeReplacementKey={revision}
        screenId="screen-a"
        zoom={100}
        deviceFrame="none"
        interactMode={false}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
        editMode
      />
    );

    try {
      await act(async () => root.render(render(initial, "revision-1")));
      const staticIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(staticIframe?.srcdoc).toContain("Static direction");

      await act(async () => root.render(render(alpine, "revision-2")));
      const alpineIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );

      expect(alpineIframe).not.toBe(staticIframe);
      expect(alpineIframe?.srcdoc).toContain("__runtimeStarted");
      expect(alpineIframe?.srcdoc).toContain("x-cloak");
      expect(alpineIframe?.srcdoc).toContain("Interactive app");

      const visualEdit = alpine.replace(
        "Interactive app",
        "Updated interactive app",
      );
      await act(async () => root.render(render(visualEdit, "revision-3")));
      const visualEditIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(visualEditIframe).toBe(alpineIframe);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("does not truncate the editor-chrome bridge script when embedded", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const sourceScript = '<script>const template = "</body>";</script>';
    const content = `<!doctype html><html><head></head><body>${sourceScript}<div id="target">Click me</div></body></html>`;

    try {
      await act(async () =>
        root.render(
          <DesignCanvas
            content={content}
            contentKey="embedded-bridge-truncation"
            screenId="screen-a"
            zoom={100}
            deviceFrame="none"
            interactMode={false}
            editMode
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
            embeddedFrame={{
              viewportWidth: 400,
              viewportHeight: 300,
              displayWidth: 400,
              displayHeight: 300,
            }}
          />,
        ),
      );
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const srcdoc = iframe?.srcdoc ?? "";

      expect(srcdoc).toContain(sourceScript);
      expect(
        srcdoc.indexOf("agent-native:editor-chrome-ready"),
      ).toBeGreaterThan(srcdoc.indexOf(sourceScript));
      expect(srcdoc).toContain("agent-native:editor-chrome-ready");
      expect(srcdoc).toContain("agent-native:editor-chrome-ready-probe");
      expect(srcdoc).toContain("data-agent-native-content-size-bridge");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
