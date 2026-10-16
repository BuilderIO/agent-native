// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { previewThemeBridgeScript } from "../../../../.generated/bridge/preview-theme.generated";

const SCHEME = "agent-native:preview-color-scheme";

function install() {
  window.name = "";
  new Function(previewThemeBridgeScript)();
}

function sendScheme(scheme: "light" | "dark" | null) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: SCHEME, scheme },
      source: window.parent,
    }),
  );
}

function fakeMediaQueryList(matches: boolean) {
  return {
    matches,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList;
}

const originalMatchMedia = window.matchMedia;
const originalInsertRule = CSSStyleSheet.prototype.insertRule;

describe("preview theme bridge with System (no scheme sent)", () => {
  let listeners: Array<[string, EventListenerOrEventListenerObject]>;
  let documentListeners: string[];

  beforeEach(() => {
    listeners = [];
    documentListeners = [];
    const addEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options) => {
        listeners.push([type, listener]);
        addEventListener(type, listener, options);
      },
    );
    const addDocumentListener = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options) => {
        documentListeners.push(type);
        addDocumentListener(type, listener, options);
      },
    );
    document.head.innerHTML = "";
    const root = document.documentElement;
    root.className = "";
    root.removeAttribute("style");
    root.removeAttribute("data-theme");
    delete (window as { __anPreviewTheme?: unknown }).__anPreviewTheme;
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [type, listener] of listeners) {
      window.removeEventListener(type, listener);
    }
    window.matchMedia = originalMatchMedia;
    CSSStyleSheet.prototype.insertRule = originalInsertRule;
  });

  it("leaves a design authored dark exactly as it shipped", () => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.setAttribute("data-theme", "dark");
    root.style.setProperty("color-scheme", "dark");
    const style = document.createElement("style");
    style.textContent = '[data-theme="dark"] body{background:#000}';
    document.head.appendChild(style);

    install();
    sendScheme(null);

    expect(root.classList.contains("dark")).toBe(true);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
  });

  it("leaves prefers-color-scheme rules unwritten", () => {
    const style = document.createElement("style");
    style.textContent =
      "@media (prefers-color-scheme: dark){body{background:#000}}";
    document.head.appendChild(style);

    install();
    sendScheme(null);

    const media = (document.styleSheets[0]!.cssRules[0] as CSSMediaRule).media
      .mediaText;
    expect(media).toBe("(prefers-color-scheme: dark)");
  });

  it("answers matchMedia with whatever the browser says", () => {
    const answers = new Map([
      ["(prefers-color-scheme: dark)", true],
      ["(prefers-color-scheme: light)", false],
    ]);
    window.matchMedia = ((query: string) =>
      fakeMediaQueryList(answers.get(query) ?? false)) as typeof matchMedia;

    install();

    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(
      true,
    );
    expect(window.matchMedia("(prefers-color-scheme: light)").matches).toBe(
      false,
    );
    answers.set("(prefers-color-scheme: dark)", false);
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(
      false,
    );
  });

  it("puts a dark-authored root back after an explicit Light, once System returns", () => {
    const root = document.documentElement;
    root.classList.add("dark");
    install();

    sendScheme("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.getPropertyValue("color-scheme")).toBe("light");

    sendScheme(null);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.getPropertyValue("color-scheme")).toBe("");
  });

  it("listens only for messages and the document settling, never for input", () => {
    install();

    expect(new Set(listeners.map(([type]) => type))).toEqual(
      new Set(["message", "load"]),
    );
    expect(new Set(documentListeners)).toEqual(
      new Set(["DOMContentLoaded", "load"]),
    );
  });

  it("never cancels or intercepts an event", () => {
    expect(previewThemeBridgeScript).not.toMatch(/preventDefault/);
    expect(previewThemeBridgeScript).not.toMatch(/stopPropagation/);
    expect(previewThemeBridgeScript).not.toMatch(
      /["'](?:click|dblclick|mousedown|mouseup|mousemove|pointer\w+|touch\w+|wheel|scroll|drag\w*|key\w+|contextmenu)["']/,
    );
  });
});
