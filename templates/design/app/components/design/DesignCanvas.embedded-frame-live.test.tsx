// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

vi.mock("@agent-native/core/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/client")>();
  return {
    ...original,
    useT: () => (key: string) => key,
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DesignCanvas live embedded-frame offset", () => {
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
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
