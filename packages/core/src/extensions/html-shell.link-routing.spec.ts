// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  buildExtensionHtml,
  EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
  EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE,
  EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
} from "./html-shell.js";

// The shell needs a window of its own, at its own URL, running its inline
// scripts. Core doesn't depend on jsdom directly; vitest's jsdom environment
// exposes its instance, and its constructor is the JSDOM class.
const JSDOM = (globalThis as any).jsdom.constructor;

const OPEN_URL = "agent-native-extension-open-url";
const READY = "agent-native-extension-open-url-ready";
const shellWindows: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const window of shellWindows.splice(0)) window.close();
});

// Runs the real extension shell (not the host) in its own jsdom window and checks which link
// clicks it hands to the host. At the top level window.parent === window, so
// the shell's postMessage calls land on the spy installed before parsing.
function loadShell(
  content: string,
  options: {
    secureRandom?: boolean;
    linkNonce?: string;
    linkChannelReady?: boolean;
    hostParent?: boolean;
    url?: string;
  } = {},
) {
  const posted: any[] = [];
  const portPosted: any[] = [];
  const linkChannelPorts: any[] = [];
  const linkHandlers: Partial<
    Record<"click" | "auxclick", (event: any) => void>
  > = {};
  const linkHandlerCapture: Partial<Record<"click" | "auxclick", boolean>> = {};
  const closedShadowLinkHandlers: Partial<
    Record<"click" | "auxclick", (event: any) => void>
  > = {};
  const legacyLinkHandlers: Partial<
    Record<"click" | "auxclick", (event: any) => void>
  > = {};
  const dom = new JSDOM(
    buildExtensionHtml(
      content,
      ":root{}",
      false,
      "ext",
      undefined,
      undefined,
      options.linkNonce,
    ),
    {
      runScripts: "dangerously",
      url:
        options.url ??
        "https://analytics.example/_agent-native/extensions/ext/render",
      beforeParse(window: any) {
        class TestMessagePort {
          peer: TestMessagePort | null = null;
          listeners: Array<(event: any) => void> = [];
          closed = false;
          addEventListener(type: string, listener: (event: any) => void) {
            if (type === "message") this.listeners.push(listener);
          }
          close() {
            this.closed = true;
          }
          postMessage(data: unknown) {
            portPosted.push(data);
            this.peer?.listeners.forEach((listener) =>
              listener({ data, ports: [] }),
            );
          }
          start() {}
        }
        const postTestPortMessage = TestMessagePort.prototype.postMessage;
        window.MessagePort = TestMessagePort;
        window.MessageChannel = class {
          port1 = new TestMessagePort();
          port2 = new TestMessagePort();
          constructor() {
            this.port1.peer = this.port2;
            this.port2.peer = this.port1;
          }
        };
        const postToParent = (
          message: unknown,
          _targetOrigin?: string,
          transfer?: TestMessagePort[],
        ) => {
          posted.push(message);
          if (
            (message as any)?.type === EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE
          ) {
            if (options.linkChannelReady !== false) {
              if (transfer?.[0]) {
                postTestPortMessage.call(transfer[0], {
                  type: EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
                });
              }
            }
            if (transfer?.[0]?.peer) linkChannelPorts.push(transfer[0].peer);
          }
        };
        (window as any).postMessage = postToParent;
        if (options.hostParent) {
          Object.defineProperty(window, "parent", {
            configurable: true,
            value: { postMessage: postToParent },
          });
        }
        const addWindowEventListener = window.addEventListener.bind(window);
        window.addEventListener = (
          type: string,
          listener: EventListenerOrEventListenerObject,
          listenerOptions?: AddEventListenerOptions | boolean,
        ) => {
          if (
            (type === "click" || type === "auxclick") &&
            typeof listener === "function" &&
            listener.toString().includes("linkFromEvent(event)")
          ) {
            linkHandlers[type] = listener as (event: any) => void;
            linkHandlerCapture[type] =
              typeof listenerOptions === "boolean"
                ? listenerOptions
                : (listenerOptions?.capture ?? false);
          }
          if (
            (type === "click" || type === "auxclick") &&
            typeof listener === "function" &&
            listener.toString().includes("hostOpensLinks")
          ) {
            legacyLinkHandlers[type] = listener as (event: any) => void;
          }
          return addWindowEventListener(type, listener, listenerOptions);
        };
        const addDocumentEventListener = window.document.addEventListener.bind(
          window.document,
        );
        window.document.addEventListener = (
          type: string,
          listener: EventListenerOrEventListenerObject,
          listenerOptions?: AddEventListenerOptions | boolean,
        ) => {
          if (
            (type === "click" || type === "auxclick") &&
            typeof listener === "function" &&
            listener.toString().includes("linkFromEvent(event)")
          ) {
            linkHandlers[type] = listener as (event: any) => void;
            linkHandlerCapture[type] =
              typeof listenerOptions === "boolean"
                ? listenerOptions
                : (listenerOptions?.capture ?? false);
          }
          return addDocumentEventListener(type, listener, listenerOptions);
        };
        const nativeAttachShadow = window.Element.prototype.attachShadow;
        window.Element.prototype.attachShadow = function (
          init: ShadowRootInit,
        ) {
          const root = nativeAttachShadow.call(this, init);
          const addRootEventListener = root.addEventListener.bind(root);
          root.addEventListener = (
            type: string,
            listener: EventListenerOrEventListenerObject,
            listenerOptions?: AddEventListenerOptions | boolean,
          ) => {
            if (
              (type === "click" || type === "auxclick") &&
              typeof listener === "function" &&
              listener.toString().includes("linkFromEvent(event)")
            ) {
              closedShadowLinkHandlers[type] = listener as (event: any) => void;
            }
            return addRootEventListener(type, listener, listenerOptions);
          };
          return root;
        };
        if (options.secureRandom === false) {
          Object.defineProperty(window, "crypto", { value: undefined });
        }
      },
    },
  );
  const window = dom.window as any;
  window.dispatchEvent(new window.Event("load"));
  shellWindows.push(window);
  const binding = posted.find(
    (message) => message?.type === "agent-native-extension-binding",
  );
  return {
    window,
    binding,
    ready() {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: { type: READY },
          source: window,
        }),
      );
    },
    opened: () => posted.filter((message) => message?.type === OPEN_URL),
    linkChannelHellos: () =>
      posted.filter(
        (message) =>
          message?.type === EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
      ),
    linkChannelPorts: () => linkChannelPorts,
    deliverLinkChannelReady(port: {
      peer: { postMessage(data: unknown): void };
    }) {
      port.peer.postMessage({
        type: EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
      });
    },
    linkRequests: () =>
      portPosted.filter(
        (message) =>
          message?.type === EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
      ),
    fallbackLinkRequests: () =>
      posted.filter(
        (message) =>
          message?.nonce === options.linkNonce &&
          (message?.type === EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE ||
            message?.type === EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE),
      ),
    sameOriginNavigations: () =>
      portPosted.filter(
        (message) =>
          message?.type === EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE,
      ),
    linkHandlerUsesCapture: (type: "click" | "auxclick") =>
      linkHandlerCapture[type] ?? false,
    click(
      target: Element,
      init: Record<string, unknown> = {},
      type: "click" | "auxclick" = "click",
    ) {
      const event = new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
    clickTrusted(
      target: Element,
      init: Record<string, unknown> = {},
      type: "click" | "auxclick" = "click",
    ) {
      return invokeLinkHandlerWithObservers(
        linkHandlers[type],
        target,
        init,
        type,
      );
    },
    clickTrustedAfterWindowCaptureStop(
      target: Element,
      init: Record<string, unknown> = {},
      type: "click" | "auxclick" = "click",
    ) {
      return invokeLinkHandlerWithObservers(
        linkHandlers[type],
        target,
        init,
        type,
        (event) => event.stopImmediatePropagation(),
      );
    },
    clickTrustedLegacy(
      target: Element,
      init: Record<string, unknown> = {},
      type: "click" | "auxclick" = "click",
    ) {
      return invokeLinkHandler(legacyLinkHandlers[type], target, init, type);
    },
    clickTrustedInClosedRoot(
      target: Element,
      init: Record<string, unknown> = {},
      type: "click" | "auxclick" = "click",
    ) {
      return invokeLinkHandlerWithObservers(
        closedShadowLinkHandlers[type],
        target,
        init,
        type,
      );
    },
  };

  function invokeLinkHandler(
    handler: ((event: any) => void) | undefined,
    target: Element,
    init: Record<string, unknown>,
    type: "click" | "auxclick",
  ) {
    if (!handler) throw new Error(`Missing ${type} extension link handler`);
    const path: EventTarget[] = [];
    let current: Node | null = target;
    while (current) {
      path.push(current);
      current =
        current instanceof window.ShadowRoot
          ? current.host
          : current.parentNode;
    }
    if (!path.includes(window)) path.push(window);
    let defaultPrevented = false;
    handler.call(window, {
      type,
      button: init.button ?? 0,
      altKey: init.altKey ?? false,
      metaKey: init.metaKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      shiftKey: init.shiftKey ?? false,
      defaultPrevented: false,
      isTrusted: true,
      target,
      composedPath: () => path,
      preventDefault() {
        defaultPrevented = true;
      },
    });
    return defaultPrevented;
  }

  function invokeLinkHandlerWithObservers(
    handler: ((event: any) => void) | undefined,
    target: Element,
    init: Record<string, unknown>,
    type: "click" | "auxclick",
    afterHandler?: (event: any) => void,
  ) {
    if (!handler) throw new Error(`Missing ${type} extension link handler`);
    const realPath: EventTarget[] = [];
    let current: Node | null = target;
    while (current) {
      realPath.push(current);
      current =
        current instanceof window.ShadowRoot
          ? current.host
          : current.parentNode;
    }
    let defaultPrevented = false;
    let cancelBubble = false;
    let currentTarget: EventTarget | null = null;
    let eventPhase = 0;
    const observers: Array<{
      target: EventTarget;
      listener: (event: any) => void;
      capture: boolean;
    }> = [];
    const path = realPath.map((node) => {
      const wrapper: any = {
        nodeType: (node as Node).nodeType,
        localName: (node as Element).localName,
        tagName: (node as Element).tagName,
        hasAttribute: (name: string) => (node as Element).hasAttribute(name),
        getAttribute: (name: string) => (node as Element).getAttribute(name),
        hasAttributeNS: (namespace: string, name: string) =>
          (node as Element).hasAttributeNS(namespace, name),
        getAttributeNS: (namespace: string, name: string) =>
          (node as Element).getAttributeNS(namespace, name),
        addEventListener(
          eventType: string,
          listener: (event: any) => void,
          listenerOptions?: AddEventListenerOptions | boolean,
        ) {
          if (eventType !== type) return;
          observers.push({
            target: wrapper,
            listener,
            capture:
              typeof listenerOptions === "boolean"
                ? listenerOptions
                : (listenerOptions?.capture ?? false),
          });
        },
        removeEventListener(
          eventType: string,
          listener: (event: any) => void,
          listenerOptions?: AddEventListenerOptions | boolean,
        ) {
          const capture =
            typeof listenerOptions === "boolean"
              ? listenerOptions
              : (listenerOptions?.capture ?? false);
          const index = observers.findIndex(
            (observer) =>
              observer.target === wrapper &&
              observer.listener === listener &&
              observer.capture === capture,
          );
          if (index >= 0) observers.splice(index, 1);
        },
      };
      return wrapper;
    });
    path.push(window as EventTarget);
    const originalWindowAddEventListener = window.addEventListener;
    const originalWindowRemoveEventListener = window.removeEventListener;
    window.addEventListener = (
      eventType: string,
      listener: (event: any) => void,
      listenerOptions?: AddEventListenerOptions | boolean,
    ) => {
      if (eventType === type) {
        observers.push({
          target: window,
          listener,
          capture:
            typeof listenerOptions === "boolean"
              ? listenerOptions
              : (listenerOptions?.capture ?? false),
        });
      } else {
        originalWindowAddEventListener.call(
          window,
          eventType,
          listener,
          listenerOptions,
        );
      }
    };
    window.removeEventListener = (
      eventType: string,
      listener: (event: any) => void,
      listenerOptions?: EventListenerOptions | boolean,
    ) => {
      const capture =
        typeof listenerOptions === "boolean"
          ? listenerOptions
          : (listenerOptions?.capture ?? false);
      const index = observers.findIndex(
        (observer) =>
          observer.target === window &&
          observer.listener === listener &&
          observer.capture === capture,
      );
      if (eventType === type && index >= 0) {
        observers.splice(index, 1);
      } else {
        originalWindowRemoveEventListener.call(
          window,
          eventType,
          listener,
          listenerOptions,
        );
      }
    };
    const event = {
      type,
      button: init.button ?? 0,
      altKey: init.altKey ?? false,
      metaKey: init.metaKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      shiftKey: init.shiftKey ?? false,
      get defaultPrevented() {
        return defaultPrevented;
      },
      isTrusted: true,
      target,
      composedPath: () => path,
      get currentTarget() {
        return currentTarget;
      },
      get eventPhase() {
        return eventPhase;
      },
      get cancelBubble() {
        return cancelBubble;
      },
      preventDefault() {
        defaultPrevented = true;
      },
      stopPropagation() {
        cancelBubble = true;
      },
      stopImmediatePropagation() {
        cancelBubble = true;
        immediatePropagationStopped = true;
      },
    };
    let immediatePropagationStopped = false;
    try {
      handler.call(window, event);
      afterHandler?.(event);

      if (observers.length > 0) {
        for (let index = path.length - 1; index >= 0; index -= 1) {
          currentTarget = path[index] as EventTarget;
          eventPhase = 1;
          observers
            .filter(
              (observer) =>
                observer.target === currentTarget && observer.capture,
            )
            .forEach((observer) => observer.listener(event));
        }
        for (const pathTarget of path) {
          currentTarget = pathTarget as EventTarget;
          eventPhase = currentTarget === target ? 2 : 3;
          const element = realPath[path.indexOf(pathTarget)] as
            | Element
            | undefined;
          if (
            element?.nodeType === 1 &&
            type === "click" &&
            typeof (element as any).onclick === "function"
          ) {
            (element as any).onclick.call(element, event);
          }
          if (immediatePropagationStopped) break;
          observers
            .filter(
              (observer) =>
                observer.target === currentTarget && !observer.capture,
            )
            .forEach((observer) => observer.listener(event));
          if (cancelBubble) break;
        }
      }
    } finally {
      window.addEventListener = originalWindowAddEventListener;
      window.removeEventListener = originalWindowRemoveEventListener;
    }
    return defaultPrevented;
  }
}

