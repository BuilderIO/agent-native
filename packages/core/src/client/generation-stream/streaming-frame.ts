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

function frameScript(token: string): string {
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
    // A created external script is async by default; parsed ones are not.
    if (script.src) script.async = false;
    return script;
  };
  // Scripts the frame inserts run in document order, as the parser runs
  // them: each waits for the external script before it to load, so an
  // initializer never runs ahead of the library it calls.
  var scriptQueue = Promise.resolve();
  var retiredScripts = new WeakSet();
  var enqueueScript = function (insert) {
    scriptQueue = scriptQueue.then(function () {
      return new Promise(function (resolve) {
        var script = insert();
        if (!script || !script.src) { resolve(); return; }
        script.onload = script.onerror = function () { resolve(); };
      });
    });
  };
  // Scripts follow parse order: a plain head script runs when it arrives (a
  // CSS runtime styles the stream as it lands), while body scripts and
  // deferred ones wait for the whole document, as a browser runs them after
  // parsing. Running Alpine before its data script would leave every x-for
  // item unrendered.
  var completed = false;
  var deferredHead = [];
  // The text each live body script ran with. A later document can add a
  // script or change one; either runs, as it would on a fresh load.
  var ranScripts = new WeakMap();
  // Body nodes the stream put there. A runtime adds others (Alpine renders
  // x-for clones beside their template); later patches leave those alone.
  var streamedNodes = new WeakSet();
  var runBodyScript = function (node, source) {
    var live = liveScript(source);
    // Recorded now, so a patch before the swap does not queue it twice.
    ranScripts.set(node, source.text);
    enqueueScript(function () {
      if (!node.parentNode) return null;
      node.parentNode.replaceChild(live, node);
      streamedNodes.add(live);
      ranScripts.set(live, source.text);
      return live;
    });
  };
  var syncBodyScripts = function (parsedBody) {
    var wanted = parsedBody.querySelectorAll("script");
    Array.prototype.slice.call(document.body.querySelectorAll("script")).filter(function (node) {
      return streamedNodes.has(node);
    }).forEach(function (node, index) {
      var source = wanted[index];
      if (source && ranScripts.get(node) !== source.text) runBodyScript(node, source);
    });
  };
  var complete = function () {
    completed = true;
    Array.prototype.slice.call(document.body.querySelectorAll("script")).forEach(function (inert) {
      runBodyScript(inert, inert);
    });
    deferredHead.forEach(function (node) {
      var live = liveScript(node);
      enqueueScript(function () {
        if (retiredScripts.has(node)) return null;
        document.head.appendChild(live);
        return live;
      });
    });
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
    var seenHead = new Set();
    Array.prototype.slice.call(parsed.head.children).forEach(function (node) {
      var key = headKey(node, node.tagName === "STYLE" ? styleIndex++ : 0);
      seenHead.add(key);
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
      if (node.tagName === "SCRIPT") {
        var script = liveScript(node);
        appliedHead.set(key, script);
        enqueueScript(function () {
          if (retiredScripts.has(script)) return null;
          document.head.appendChild(script);
          return script;
        });
        return;
      }
      var copy = document.importNode(node, true);
      document.head.appendChild(copy);
      appliedHead.set(key, copy);
    });
    // Retire stylesheets and scripts a later document dropped, but only once
    // its head is whole: a head still streaming in would lose styles that
    // simply haven't arrived yet.
    var lower = html.toLowerCase();
    if (lower.indexOf("</head") !== -1 || lower.indexOf("<body") !== -1) {
      appliedHead.forEach(function (node, key) {
        if (seenHead.has(key)) return;
        retiredScripts.add(node);
        if (node.parentNode) node.parentNode.removeChild(node);
        deferredHead = deferredHead.filter(function (pending) { return pending !== node; });
        appliedHead.delete(key);
      });
    }
    morph(document.body, parsed.body, MARK, undefined, undefined, streamedNodes);
    if (completed) syncBodyScripts(parsed.body);
    else if (lower.indexOf("</html") !== -1) complete();
  };
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.type !== ${JSON.stringify(STREAMING_FRAME_MESSAGE)} || typeof data.html !== "string") return;
    apply(data.html, typeof data.accent === "string" ? data.accent : null);
  });
  window.parent.postMessage({ type: ${JSON.stringify(STREAMING_FRAME_READY_MESSAGE)}, token: ${JSON.stringify(token)} }, "*");
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
  options: {
    baseHref?: string | undefined;
    /**
     * Echoed in the frame's ready message so the parent can tell this
     * document from one the frame navigated to. Pass the same value to
     * `isStreamingFrameReadyMessage`.
     */
    token?: string | undefined;
  } = {},
): string {
  const base = options.baseHref
    ? `<base href="${escapeAttribute(options.baseHref)}">`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">${base}<style>${STREAMED_IN_CSS}</style><script>${frameScript(options.token ?? "")}</script></head><body></body></html>`;
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
  token = "",
): boolean {
  const data = event.data as { type?: unknown; token?: unknown } | null;
  return (
    !!frame &&
    event.source === frame.contentWindow &&
    data?.type === STREAMING_FRAME_READY_MESSAGE &&
    (data.token ?? "") === token
  );
}
