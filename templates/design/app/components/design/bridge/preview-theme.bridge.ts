/**
 * Preview theme bridge — injected into every canvas iframe.
 *
 * Interact mode previews a design in Light or Dark. The browser's real
 * `prefers-color-scheme` cannot be changed per iframe, so this bridge emulates
 * it inside the preview document:
 *   - `@media (prefers-color-scheme: …)` rules in every stylesheet are
 *     rewritten to always or never match (originals are kept and restored),
 *   - `window.matchMedia` answers the forced scheme and notifies listeners,
 *   - `color-scheme` is set on <html>, and the `dark` class plus any
 *     `data-theme`-style attribute the design's CSS keys on are toggled.
 *
 * It also reports whether the design has any dark styles at all, so the
 * editor can tell a Dark pick that would change nothing from one that would.
 *
 * Protocol (parent → iframe):
 *   { type: 'agent-native:preview-color-scheme', scheme: 'light'|'dark'|null }
 *     null removes every override and returns to the browser's own scheme.
 *
 * Protocol (iframe → parent):
 *   { type: 'agent-native:preview-theme-state',
 *     scheme: 'light'|'dark'|null,   // what is applied right now
 *     darkStyles: 'yes'|'no'|'unknown' }
 *   Sent on load, after every change, and when the stylesheets change.
 *
 * A markup preview starts in the scheme named by its `window.name` (set on the
 * iframe element, so it exists before the first script runs); the marker is
 * cleared once read.
 *
 * Rules:
 *   • Wrap everything in a self-executing IIFE.
 */
import {
  detectDarkStyleSupport,
  findDarkAttributeNames,
  isFontStylesheetHref,
  mentionsPrefersColorScheme,
  parsePreviewColorSchemeFrameName,
  rewritePrefersColorSchemeMedia,
  type DarkStyleSupport,
  type PreviewColorScheme,
} from "../../../../shared/preview-color-scheme";

