// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DesignCanvas live embedded-frame offset", () => {
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
      // srcdoc intentionally stays keyed to the existing browsing context;
      // the live offset effect updates the document/bridge in place.
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
              call[0] as { type?: string; wheelEnabled?: boolean } | undefined,
          )
          .filter(
            (message): message is { type: string; wheelEnabled?: boolean } =>
              message?.type === "embedded-canvas-gesture-mode",
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
              call[0] as { type?: string; wheelEnabled?: boolean } | undefined,
          )
          .filter(
            (message): message is { type: string; wheelEnabled?: boolean } =>
              message?.type === "embedded-canvas-gesture-mode",
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
        });
      });
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

      // Same-screen edit echoes stay bridge-only in Edit mode to avoid an
      // iframe reload/flash.
      await act(async () => root.render(render(withState, false)));
      expect(iframe?.srcdoc).not.toContain('data-test="state-latest"');

      // Interact omits that bridge, so its rebuilt document must consume the
      // latest persisted source immediately.
      await act(async () => root.render(render(withState, true)));
      const interactIframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(interactIframe?.srcdoc).toContain('data-test="state-latest"');
      expect(interactIframe?.srcdoc).toContain(":hover{opacity:.5!important}");

      // Returning to Edit must retain Interact's authoritative persisted
      // baseline rather than restoring the stale pre-edit snapshot.
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

  // Regression: embedded (overview) screens run both the editor-chrome bridge
  // (contains a literal "$&" in its escapeIdent helper) and
  // appendContentSizeReporter, which used a plain-string second argument to
  // String.replace("</body>", ...). String.replace treats "$&" in a string
  // replacement as "insert the matched text", so it spliced a stray
  // "</body>" into the middle of editor-chrome-bridge's own script and the
  // HTML parser closed that <script> tag right there — truncating the bridge
  // before it ever created the selection/hover overlays. Only reproduces
  // embedded (isEmbeddedFrame) + editable (editMode, not interactMode),
  // since that's the only combination that includes both scripts.
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

      // The literal closer in the screen's own script stays intact, and the
      // generated bridge follows that script rather than being nested inside it.
      expect(srcdoc).toContain(sourceScript);
      expect(
        srcdoc.indexOf("agent-native:editor-chrome-ready"),
      ).toBeGreaterThan(srcdoc.indexOf(sourceScript));
      // The bridge's own closing handshake must survive intact, proving its
      // <script> tag was never prematurely closed partway through.
      expect(srcdoc).toContain("agent-native:editor-chrome-ready");
      expect(srcdoc).toContain("data-agent-native-content-size-bridge");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
