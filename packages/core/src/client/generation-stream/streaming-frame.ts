import {
  morphChildren,
  STREAMED_IN_ATTRIBUTE,
  STREAMED_IN_CSS,
} from "./dom-morph.js";
import { createDraftOutlines } from "./draft-outlines.js";

export const STREAMING_FRAME_MESSAGE = "agent-native:streaming-frame";
/**
 * Marks a placeholder in a skeleton-first build. Preview frames keep its
 * frame drawn until a later edit replaces it.
 */
export const SKELETON_ATTRIBUTE = "data-skeleton";
export const STREAMING_FRAME_READY_MESSAGE =
  "agent-native:streaming-frame-ready";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function frameScript(): string {
  // `__name` covers bundlers that wrap nested functions for keepNames.
  return `(function () {
  var __name = function (fn) { return fn; };
  var morph = ${morphChildren.toString()};
  var createDraftOutlines = ${createDraftOutlines.toString()};
  var outlines = null;
  var MARK = ${JSON.stringify(STREAMED_IN_ATTRIBUTE)};
  var SKELETON = ${JSON.stringify(SKELETON_ATTRIBUTE)};
  // Head nodes are matched by identity, not position: a rewrite upstream can
  // insert a runtime script ahead of nodes already applied.
  var appliedHead = new Map();
  var headKey = function (node, styleIndex) {
    if (node.tagName === "STYLE") return "style:" + styleIndex;
    return node.tagName + ":" + (node.getAttribute("src") || node.getAttribute("href") || node.outerHTML);
  };
  var syncAttributes = function (to, from) {
    Array.prototype.slice.call(to.attributes).forEach(function (attr) {
      // The frame's own markers (the drafting flag) aren't in the stream.
      if (attr.name.indexOf("data-agent-native-") === 0) return;
      if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name);
    });
    Array.prototype.slice.call(from.attributes).forEach(function (attr) {
      if (to.getAttribute(attr.name) !== attr.value) to.setAttribute(attr.name, attr.value);
    });
  };
  var liveScript = function (node) {
    var script = document.createElement("script");
    Array.prototype.slice.call(node.attributes).forEach(function (attr) {
      script.setAttribute(attr.name, attr.value);
    });
    script.text = node.text;
    return script;
  };
  // Scripts follow parse order: a plain head script runs when it arrives (a
  // CSS runtime styles the stream as it lands), while body scripts and
  // deferred ones wait for the whole document, as a browser runs them after
  // parsing. Running Alpine before its data script would leave every x-for
  // item unrendered.
  var completed = false;
  var deferredHead = [];
  var complete = function () {
    completed = true;
    Array.prototype.slice.call(document.body.querySelectorAll("script")).forEach(function (inert) {
      inert.parentNode.replaceChild(liveScript(inert), inert);
    });
    deferredHead.forEach(function (node) { document.head.appendChild(liveScript(node)); });
    deferredHead = [];
  };
  var startDrafting = function (accent) {
    outlines = createDraftOutlines(document.documentElement, accent);
    // A skeleton placeholder keeps a faint frame until the section that
    // replaces it lands, so the layout stays visible between calls.
    var skeletonStyle = document.createElement("style");
    skeletonStyle.textContent = "[" + SKELETON + "]{outline:1px solid color-mix(in srgb, " + accent + " 45%, transparent);outline-offset:-1px}";
    document.documentElement.appendChild(skeletonStyle);
    // Draft whatever lands in the body, from the stream or from a runtime
    // such as Alpine rendering its templates.
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === 1 && node.tagName !== "SCRIPT") outlines.track(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  };
  var apply = function (html, accent) {
    if (!outlines && accent) startDrafting(accent);
    var parsed = new DOMParser().parseFromString(html, "text/html");
    syncAttributes(document.documentElement, parsed.documentElement);
    syncAttributes(document.body, parsed.body);
    var styleIndex = 0;
    Array.prototype.slice.call(parsed.head.children).forEach(function (node) {
      var key = headKey(node, node.tagName === "STYLE" ? styleIndex++ : 0);
      var applied = appliedHead.get(key);
      if (applied) {
        if (node.tagName === "STYLE" && applied.textContent !== node.textContent) {
          applied.textContent = node.textContent;
        }
        return;
      }
      if (node.tagName === "SCRIPT" && !completed && (node.hasAttribute("defer") || node.type === "module")) {
        deferredHead.push(node);
        appliedHead.set(key, node);
        return;
      }
      var copy = node.tagName === "SCRIPT" ? liveScript(node) : document.importNode(node, true);
      document.head.appendChild(copy);
      appliedHead.set(key, copy);
    });
    morph(document.body, parsed.body, MARK);
    if (!completed && html.toLowerCase().indexOf("</html") !== -1) complete();
  };
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.type !== ${JSON.stringify(STREAMING_FRAME_MESSAGE)} || typeof data.html !== "string") return;
    apply(data.html, typeof data.accent === "string" ? data.accent : null);
  });
  window.parent.postMessage({ type: ${JSON.stringify(STREAMING_FRAME_READY_MESSAGE)} }, "*");
})();`;
}

/**
 * The document a sandboxed streaming preview frame loads once. Streamed HTML
 * then arrives through `postStreamingFrameHtml` and is patched in place, so
 * the frame never reloads: a plain head script such as a CSS runtime runs
 * once when it arrives, body and deferred scripts run once the document is
 * complete, and elements already on screen stay put while new ones draft in.
 */
export function buildStreamingFrameDocument(
  options: { baseHref?: string | undefined } = {},
): string {
  const base = options.baseHref
    ? `<base href="${escapeAttribute(options.baseHref)}">`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">${base}<style>${STREAMED_IN_CSS}</style><script>${frameScript()}</script></head><body></body></html>`;
}

/**
 * Sends the document so far. `accent` is a resolved CSS color; when present,
 * each new element's frame is drawn in it before the element fills in.
 */
export function postStreamingFrameHtml(
  frame: HTMLIFrameElement,
  html: string,
  options: { accent?: string | undefined } = {},
): boolean {
  const target = frame.contentWindow;
  if (!target) return false;
  // The frame is sandboxed without same-origin, so its origin is opaque.
  target.postMessage(
    { type: STREAMING_FRAME_MESSAGE, html, accent: options.accent },
    "*",
  );
  return true;
}

export function isStreamingFrameReadyMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
): boolean {
  return (
    !!frame &&
    event.source === frame.contentWindow &&
    (event.data as { type?: unknown } | null)?.type ===
      STREAMING_FRAME_READY_MESSAGE
  );
}
