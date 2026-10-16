// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { previewThemeBridgeScript } from "../../../../.generated/bridge/preview-theme.generated";
import { previewColorSchemeFrameName } from "../../../../shared/preview-color-scheme";

const STATE = "agent-native:preview-theme-state";
const SCHEME = "agent-native:preview-color-scheme";

function installBridge(initial: "light" | "dark" | null = null) {
  window.name = previewColorSchemeFrameName(initial) ?? "";
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

function mediaTexts(): string[] {
  const texts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      const media = (rule as CSSMediaRule).media;
      if (media) texts.push(media.mediaText);
    }
  }
  return texts;
}

const originalMatchMedia = window.matchMedia;
const originalInsertRule = CSSStyleSheet.prototype.insertRule;
const originalGroupingInsertRule = CSSGroupingRule.prototype.insertRule;

type TrackedListener = [
  EventTarget,
  string,
  EventListenerOrEventListenerObject,
  boolean | AddEventListenerOptions | undefined,
];

describe("preview theme bridge", () => {
  let posted: Array<Record<string, unknown>>;
  let listeners: TrackedListener[];
  let observers: MutationObserver[];

  // The bridge settles on timers (a 60ms resync, then passes at 400ms and
  // 1600ms) and keeps a MutationObserver and document listeners for the life of
  // its page. Here the page is the test file's shared document, which outlives
  // each test and, if the bridge's timers are real, is gone by the time they
  // fire: `document is not defined`, after every test has passed.
  function trackListeners(target: EventTarget) {
    const addEventListener = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation(
      (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (listener) listeners.push([target, type, listener, options]);
        addEventListener(type, listener, options);
      },
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    listeners = [];
    observers = [];
    trackListeners(window);
    trackListeners(document);
    const NativeMutationObserver = window.MutationObserver;
    vi.stubGlobal(
      "MutationObserver",
      class extends NativeMutationObserver {
        constructor(callback: MutationCallback) {
          super(callback);
          observers.push(this);
        }
      },
    );
    document.head.innerHTML = "";
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme");
    delete (window as { __anPreviewTheme?: unknown }).__anPreviewTheme;
    vi.spyOn(window.parent, "postMessage").mockImplementation(
      (message: unknown) => {
        posted.push(message as Record<string, unknown>);
      },
    );
  });

  afterEach(() => {
    // The bridge runs once per document; a test file shares one document, so
    // drop each test's instance before the next installs its own.
    for (const observer of observers) observer.disconnect();
    for (const [target, type, listener, options] of listeners) {
      target.removeEventListener(type, listener, options);
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
    CSSStyleSheet.prototype.insertRule = originalInsertRule;
    CSSGroupingRule.prototype.insertRule = originalGroupingInsertRule;
  });

  function addStyle(css: string) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  it("rewrites prefers-color-scheme rules to the forced scheme and restores them", () => {
    addStyle(
      "@media (prefers-color-scheme: dark){body{background:#000}}" +
        "@media (prefers-color-scheme: light){body{background:#fff}}",
    );
    installBridge();
    expect(mediaTexts()).toEqual([
      "(prefers-color-scheme: dark)",
      "(prefers-color-scheme: light)",
    ]);

    sendScheme("dark");
    expect(mediaTexts()).toEqual(["all", "not all"]);

    sendScheme("light");
    expect(mediaTexts()).toEqual(["not all", "all"]);

    sendScheme(null);
    expect(mediaTexts()).toEqual([
      "(prefers-color-scheme: dark)",
      "(prefers-color-scheme: light)",
    ]);
  });

  it("starts in the scheme the frame's name asks for, then clears the marker", () => {
    addStyle("@media (prefers-color-scheme: dark){body{background:#000}}");
    installBridge("dark");
    expect(mediaTexts()).toEqual(["all"]);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.name).toBe("");
  });

  it("leaves a window name that is not the marker alone", () => {
    window.name = "checkout-popup";
    new Function(previewThemeBridgeScript)();
    expect(window.name).toBe("checkout-popup");
    expect(
      document.documentElement.style.getPropertyValue("color-scheme"),
    ).toBe("");
  });

  it("leaves unrelated media rules alone", () => {
    addStyle("@media (min-width: 600px){body{margin:0}}");
    installBridge();
    sendScheme("dark");
    expect(mediaTexts()).toEqual(["(min-width: 600px)"]);
  });

  it("sets color-scheme and toggles the dark class, then puts both back", () => {
    document.documentElement.classList.add("keep");
    installBridge();

    sendScheme("dark");
    const root = document.documentElement;
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("keep")).toBe(true);

    sendScheme("light");
    expect(root.style.getPropertyValue("color-scheme")).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);

    sendScheme(null);
    expect(root.style.getPropertyValue("color-scheme")).toBe("");
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.classList.contains("keep")).toBe(true);
  });

  it("keeps a dark class the design shipped with when the override is removed", () => {
    document.documentElement.classList.add("dark");
    installBridge();
    sendScheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    sendScheme(null);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggles the attribute the design's CSS keys a dark theme on", () => {
    addStyle('[data-theme="dark"] body{background:#000}');
    installBridge();
    sendScheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    sendScheme(null);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("answers matchMedia with the forced scheme and notifies listeners", () => {
    installBridge();
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = vi.fn();
    query.addEventListener("change", listener);

    sendScheme("dark");
    expect(query.matches).toBe(true);
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(
      true,
    );
    expect(window.matchMedia("(prefers-color-scheme: light)").matches).toBe(
      false,
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ matches: true });

    sendScheme("light");
    expect(query.matches).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reports the applied scheme and whether the design has dark styles", () => {
    addStyle("@media (prefers-color-scheme: dark){body{background:#000}}");
    installBridge();
    sendScheme("dark");
    const last = posted[posted.length - 1];
    expect(last).toMatchObject({ type: STATE, scheme: "dark" });
    expect(["yes", "unknown"]).toContain(last?.darkStyles);
  });

  it("reports yes from the original media text even while it is rewritten", () => {
    addStyle(".dark body{background:#000}");
    installBridge();
    sendScheme("light");
    expect(posted[posted.length - 1]).toMatchObject({
      scheme: "light",
      darkStyles: "yes",
    });
  });

  it("does not report no before the document has settled", () => {
    addStyle("body{margin:0}");
    installBridge();
    const readyState = vi
      .spyOn(document, "readyState", "get")
      .mockReturnValue("loading");
    sendScheme("dark");
    expect(posted[posted.length - 1]?.darkStyles).toBe("unknown");
    readyState.mockReturnValue("complete");
    sendScheme("light");
    expect(posted[posted.length - 1]?.darkStyles).toBe("no");
  });

  it("measures again once the document settles, on the test's own clock", () => {
    addStyle("body{margin:0}");
    const readyState = vi
      .spyOn(document, "readyState", "get")
      .mockReturnValue("loading");
    installBridge("dark");
    expect(posted[posted.length - 1]).toMatchObject({
      scheme: "dark",
      darkStyles: "unknown",
    });

    readyState.mockReturnValue("complete");
    vi.advanceTimersByTime(500);
    expect(posted[posted.length - 1]).toMatchObject({
      scheme: "dark",
      darkStyles: "no",
    });
  });

  it("installs once per document", () => {
    installBridge();
    const matchMedia = window.matchMedia;
    installBridge();
    expect(window.matchMedia).toBe(matchMedia);
  });
});
