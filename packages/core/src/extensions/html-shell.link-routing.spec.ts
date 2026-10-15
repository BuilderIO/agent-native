// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { buildExtensionHtml } from "./html-shell.js";

// The shell needs a window of its own, at its own URL, running its inline
// scripts. Core doesn't depend on jsdom directly; vitest's jsdom environment
// exposes its instance, and its constructor is the JSDOM class.
const JSDOM = (globalThis as any).jsdom.constructor;

const OPEN_URL = "agent-native-extension-open-url";
const READY = "agent-native-extension-open-url-ready";

// Runs the real extension shell (not the host) in its own jsdom window and checks which link
// clicks it hands to the host. At the top level window.parent === window, so
// the shell's postMessage calls land on the spy installed before parsing.
function loadShell(content: string, options: { secureRandom?: boolean } = {}) {
  const posted: any[] = [];
  const dom = new JSDOM(buildExtensionHtml(content, ":root{}", false, "ext"), {
    runScripts: "dangerously",
    url: "https://analytics.example/_agent-native/extensions/ext/render",
    beforeParse(window: any) {
      (window as any).postMessage = (message: unknown) => posted.push(message);
      if (options.secureRandom === false) {
        Object.defineProperty(window, "crypto", { value: undefined });
      }
    },
  });
  const window = dom.window as any;
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
  };
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
  <svg><a id="svg" href="https://example.com/svg" target="_blank"><text>svg</text></a></svg>
`;

describe("extension shell link routing", () => {
  it("announces a hex token with the binding", () => {
    const shell = loadShell(LINKS);
    expect(shell.binding.openUrlToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it("leaves links native until the host says it opens them", () => {
    const shell = loadShell(LINKS);
    const blank = shell.window.document.getElementById("blank");

    expect(shell.click(blank)).toBe(false);
    expect(shell.opened()).toEqual([]);
  });

  it("hands new-tab web links to the host with the binding's token", () => {
    const shell = loadShell(LINKS);
    shell.ready();
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.click($("blank"))).toBe(true);
    expect(shell.click($("upper"))).toBe(true);
    expect(shell.click($("plain"), { metaKey: true })).toBe(true);
    expect(shell.click($("plain"), { ctrlKey: true })).toBe(true);
    expect(shell.click($("plain"), { shiftKey: true })).toBe(true);
    expect(shell.click($("plain"), { button: 1 }, "auxclick")).toBe(true);

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
    expect(shell.click($("svg"))).toBe(false);
    expect(shell.click($("blank"), { altKey: true })).toBe(false);
    expect(shell.click($("plain"), { button: 2 }, "auxclick")).toBe(false);
    // Its own handler prevented the default, so the shell stays out of it.
    expect(shell.click($("prevented"))).toBe(true);

    expect(shell.opened()).toEqual([]);
  });

  it("uses <base target> only when the link has no target attribute", () => {
    const shell = loadShell(`
      <base target="_blank">
      <a id="inherits" href="/relative">inherits</a>
      <a id="empty" href="https://example.com/empty" target="">empty</a>
    `);
    shell.ready();
    const $ = (id: string) => shell.window.document.getElementById(id);

    expect(shell.click($("inherits"))).toBe(true);
    expect(shell.click($("empty"))).toBe(false);
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

    expect(shell.click(root.querySelector("span"))).toBe(true);
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