(function () {
  if ((window as { __anPreviewTheme?: unknown }).__anPreviewTheme) return;
  (window as { __anPreviewTheme?: unknown }).__anPreviewTheme = true;

  var COLOR_SCHEME_MESSAGE = "agent-native:preview-color-scheme";
  var STATE_MESSAGE = "agent-native:preview-theme-state";
  var SCAN_CHAR_BUDGET = 2000000;
  var MAX_CLASS_SAMPLES = 50;

  var forced: PreviewColorScheme | null = parsePreviewColorSchemeFrameName(
    window.name,
  );
  if (forced) window.name = "";
  var originalMedia = new WeakMap<MediaList, string>();
  var rootBefore: {
    colorScheme: string;
    hadDark: boolean;
    attributes: Record<string, string | null>;
  } | null = null;
  var darkAttributeNames: string[] = [];
  var lastReport = "";

  var nativeMatchMedia = window.matchMedia
    ? window.matchMedia.bind(window)
    : null;

  // ── Media-rule rewriting ────────────────────────────────────────────────
  function visitMediaList(list: MediaList): void {
    if (forced) {
      var original = originalMedia.get(list);
      var current = list.mediaText;
      var rewritten = rewritePrefersColorSchemeMedia(
        original !== undefined ? original : current,
        forced,
      );
      if (rewritten === null) return;
      if (original === undefined) originalMedia.set(list, current);
      if (rewritten !== current) list.mediaText = rewritten;
      return;
    }
    var saved = originalMedia.get(list);
    if (saved === undefined) return;
    if (list.mediaText !== saved) list.mediaText = saved;
    originalMedia.delete(list);
  }

  function visitRules(rules: CSSRuleList): void {
    for (var index = 0; index < rules.length; index += 1) {
      var rule = rules[index] as CSSRule & {
        media?: MediaList;
        styleSheet?: CSSStyleSheet | null;
        cssRules?: CSSRuleList;
      };
      if (rule.media && typeof rule.media.mediaText === "string") {
        visitMediaList(rule.media);
      }
      if (rule.styleSheet) visitSheet(rule.styleSheet);
      else if (rule.cssRules) visitRules(rule.cssRules);
    }
  }

  // A cross-origin sheet throws on `cssRules`. This marker is not an empty
  // list, so callers count it as unreadable instead of as a sheet with no rules.
  var UNREADABLE = { unreadable: true } as const;

  function readRules(sheet: CSSStyleSheet): CSSRuleList | typeof UNREADABLE {
    try {
      return sheet.cssRules;
    } catch (_err) {
      return UNREADABLE;
    }
  }

  function isUnreadable(
    rules: CSSRuleList | typeof UNREADABLE,
  ): rules is typeof UNREADABLE {
    return rules === UNREADABLE;
  }

  function visitSheet(sheet: CSSStyleSheet): void {
    if (sheet.media) visitMediaList(sheet.media);
    var rules = readRules(sheet);
    if (!isUnreadable(rules)) visitRules(rules);
  }

  function allSheets(): CSSStyleSheet[] {
    var sheets: CSSStyleSheet[] = Array.prototype.slice.call(
      document.styleSheets,
    );
    var adopted = (document as { adoptedStyleSheets?: CSSStyleSheet[] })
      .adoptedStyleSheets;
    return adopted
      ? sheets.concat(Array.prototype.slice.call(adopted))
      : sheets;
  }

  function rewriteStylesheets(): void {
    allSheets().forEach(visitSheet);
  }

  // ── Dark-style detection ────────────────────────────────────────────────
  function scanStyles(): {
    css: string[];
    unreadable: number;
    truncated: boolean;
  } {
    var css: string[] = [];
    var unreadable = 0;
    var budget = SCAN_CHAR_BUDGET;
    var truncated = false;

    function push(text: string): void {
      if (budget <= 0) {
        truncated = true;
        return;
      }
      budget -= text.length;
      css.push(text);
    }
    function scanRules(rules: CSSRuleList): void {
      for (var index = 0; index < rules.length && !truncated; index += 1) {
        var rule = rules[index] as CSSRule & {
          media?: MediaList;
          selectorText?: string;
          style?: CSSStyleDeclaration;
          styleSheet?: CSSStyleSheet | null;
          cssRules?: CSSRuleList;
        };
        if (rule.media && typeof rule.media.mediaText === "string") {
          var mediaOriginal = originalMedia.get(rule.media);
          push(
            mediaOriginal !== undefined ? mediaOriginal : rule.media.mediaText,
          );
        }
        if (rule.styleSheet) scanSheet(rule.styleSheet);
        else if (typeof rule.selectorText === "string" && rule.style) {
          push(rule.selectorText + "{" + rule.style.cssText + "}");
        } else if (!rule.cssRules && !rule.media) {
          push(rule.cssText);
        }
        if (!rule.styleSheet && rule.cssRules) scanRules(rule.cssRules);
      }
    }
    function scanSheet(sheet: CSSStyleSheet): void {
      if (sheet.media) {
        var sheetOriginal = originalMedia.get(sheet.media);
        push(
          sheetOriginal !== undefined ? sheetOriginal : sheet.media.mediaText,
        );
      }
      var rules = readRules(sheet);
      if (isUnreadable(rules)) {
        if (!isFontStylesheetHref(sheet.href)) unreadable += 1;
        return;
      }
      scanRules(rules);
    }
    allSheets().forEach(scanSheet);
    return { css: css, unreadable: unreadable, truncated: truncated };
  }

  function classSample(): string {
    var nodes = document.querySelectorAll('[class*="dark:"]');
    var parts: string[] = [];
    for (
      var index = 0;
      index < nodes.length && index < MAX_CLASS_SAMPLES;
      index += 1
    ) {
      parts.push('class="' + (nodes[index]!.getAttribute("class") || "") + '"');
    }
    return parts.join(" ");
  }

  function measureDarkStyles(): DarkStyleSupport {
    var scan = scanStyles();
    darkAttributeNames = findDarkAttributeNames(scan.css);
    var support = detectDarkStyleSupport({
      css: scan.css,
      html: classSample(),
      unreadableStylesheets: scan.unreadable,
      // Sheets that have not loaded yet are not in document.styleSheets, so
      // an empty result before the document settles proves nothing.
      truncated: scan.truncated || document.readyState !== "complete",
    }).support;
    return support;
  }

  // ── <html> state ────────────────────────────────────────────────────────
  function applyRoot(): void {
    var root = document.documentElement;
    if (!root) return;
    if (!forced) {
      if (!rootBefore) return;
      if (rootBefore.colorScheme) {
        root.style.setProperty("color-scheme", rootBefore.colorScheme);
      } else {
        root.style.removeProperty("color-scheme");
      }
      root.classList.toggle("dark", rootBefore.hadDark);
      Object.keys(rootBefore.attributes).forEach(function (name) {
        var before = rootBefore!.attributes[name];
        if (before === null) root.removeAttribute(name);
        else root.setAttribute(name, before!);
      });
      if (!root.getAttribute("style")) root.removeAttribute("style");
      rootBefore = null;
      return;
    }
    if (!rootBefore) {
      rootBefore = {
        colorScheme: root.style.getPropertyValue("color-scheme"),
        hadDark: root.classList.contains("dark"),
        attributes: {},
      };
    }
    root.style.setProperty("color-scheme", forced);
    root.classList.toggle("dark", forced === "dark");
    var names = darkAttributeNames.slice();
    ["data-theme"].forEach(function (name) {
      var value = root.getAttribute(name);
      if (
        (value === "light" || value === "dark") &&
        names.indexOf(name) === -1
      ) {
        names.push(name);
      }
    });
    names.forEach(function (name) {
      if (!(name in rootBefore!.attributes)) {
        rootBefore!.attributes[name] = root.getAttribute(name);
      }
      root.setAttribute(name, forced!);
    });
  }

  // ── matchMedia ──────────────────────────────────────────────────────────
  var watchers: Array<WeakRef<ForcedMediaQueryList>> = [];

  function evaluate(query: string): boolean {
    if (!nativeMatchMedia) return false;
    var effective =
      forced === null
        ? query
        : (rewritePrefersColorSchemeMedia(query, forced) ?? query);
    return nativeMatchMedia(effective).matches;
  }

  class ForcedMediaQueryList extends EventTarget {
    media: string;
    onchange: ((event: MediaQueryListEvent) => unknown) | null = null;
    private lastMatches: boolean;
    private nativeList: MediaQueryList | null;
    private nativeAttached = false;

    constructor(query: string) {
      super();
      this.media = query;
      this.lastMatches = evaluate(query);
      this.nativeList = nativeMatchMedia ? nativeMatchMedia(query) : null;
    }

    get matches(): boolean {
      return evaluate(this.media);
    }

    addEventListener(
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      super.addEventListener(type, callback, options);
      if (type !== "change" || this.nativeAttached) return;
      this.nativeAttached = true;
      watchers.push(new WeakRef(this));
      if (this.nativeList) {
        this.nativeList.addEventListener("change", () => {
          if (forced === null) this.refresh();
        });
      }
    }

    addListener(callback: EventListenerOrEventListenerObject | null): void {
      this.addEventListener("change", callback);
    }

    removeListener(callback: EventListenerOrEventListenerObject | null): void {
      this.removeEventListener("change", callback);
    }

    refresh(): void {
      var matches = this.matches;
      if (matches === this.lastMatches) return;
      this.lastMatches = matches;
      var event = new MediaQueryListEvent("change", {
        matches: matches,
        media: this.media,
      });
      if (this.onchange) this.onchange(event);
      this.dispatchEvent(event);
    }
  }

  function installMatchMedia(): void {
    if (!nativeMatchMedia) return;
    window.matchMedia = function (query: string): MediaQueryList {
      if (!mentionsPrefersColorScheme(query)) {
        return (nativeMatchMedia as (q: string) => MediaQueryList)(query);
      }
      return new ForcedMediaQueryList(query) as unknown as MediaQueryList;
    };
  }

  function notifyMatchMedia(): void {
    watchers = watchers.filter(function (ref) {
      var list = ref.deref();
      if (list) list.refresh();
      return Boolean(list);
    });
  }

  // ── Keeping up with the document ───────────────────────────────────────
  var pending = 0;
  function schedule(): void {
    if (pending) return;
    pending = window.setTimeout(function () {
      pending = 0;
      sync();
    }, 60);
  }

  function isStyleMutation(record: MutationRecord): boolean {
    function styleNode(node: Node): boolean {
      return (
        node.nodeType === 1 &&
        ((node as Element).tagName === "STYLE" ||
          (node as Element).tagName === "LINK")
      );
    }
    if (record.type === "characterData") {
      return Boolean(record.target.parentElement?.tagName === "STYLE");
    }
    if (record.target.nodeType === 1 && styleNode(record.target)) return true;
    for (var i = 0; i < record.addedNodes.length; i += 1) {
      if (styleNode(record.addedNodes[i]!)) return true;
    }
    for (var j = 0; j < record.removedNodes.length; j += 1) {
      if (styleNode(record.removedNodes[j]!)) return true;
    }
    return false;
  }

  var observer: MutationObserver | null = null;
  function observe(): void {
    if (observer || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(function (records) {
      if (records.some(isStyleMutation)) schedule();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  type InsertRuleHost = { insertRule: (...args: unknown[]) => number };
  function patchInsertRule(prototype: object | undefined): void {
    var host = prototype as InsertRuleHost | undefined;
    if (!host || typeof host.insertRule !== "function") return;
    var original = host.insertRule;
    host.insertRule = function (this: unknown, ...args: unknown[]): number {
      var result = original.apply(this, args);
      if (forced) schedule();
      return result;
    };
  }

  function report(): void {
    var message = {
      type: STATE_MESSAGE,
      scheme: forced,
      darkStyles: darkStyles,
    };
    var serialized = JSON.stringify(message);
    if (serialized === lastReport) return;
    lastReport = serialized;
    try {
      window.parent.postMessage(message, "*");
    } catch (_err) {
      // The report did not land, so the next sync must send it again.
      lastReport = "";
    }
  }

  var darkStyles: DarkStyleSupport = "unknown";
  function sync(): void {
    rewriteStylesheets();
    darkStyles = measureDarkStyles();
    applyRoot();
    notifyMatchMedia();
    report();
  }

  function setScheme(next: PreviewColorScheme | null): void {
    forced = next;
    if (next) observe();
    sync();
  }

  window.addEventListener("message", function (event: MessageEvent) {
    if (event.source !== window.parent) return;
    var data = event.data as { type?: unknown; scheme?: unknown } | null;
    if (!data || data.type !== COLOR_SCHEME_MESSAGE) return;
    setScheme(
      data.scheme === "light" || data.scheme === "dark" ? data.scheme : null,
    );
  });

  installMatchMedia();
  patchInsertRule(
    typeof CSSStyleSheet === "undefined" ? undefined : CSSStyleSheet.prototype,
  );
  patchInsertRule(
    typeof CSSGroupingRule === "undefined"
      ? undefined
      : CSSGroupingRule.prototype,
  );
  if (forced) observe();
  sync();
  // Late sheets (Tailwind's runtime build, <link>ed CSS) land after this
  // script runs, so measure again once the document settles.
  document.addEventListener("DOMContentLoaded", schedule);
  window.addEventListener("load", schedule);
  document.addEventListener("load", schedule, true);
  window.setTimeout(schedule, 400);
  window.setTimeout(schedule, 1600);
})();