const LINKS = `
  <a id="blank" href="https://app.hubspot.com/x" target="_blank">blank</a>
  <a id="upper" href="https://app.hubspot.com/upper" target="_BLANK">upper</a>
  <a id="plain" href="https://example.com/plain">plain</a>
  <a id="self" href="https://example.com/self" target="_self">self</a>
  <a id="top" href="https://example.com/top" target="_top">top</a>
  <a id="named" href="https://example.com/named" target="report">named</a>
  <a id="download" href="https://example.com/file.csv" target="_blank" download>file</a>
  <a id="mailto" href="mailto:someone@example.com" target="_blank">mail</a>
  <a id="js" href="javascript:void(0)" target="_blank">js</a>
  <a id="prevented" href="https://example.com/prevented" target="_blank" onclick="event.preventDefault()">prevented</a>
  <svg>
    <a id="svg" href="https://example.com/svg" target="_blank"><text>svg</text></a>
    <a id="xlink" xlink:href="/chart/1" target="_blank"><text>xlink</text></a>
    <a id="svgSelf" href="https://example.com/svg-self"><text>self</text></a>
  </svg>
`;

describe("extension shell link routing", () => {
  it("announces a hex token with the binding", () => {
    const shell = loadShell(LINKS);
    expect(shell.binding.openUrlToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it("keeps the link port out of extension-controlled channel globals", () => {
    const shell = loadShell(
      `<script>
        window.__capturedLinkPorts = [];
        var OriginalMessageChannel = window.MessageChannel;
        window.MessageChannel = function() {
          var channel = new OriginalMessageChannel();
          window.__capturedLinkPorts.push({ name: "MessageChannel", port: channel.port1 });
          return channel;
        };
        ["addEventListener", "postMessage", "start", "close"].forEach(function(name) {
          var original = window.MessagePort.prototype[name];
          window.MessagePort.prototype[name] = function() {
            window.__capturedLinkPorts.push({ name: name, port: this });
            return original.apply(this, arguments);
          };
        });
      </script>
      <a id="external" href="https://example.com/private-port">external</a>`,
      { linkNonce: "frame-link-nonce" },
    );

    expect((shell.window as any).__capturedLinkPorts).toEqual([]);
    expect(
      shell.clickTrusted(shell.window.document.getElementById("external")),
    ).toBe(true);
    expect(shell.linkRequests()).toEqual([
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://example.com/private-port",
      },
    ]);
  });

  it("leaves links native until the host says it opens them", () => {
    const shell = loadShell(LINKS);
    const blank = shell.window.document.getElementById("blank");

    expect(shell.click(blank)).toBe(false);
    expect(shell.opened()).toEqual([]);
  });

  it("keeps same-frame external navigation native without a link nonce", () => {
    const shell = loadShell(
      '<a id="external" href="https://example.com/">external</a>',
    );

    expect(
      shell.clickTrusted(shell.window.document.getElementById("external")),
    ).toBe(false);
  });

  it("routes external area, SVG, and shadow-root links", () => {
    const shell = loadShell(
      `
        <map name="external-links"><area id="area" href="https://example.com/area"></map>
        <svg><a id="svg" href="https://example.com/svg"><text>svg</text></a></svg>
        <div id="host"></div>
      `,
      { linkNonce: "frame-link-nonce" },
    );
    const document = shell.window.document;
    const shadowRoot = document.getElementById("host").attachShadow({
      mode: "open",
    });
    shadowRoot.innerHTML =
      '<a id="inside" href="https://example.com/shadow"><span>go</span></a>';

    const area = document.getElementById("area");
    const svgText = document.querySelector("#svg text");
    const shadowText = shadowRoot.querySelector("span");
    expect(shell.clickTrusted(area)).toBe(true);
    expect(shell.clickTrusted(svgText)).toBe(true);
    expect(shell.clickTrusted(shadowText)).toBe(true);
    expect(shell.clickTrusted(shadowText, { button: 1 }, "auxclick")).toBe(
      true,
    );
    expect(shell.clickTrusted(shadowText, { button: 2 }, "auxclick")).toBe(
      false,
    );
  });

  it("routes links after stopImmediatePropagation", async () => {
    const shell = loadShell(
      '<div id="card"><a href="https://example.com/card"><span>go</span></a></div>',
      { linkNonce: "frame-link-nonce" },
    );
    let handlerSawDefaultPrevented: boolean | undefined;
    shell.window.document.getElementById("card").onclick = (event) => {
      event.stopImmediatePropagation();
      handlerSawDefaultPrevented = event.defaultPrevented;
    };

    expect(
      shell.clickTrusted(shell.window.document.querySelector("#card a span")),
    ).toBe(true);
    expect(handlerSawDefaultPrevented).toBe(false);
    await new Promise((resolve) => shell.window.setTimeout(resolve, 0));
    expect(shell.linkRequests()).toHaveLength(1);
  });

  it("routes links when a window capture handler stops immediate propagation", async () => {
    const shell = loadShell(
      '<a href="https://example.com/window-capture"><span>go</span></a>',
      { linkNonce: "frame-link-nonce" },
    );

    expect(shell.linkHandlerUsesCapture("click")).toBe(true);
    expect(
      shell.clickTrustedAfterWindowCaptureStop(
        shell.window.document.querySelector("a span"),
      ),
    ).toBe(true);

    await new Promise((resolve) => shell.window.setTimeout(resolve, 0));
    expect(shell.linkRequests()).toMatchObject([
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://example.com/window-capture",
      },
    ]);
  });

  it("routes links after stopPropagation", async () => {
    const shell = loadShell(
      '<div id="card"><a href="https://example.com/card"><span>go</span></a></div>',
      { linkNonce: "frame-link-nonce" },
    );
    let handlerSawDefaultPrevented: boolean | undefined;
    shell.window.document.getElementById("card").onclick = (event) => {
      event.stopPropagation();
      handlerSawDefaultPrevented = event.defaultPrevented;
    };

    expect(
      shell.clickTrusted(shell.window.document.querySelector("#card a span")),
    ).toBe(true);
    expect(handlerSawDefaultPrevented).toBe(false);
    await new Promise((resolve) => shell.window.setTimeout(resolve, 0));
    expect(shell.linkRequests()).toMatchObject([
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://example.com/card",
      },
    ]);
  });

  it("honors extension preventDefault handlers before routing links", () => {
    const shell = loadShell(
      `<a id="external" href="https://example.com/prevented" target="_blank"
          onclick="window.externalSawDefaultPrevented = event.defaultPrevented; event.preventDefault()">external</a>
        <a id="sameOrigin" href="/dashboard/prevented"
          onclick="window.sameOriginSawDefaultPrevented = event.defaultPrevented; event.preventDefault()">same origin</a>`,
      { linkNonce: "frame-link-nonce" },
    );
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.clickTrusted($("external"))).toBe(true);
    expect(shell.clickTrusted($("sameOrigin"))).toBe(true);
    expect((shell.window as any).externalSawDefaultPrevented).toBe(false);
    expect((shell.window as any).sameOriginSawDefaultPrevented).toBe(false);
    expect(shell.linkRequests()).toEqual([]);
    expect(shell.sameOriginNavigations()).toEqual([]);
  });

  it("routes trusted link activation from closed shadow roots", () => {
    const shell = loadShell(`<div id="host"></div>`, {
      linkNonce: "frame-link-nonce",
    });
    const host = shell.window.document.getElementById("host");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML =
      '<a href="https://example.com/closed-shadow"><span>go</span></a>';

    expect(shell.clickTrustedInClosedRoot(root.querySelector("span"))).toBe(
      true,
    );
    expect(
      shell.clickTrustedInClosedRoot(
        root.querySelector("span"),
        { button: 1 },
        "auxclick",
      ),
    ).toBe(true);
  });

  it("preserves unmarked fragments and restores the app fragment beside a host nonce", () => {
    const appFragment = loadShell(
      '<a href="https://example.com/metric">metric</a>',
      {
        url: "https://analytics.example/_agent-native/extensions/ext/render#metric-chart",
      },
    );
    expect(appFragment.window.location.hash).toBe("#metric-chart");
    expect(
      appFragment.clickTrusted(appFragment.window.document.querySelector("a")),
    ).toBe(false);

    const providedNonce = "a".repeat(48);
    const unmarkedHash = loadShell(
      '<a href="https://example.com/metric">metric</a>',
      {
        url: `https://analytics.example/_agent-native/extensions/ext/render#${providedNonce}`,
      },
    );
    expect(unmarkedHash.window.location.hash).toBe(`#${providedNonce}`);
    expect(
      unmarkedHash.clickTrusted(
        unmarkedHash.window.document.querySelector("a"),
      ),
    ).toBe(false);

    const encodedAppFragment = encodeURIComponent("metric%20chart");
    const nonceFrame = loadShell(
      '<a href="https://example.com/metric">metric</a>',
      {
        url: `https://analytics.example/_agent-native/extensions/ext/render?view=summary#__agent_native_link_nonce=${providedNonce}&__agent_native_app_fragment=${encodedAppFragment}`,
      },
    );
    expect(nonceFrame.window.location.search).toBe("?view=summary");
    expect(nonceFrame.window.location.hash).toBe("#metric%20chart");
    expect(
      nonceFrame.clickTrusted(nonceFrame.window.document.querySelector("a")),
    ).toBe(true);

    const attributeNonce = loadShell(
      '<a href="https://example.com/metric">metric</a>',
      {
        linkNonce: "explicit-link-nonce",
        url: "https://analytics.example/_agent-native/extensions/ext/render#metric-chart",
      },
    );
    expect(attributeNonce.window.location.hash).toBe("#metric-chart");
    expect(
      attributeNonce.clickTrusted(
        attributeNonce.window.document.querySelector("a"),
      ),
    ).toBe(true);
  });

  it("routes same-origin links in the host or a new context", () => {
    const shell = loadShell(
      `<a id="sameOrigin" href="https://analytics.example/same-origin">same origin</a>
        <a id="sameOriginBlank" href="https://analytics.example/new-tab" target="_blank">same origin blank</a>
        <a id="sameOriginNamed" href="https://analytics.example/report" target="report">same origin named</a>
        <a id="sameOriginSelf" href="https://analytics.example/self" target="_self">same origin self</a>`,
      { linkNonce: "frame-link-nonce" },
    );
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.clickTrusted($("sameOrigin"))).toBe(true);
    expect(shell.clickTrusted($("sameOriginSelf"))).toBe(true);
    expect(shell.clickTrusted($("sameOriginBlank"))).toBe(true);
    expect(shell.clickTrusted($("sameOriginNamed"))).toBe(true);
    expect(shell.clickTrusted($("sameOrigin"), { metaKey: true })).toBe(true);
    expect(shell.clickTrusted($("sameOrigin"), { ctrlKey: true })).toBe(true);
    expect(shell.clickTrusted($("sameOrigin"), { shiftKey: true })).toBe(true);
    expect(shell.clickTrusted($("sameOrigin"), { button: 1 }, "auxclick")).toBe(
      true,
    );
    expect(shell.clickTrusted($("sameOrigin"), { button: 2 }, "auxclick")).toBe(
      false,
    );
    expect(shell.clickTrusted($("sameOrigin"), { altKey: true })).toBe(false);

    const baseTarget = loadShell(
      `<base target="_blank">
        <a id="inherits" href="/base-target">inherits target</a>
        <a id="empty" href="/empty" target="">explicit empty target</a>`,
      { linkNonce: "frame-link-nonce" },
    );
    expect(
      baseTarget.clickTrusted(
        baseTarget.window.document.getElementById("inherits"),
      ),
    ).toBe(true);
    expect(
      baseTarget.clickTrusted(
        baseTarget.window.document.getElementById("empty"),
      ),
    ).toBe(true);
  });

  it("routes cross-origin download links through the host", () => {
    const shell = loadShell(
      `<a id="sameOrigin" href="/export.csv" download>same-origin download</a>
        <a id="external" href="https://files.example.com/export.csv" download>external download</a>`,
      { linkNonce: "frame-link-nonce" },
    );
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.clickTrusted($("sameOrigin"))).toBe(false);
    expect(shell.clickTrusted($("external"))).toBe(true);
    expect(shell.sameOriginNavigations()).toEqual([]);
    expect(shell.linkRequests()).toEqual([
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://files.example.com/export.csv",
      },
    ]);
  });

  it("reconnects link routing after a BFCache restore", () => {
    const shell = loadShell(
      `<a id="external" href="https://example.com/after-restore">external</a>`,
      { linkNonce: "frame-link-nonce" },
    );
    const initialHelloCount = shell.linkChannelHellos().length;
    expect(initialHelloCount).toBeGreaterThan(0);

    const pagehide = new shell.window.Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: true });
    shell.window.dispatchEvent(pagehide);

    const pageshow = new shell.window.Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    shell.window.dispatchEvent(pageshow);

    expect(shell.linkChannelHellos().length).toBeGreaterThan(initialHelloCount);
    expect(
      shell.clickTrusted(shell.window.document.getElementById("external")),
    ).toBe(true);
    expect(shell.linkRequests()).toEqual([
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://example.com/after-restore",
      },
    ]);
  });

  it("routes same-origin self, parent, and top navigation through the host", () => {
    const shell = loadShell(
      `<a id="default" href="/dashboard/next">default target</a>
        <a id="self" href="/dashboard/self" target="_self">self</a>
        <a id="parent" href="/dashboard/parent" target="_parent">parent</a>
        <a id="top" href="/dashboard/top" target="_top">top</a>
        <a id="fragment" href="#metric-chart">fragment</a>`,
      { linkNonce: "frame-link-nonce" },
    );
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.clickTrusted($("default"))).toBe(true);
    expect(shell.clickTrusted($("self"))).toBe(true);
    expect(shell.clickTrusted($("parent"))).toBe(true);
    expect(shell.clickTrusted($("top"))).toBe(true);
    expect(shell.clickTrusted($("fragment"))).toBe(false);
    expect(shell.sameOriginNavigations()).toEqual([
      {
        type: EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE,
        href: "https://analytics.example/dashboard/next",
        target: "_self",
      },
      {
        type: EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE,
        href: "https://analytics.example/dashboard/self",
        target: "_self",
      },
      {
        type: EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE,
        href: "https://analytics.example/dashboard/parent",
        target: "_parent",
      },
      {
        type: EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE,
        href: "https://analytics.example/dashboard/top",
        target: "_top",
      },
    ]);
    expect(shell.linkRequests()).toEqual([]);
  });

  it("keeps a delayed nonce bridge READY alive through all HELLO retries.", async () => {
    const shell = loadShell(
      '<a id="external" href="https://example.com/metric">external</a>',
      {
        linkNonce: "frame-link-nonce",
        linkChannelReady: false,
        hostParent: true,
      },
    );
    const link = shell.window.document.getElementById("external");
    expect(shell.clickTrusted(link)).toBe(true);
    expect(shell.fallbackLinkRequests()).toHaveLength(1);
    await new Promise((resolve) => shell.window.setTimeout(resolve, 550));

    const [acceptedPort, retryPort] = shell.linkChannelPorts();
    expect(shell.linkChannelHellos().map((hello) => hello.nonce)).toEqual([
      "frame-link-nonce",
      "frame-link-nonce",
    ]);
    expect(acceptedPort.closed).toBe(false);
    shell.deliverLinkChannelReady(acceptedPort);
    expect(acceptedPort.closed).toBe(false);
    expect(retryPort.closed).toBe(true);
    expect(shell.clickTrusted(link)).toBe(true);
    expect(shell.linkRequests()).toHaveLength(1);
  });

  it("marks only explicit new-context activations in routed host requests", () => {
    const shell = loadShell(
      `<a id="external" href="https://example.com/plain">external</a>
        <a id="externalBlank" href="https://example.com/blank" target="_blank">external blank</a>
        <a id="externalModified" href="https://example.com/modified">modified</a>
        <a id="sameOrigin" href="https://analytics.example/plain">same origin</a>
        <a id="sameOriginBlank" href="https://analytics.example/blank" target="_blank">same origin blank</a>
        <a id="sameOriginNamed" href="https://analytics.example/report" target="report">same origin named</a>
        <a id="externalAlt" href="https://example.com/save-link">external alt</a>
        <a id="sameOriginMiddle" href="https://analytics.example/middle">same origin middle</a>`,
      { linkNonce: "frame-link-nonce" },
    );
    const $ = (id: string) => shell.window.document.getElementById(id);
    shell.window.dispatchEvent(new shell.window.Event("load"));

    expect(shell.clickTrusted($("external"))).toBe(true);
    expect(shell.clickTrusted($("externalBlank"))).toBe(true);
    expect(shell.clickTrusted($("externalModified"), { metaKey: true })).toBe(
      true,
    );
    expect(shell.clickTrusted($("sameOrigin"))).toBe(true);
    expect(shell.clickTrusted($("externalAlt"), { altKey: true })).toBe(false);
    expect(shell.clickTrusted($("sameOriginBlank"))).toBe(true);
    expect(shell.clickTrusted($("sameOriginNamed"))).toBe(true);
    expect(
      shell.clickTrusted($("sameOriginMiddle"), { button: 1 }, "auxclick"),
    ).toBe(true);

    expect(shell.linkRequests()).toEqual([
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://example.com/plain",
      },
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://example.com/blank",
        openInNewContext: true,
      },
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://example.com/modified",
        openInNewContext: true,
      },
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://analytics.example/blank",
        openInNewContext: true,
      },
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://analytics.example/report",
        openInNewContext: true,
      },
      {
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href: "https://analytics.example/middle",
        openInNewContext: true,
      },
    ]);
    expect(shell.sameOriginNavigations()).toEqual([
      {
        type: EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE,
        href: "https://analytics.example/plain",
        target: "_self",
      },
    ]);
  });

  it("hands new-tab web links to the host with the binding's token", () => {
    const shell = loadShell(LINKS);
    shell.ready();
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.clickTrustedLegacy($("blank"))).toBe(true);
    expect(shell.clickTrustedLegacy($("upper"))).toBe(true);
    expect(shell.clickTrustedLegacy($("plain"), { metaKey: true })).toBe(true);
    expect(shell.clickTrustedLegacy($("plain"), { ctrlKey: true })).toBe(true);
    expect(shell.clickTrustedLegacy($("plain"), { shiftKey: true })).toBe(true);
    expect(
      shell.clickTrustedLegacy($("plain"), { button: 1 }, "auxclick"),
    ).toBe(true);

    expect(shell.opened()).toEqual([
      {
        type: OPEN_URL,
        url: "https://app.hubspot.com/x",
        token: shell.binding.openUrlToken,
      },
      {
        type: OPEN_URL,
        url: "https://app.hubspot.com/upper",
        token: shell.binding.openUrlToken,
      },
      {
        type: OPEN_URL,
        url: "https://example.com/plain",
        token: shell.binding.openUrlToken,
      },
      {
        type: OPEN_URL,
        url: "https://example.com/plain",
        token: shell.binding.openUrlToken,
      },
      {
        type: OPEN_URL,
        url: "https://example.com/plain",
        token: shell.binding.openUrlToken,
      },
      {
        type: OPEN_URL,
        url: "https://example.com/plain",
        token: shell.binding.openUrlToken,
      },
    ]);
  });

  it("requires a trusted primary or middle activation in the legacy router", () => {
    const shell = loadShell(
      `<a id="blank" href="https://example.com/blank" target="_blank">blank</a>`,
    );
    const blank = shell.window.document.getElementById("blank");
    shell.ready();

    expect(shell.click(blank)).toBe(false);
    expect(shell.opened()).toEqual([]);
    expect(shell.clickTrustedLegacy(blank)).toBe(true);
    expect(shell.clickTrustedLegacy(blank, { button: 1 }, "auxclick")).toBe(
      true,
    );
    expect(shell.clickTrustedLegacy(blank, { button: 2 }, "auxclick")).toBe(
      false,
    );
    expect(shell.clickTrustedLegacy(blank, { button: 2 })).toBe(false);
    expect(shell.opened().map((message) => message.url)).toEqual([
      "https://example.com/blank",
      "https://example.com/blank",
    ]);
  });

  it("disables the legacy open-url router when the nonce bridge is enabled", () => {
    const shell = loadShell(
      `<a id="blank" href="https://example.com/blank" target="_blank">blank</a>`,
      { linkNonce: "frame-link-nonce" },
    );
    shell.ready();

    expect(
      shell.clickTrustedLegacy(shell.window.document.getElementById("blank")),
    ).toBe(false);
    expect(shell.opened()).toEqual([]);
  });

  it("leaves same-tab, named, download, non-web and already-handled links native", () => {
    const shell = loadShell(LINKS);
    shell.ready();
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.click($("plain"))).toBe(false);
    expect(shell.click($("self"))).toBe(false);
    expect(shell.click($("top"))).toBe(false);
    expect(shell.click($("named"))).toBe(false);
    expect(shell.click($("download"))).toBe(false);
    expect(shell.click($("mailto"))).toBe(false);
    expect(shell.click($("js"))).toBe(false);
    expect(shell.click($("svgSelf"))).toBe(false);
    expect(shell.click($("blank"), { altKey: true })).toBe(false);
    expect(shell.click($("plain"), { button: 2 }, "auxclick")).toBe(false);
    // Its own handler prevented the default, so the shell stays out of it.
    expect(shell.click($("prevented"))).toBe(true);

    expect(shell.opened()).toEqual([]);
  });

  it("routes SVG links, resolving href and xlink:href against the base URL", () => {
    const shell = loadShell(LINKS);
    shell.ready();
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.clickTrustedLegacy($("svg").querySelector("text"))).toBe(true);
    expect(shell.clickTrustedLegacy($("xlink"))).toBe(true);
    expect(shell.opened().map((message) => message.url)).toEqual([
      "https://example.com/svg",
      "https://analytics.example/chart/1",
    ]);
  });

  it("uses <base target> only when the link has no target attribute", () => {
    const shell = loadShell(`
      <base target="_blank">
      <a id="inherits" href="/relative">inherits</a>
      <a id="empty" href="https://example.com/empty" target="">empty</a>
    `);
    shell.ready();
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.clickTrustedLegacy($("inherits"))).toBe(true);
    expect(shell.clickTrustedLegacy($("empty"))).toBe(false);
    expect(shell.opened().map((message) => message.url)).toEqual([
      "https://analytics.example/relative",
    ]);
  });

  it("routes links inside an open shadow root", () => {
    const shell = loadShell(`<div id="host"></div>`);
    shell.ready();
    const host = shell.window.document.getElementById("host");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<a id="inside" href="https://example.com/shadow" target="_blank"><span>go</span></a>';

    expect(shell.clickTrustedLegacy(root.querySelector("span"))).toBe(true);
    expect(shell.opened().map((message) => message.url)).toEqual([
      "https://example.com/shadow",
    ]);
  });

  it("never touches window.open", () => {
    const shell = loadShell(LINKS);
    const nativeOpen = shell.window.open;
    shell.ready();

    expect(shell.window.open).toBe(nativeOpen);
  });

  it("stays native without secure randomness", () => {
    const shell = loadShell(LINKS, { secureRandom: false });
    shell.ready();

    expect(shell.binding.openUrlToken).toBe("");
    expect(shell.click(shell.window.document.getElementById("blank"))).toBe(
      false,
    );
    expect(shell.opened()).toEqual([]);
  });
});
