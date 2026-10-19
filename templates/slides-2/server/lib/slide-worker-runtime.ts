import { fileURLToPath } from "node:url";

import * as t from "@babel/types";
import postcss from "postcss";

import {
  SlideTransitionSchema,
  type SlideTransition,
} from "../../shared/open-slide-transition.js";
import { parseSource, walkAll } from "./slide-source-editing/babel-walk.js";
import {
  isSlideSourceWithinByteLimit,
  MAX_SLIDE_SOURCE_BYTES,
  SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
} from "./slide-source-limits.js";
import { SlideSourceError } from "./slide-source.js";

export const MAX_REACT_SLIDE_SOURCE_BYTES = MAX_SLIDE_SOURCE_BYTES;
export const MAX_REACT_SLIDE_AST_NODES = 50_000;
export const MAX_REACT_SLIDE_WORKER_SOURCE_LENGTH = 4 * 1024 * 1024;
export const REACT_SLIDE_WORKER_TIMEOUT_MS = 2_500;

export type OpenSlideDesign = {
  palette: { bg: string; text: string; accent: string };
  fonts: { display: string; body: string };
  typeScale: { hero: number; body: number };
  radius: number;
};

export type OpenSlideMeta = {
  title?: string;
  theme?: string;
  createdAt?: string;
};

export type SlideWorkerRuntime = {
  kind: "open-slide-react-worker-v1";
  workerSource: string;
  page: { current: number; total: number };
  assetUrls: Record<string, string>;
  styles: string[];
  design?: OpenSlideDesign;
  meta?: OpenSlideMeta;
  transition?: SlideTransition;
  timeoutMs: typeof REACT_SLIDE_WORKER_TIMEOUT_MS;
};

type PreparedModule = {
  source: string;
  design?: OpenSlideDesign;
  meta?: OpenSlideMeta;
  transition?: SlideTransition;
  styles: string[];
};

const MAX_STYLE_LENGTH = 64 * 1024;
const MAX_TOTAL_STYLE_LENGTH = 128 * 1024;
const MAX_STATIC_VALUE_DEPTH = 16;
const MAX_STATIC_VALUE_NODES = 5_000;
const SAFE_CSS_FUNCTIONS = new Set([
  "calc",
  "clamp",
  "color",
  "color-mix",
  "conic-gradient",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "linear-gradient",
  "max",
  "min",
  "oklab",
  "oklch",
  "polygon",
  "radial-gradient",
  "repeating-conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "rgb",
  "rgba",
  "rotate",
  "rotatex",
  "rotatey",
  "rotatez",
  "scale",
  "scalex",
  "scaley",
  "scalez",
  "skew",
  "skewx",
  "skewy",
  "translate",
  "translatex",
  "translatey",
  "translatez",
  "var",
]);
const BLOCKED_CSS_PROPERTIES = new Set(["-moz-binding", "behavior", "src"]);
const BLOCKED_GLOBALS = new Set([
  "BroadcastChannel",
  "Buffer",
  "Deno",
  "EventSource",
  "FormData",
  "Function",
  "Headers",
  "MessageChannel",
  "Proxy",
  "Reflect",
  "Request",
  "Response",
  "SharedArrayBuffer",
  "SharedWorker",
  "URL",
  "URLSearchParams",
  "WebSocket",
  "Worker",
  "XMLHttpRequest",
  "Atomics",
  "Blob",
  "Bun",
  "BunFile",
  "CacheStorage",
  "EventTarget",
  "WebAssembly",
  "caches",
  "close",
  "crypto",
  "document",
  "eval",
  "fetch",
  "global",
  "globalThis",
  "indexedDB",
  "importScripts",
  "localStorage",
  "location",
  "module",
  "navigator",
  "onmessage",
  "postMessage",
  "process",
  "queueMicrotask",
  "require",
  "self",
  "sessionStorage",
  "setInterval",
  "setTimeout",
  "window",
  "WebTransport",
  "console",
]);
const BLOCKED_PROPERTIES = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "callee",
  "caller",
  "constructor",
  "eval",
  "prototype",
  "repeat",
  "flat",
  "flatMap",
  "concat",
  "fill",
  "copyWithin",
  "sort",
  "reverse",
  "splice",
  "unshift",
  "shift",
  "pop",
  "slice",
  "call",
  "apply",
  "bind",
]);
const BOUNDED_MEMBER_METHODS = new Set([
  "map",
  "push",
  "join",
  "padStart",
  "replace",
]);
const SAFE_MATH_METHODS = new Set([
  "abs",
  "atan2",
  "cos",
  "hypot",
  "max",
  "min",
  "sin",
]);
const SAFE_VALUE_METHODS = new Set(["includes", "toFixed", "X", "Y"]);
const SAFE_OBJECT_METHODS = new Set([
  "entries",
  "fromEntries",
  "hasOwn",
  "is",
  "keys",
  "values",
]);
const SAFE_ARRAY_METHODS = new Set(["isArray"]);
const SAFE_REACT_MEMBERS = new Set([
  "Children",
  "Fragment",
  "cloneElement",
  "createContext",
  "createElement",
  "forwardRef",
  "isValidElement",
  "memo",
  "useCallback",
  "useContext",
  "useId",
  "useMemo",
  "useState",
]);
const UNSUPPORTED_REACT_EFFECT_HOOKS = new Set([
  "useEffect",
  "useLayoutEffect",
]);
const SAFE_HTML_TAGS = new Set([
  "a",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "q",
  "s",
  "section",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "video",
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "rect",
  "text",
  "tspan",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
  "marker",
  "symbol",
  "use",
]);
const SAFE_HTML_ATTRIBUTES = new Set([
  "alt",
  "align",
  "autoplay",
  "aria-label",
  "aria-hidden",
  "aria-roledescription",
  "class",
  "colspan",
  "controls",
  "cx",
  "cy",
  "d",
  "decoding",
  "dir",
  "draggable",
  "fill",
  "fill-opacity",
  "fill-rule",
  "focusable",
  "font-family",
  "font-size",
  "font-weight",
  "height",
  "hidden",
  "href",
  "id",
  "lang",
  "loading",
  "marker-end",
  "marker-mid",
  "marker-start",
  "offset",
  "opacity",
  "points",
  "poster",
  "preload",
  "preserveaspectratio",
  "r",
  "rel",
  "role",
  "rowspan",
  "scope",
  "shape-rendering",
  "src",
  "loop",
  "muted",
  "playsinline",
  "type",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "style",
  "tabindex",
  "text-anchor",
  "title",
  "transform",
  "vector-effect",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
  "data-slide-loc",
  "data-osd-step",
]);

const WORKER_ENTRY = String.raw`
import React, { Children, cloneElement, createContext, isValidElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { parseFragment, serialize } from "parse5";
import postcss from "postcss";
import SlidePage from "virtual:slide-page";
import * as OpenSlideCore from "virtual:slide-page-shim";

const RenderContext = createContext(null);
const LIMITS = { values: 0, bytes: 0, stepCount: 0, remainingSteps: Infinity };
const MAX_VALUES = 50_000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_HTML = 1024 * 1024;
const MAX_NODES = 20_000;
const MAX_DEPTH = 64;
const blockedCssFunctions = new Set(["url", "expression", "image", "image-set", "cross-fade", "paint", "element"]);
const safeCssFunctions = new Set(${JSON.stringify([...SAFE_CSS_FUNCTIONS])});
const blockedCssProperties = new Set(${JSON.stringify([...BLOCKED_CSS_PROPERTIES])});
const safeTags = new Set(${JSON.stringify([...SAFE_HTML_TAGS])});
const safeAttributes = new Set(${JSON.stringify([...SAFE_HTML_ATTRIBUTES])});
const localSvgReferenceProperties = new Set(["fill", "stroke", "marker-end", "marker-mid", "marker-start"]);

function fail(message) { throw new Error(message); }
function reserve(values, bytes = 0) {
  if (!Number.isSafeInteger(values) || values < 0 || LIMITS.values + values > MAX_VALUES) fail("Slide render exceeded its value budget.");
  if (!Number.isSafeInteger(bytes) || bytes < 0 || LIMITS.bytes + bytes > MAX_BYTES) fail("Slide render exceeded its memory estimate.");
  LIMITS.values += values;
  LIMITS.bytes += bytes;
}
function estimate(value, depth = 0, seen = new Set()) {
  if (depth > 16) fail("Slide data is nested too deeply.");
  if (typeof value === "string") { reserve(1, value.length * 2); return; }
  if (value == null || typeof value === "boolean" || typeof value === "number") { reserve(1, 16); return; }
  if (typeof value === "function") { reserve(1, 64); return; }
  if (typeof value !== "object" || seen.has(value)) { reserve(1, 32); return; }
  seen.add(value);
  reserve(1, 64);
  if (Array.isArray(value)) {
    if (value.length > MAX_VALUES) fail("Slide data array is too large.");
    for (const child of value) estimate(child, depth + 1, seen);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length > 256) fail("Slide data object is too large.");
  for (const key of keys) estimate(value[key], depth + 1, seen);
}
export function __slideRuntimeMap(array, callback, thisArg) {
  if (!Array.isArray(array) || typeof callback !== "function") fail("Only static arrays can be mapped in slide source.");
  if (array.length > MAX_VALUES) fail("Slide render exceeded its map budget.");
  reserve(array.length, array.length * 8);
  const result = new Array(array.length);
  for (let index = 0; index < array.length; index++) {
    if (!(index in array)) continue;
    const value = callback.call(thisArg, array[index], index, array);
    estimate(value);
    result[index] = value;
  }
  return result;
}
export function __slideRuntimePush(array, ...values) {
  if (!Array.isArray(array) || values.some((value) => value === undefined)) fail("Only explicit values can be appended in slide source.");
  if (array.length + values.length > MAX_VALUES) fail("Slide render exceeded its array budget.");
  for (const value of values) estimate(value);
  for (const value of values) array[array.length] = value;
  return array.length;
}
export function __slideRuntimeJoin(array, separator = ",") {
  if (!Array.isArray(array) || array.length > MAX_VALUES || !isPrimitive(separator)) fail("Only bounded primitive arrays can be joined in slide source.");
  reserve(array.length, 0);
  if (!array.every(isPrimitive)) fail("Only bounded primitive arrays can be joined in slide source.");
  const joiner = String(separator);
  let length = Math.max(0, array.length - 1) * joiner.length;
  for (const value of array) length += value == null ? 0 : String(value).length;
  if (length > MAX_HTML) fail("Slide render string is too large.");
  reserve(1, length * 2);
  return array.join(joiner);
}
export function __slideRuntimePadStart(value, length, padding) {
  if (!isPrimitive(value) || (padding !== undefined && !isPrimitive(padding))) fail("Slide padding accepts primitive text only.");
  const text = String(value);
  const requested = Number(length);
  if (!Number.isFinite(requested) || requested > MAX_HTML || requested < 0) fail("Slide padding is out of bounds.");
  const outputLength = Math.max(text.length, Math.trunc(requested));
  if (outputLength > MAX_HTML) fail("Slide padding is out of bounds.");
  reserve(1, outputLength * 2);
  const result = text.padStart(requested, padding === undefined ? " " : String(padding));
  return result;
}
export function __slideRuntimeReplace(value, pattern, replacement) {
  if (!isPrimitive(value) || typeof replacement !== "string" || replacement.includes("$") || (typeof pattern !== "string" && !(pattern instanceof RegExp))) fail("Slide replacement must use primitive text and a literal replacement string.");
  const text = String(value);
  const matches = [];
  if (pattern instanceof RegExp) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text))) {
      reserve(1, 24);
      matches.push({ index: match.index, length: match[0].length });
      if (!regex.global) break;
      if (match[0].length === 0) regex.lastIndex++;
      if (matches.length > MAX_VALUES) fail("Slide replacement has too many matches.");
    }
  } else {
    const search = String(pattern);
    let cursor = 0;
    if (!search) { reserve(1, 24); matches.push({ index: 0, length: 0 }); }
    else while ((cursor = text.indexOf(search, cursor)) !== -1) {
      reserve(1, 24);
      matches.push({ index: cursor, length: search.length });
      cursor += search.length;
      if (matches.length > MAX_VALUES) fail("Slide replacement has too many matches.");
    }
  }
  const outputLength = text.length + matches.length * replacement.length - matches.reduce((size, match) => size + match.length, 0);
  if (outputLength > MAX_HTML) fail("Slide render string is too large.");
  reserve(matches.length * 2 + 1, outputLength * 2);
  const parts = new Array(matches.length * 2 + 1);
  let cursor = 0;
  let part = 0;
  for (const match of matches) {
    parts[part++] = text.slice(cursor, match.index);
    parts[part++] = replacement;
    cursor = match.index + match.length;
  }
  parts[part] = text.slice(cursor);
  return parts.join("");
}
function isPrimitive(value) { return value == null || ["string", "number", "boolean"].includes(typeof value); }

export function SlideRuntimeProvider({ value, children }) {
  return React.createElement(RenderContext.Provider, { value }, children);
}
export function useSlidePageNumber() {
  const context = useContext(RenderContext);
  if (!context) fail("useSlidePageNumber must be called from a rendered slide page.");
  return { current: context.page.current, total: context.page.total };
}
export function useIsActivePage() {
  return useContext(RenderContext)?.isActivePage ?? false;
}
export function Step({ children, duration = 180, _revealed }) {
  const revealed = _revealed ?? true;
  return React.createElement("div", {
    "data-osd-step": revealed ? "revealed" : "pending",
    style: {
      opacity: revealed ? 1 : 0,
      visibility: revealed ? "visible" : "hidden",
      transition: "opacity " + duration + "ms cubic-bezier(0, 0, 0.2, 1)",
    },
  }, children);
}
export function Steps({ children }) {
  const context = useContext(RenderContext);
  const childrenArray = Children.toArray(children);
  let count = 0;
  for (const child of childrenArray) if (isValidElement(child) && child.type === Step) count++;
  LIMITS.stepCount += count;
  const revealed = Math.min(count, LIMITS.remainingSteps);
  LIMITS.remainingSteps = Math.max(0, LIMITS.remainingSteps - revealed);
  let index = 0;
  return React.createElement(React.Fragment, null, ...childrenArray.map((child, key) => {
    if (isValidElement(child) && child.type === Step) {
      const stepIndex = index++;
      return cloneElement(child, { key: child.key ?? key, _revealed: stepIndex < revealed });
    }
    return child;
  }));
}
export function ImagePlaceholder({ label = "Image placeholder", children, ...props }) {
  return React.createElement("div", {
    "data-slide-loc": props["data-slide-loc"],
    "data-slide-placeholder": true,
    "aria-label": label,
    style: { border: "2px dashed currentColor", display: "flex", alignItems: "center", justifyContent: "center" },
  }, children ?? label);
}
export function MorphElement({ id, children, as = "div", ...props }) {
  return React.createElement(as, { ...props, "data-osd-morph": id }, children);
}

function safeStyle(value) {
  let root;
  try { root = postcss.parse("x{" + value + "}", { from: undefined }); } catch {
    // coercion-ok: Invalid imported declarations are discarded at the SVG sanitization boundary.
    return "";
  }
  const rule = root.nodes[0];
  if (!rule || rule.type !== "rule") return "";
  for (const child of [...(rule.nodes || [])]) {
    if (child.type !== "decl") { child.remove(); continue; }
    const property = child.prop.toLowerCase();
    const text = child.value;
    if (!/^(?:--[a-z0-9_-]+|[a-z][a-z0-9-]*)$/.test(property) || blockedCssProperties.has(property) || /[\\\u0000-\u001f\u007f{}<>@]|\/\*|\*\/|javascript:/i.test(text)) { child.remove(); continue; }
    if (/\b(?:url|expression|image-set|cross-fade|paint|element)\s*\(/i.test(text)) {
      const local = localSvgReferenceProperties.has(property) && /^url\(\s*#[a-z][a-z0-9_.:-]*\s*\)$/i.test(text.trim());
      if (!local) { child.remove(); continue; }
    }
    const variables = [...text.matchAll(/var\(\s*(--[a-z0-9_-]+)/gi)];
    if (/\bvar\s*\(/i.test(text.replace(/var\(\s*--[a-z0-9_-]+\s*(?:,\s*[^()]*)?\)/gi, ""))) { child.remove(); continue; }
    if (variables.some((match) => !/^(?:--deck-|--ds-|--osd-|--d$)/i.test(match[1]))) { child.remove(); continue; }
    let unsafeFunction = false;
    for (const match of text.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) {
      const name = match[1].toLowerCase();
      if (blockedCssFunctions.has(name) || !safeCssFunctions.has(name)) unsafeFunction = true;
    }
    if (unsafeFunction) child.remove();
  }
  return (rule.nodes || []).map((node) => node.toString()).join(";");
}

function sanitizeHtml(html) {
  if (typeof html !== "string" || html.length > MAX_HTML) fail("Slide HTML is too large.");
  const fragment = parseFragment(html);
  const stack = [...(fragment.childNodes || [])].map((node) => ({ node, depth: 1, parent: null }));
  const videos = [];
  let count = 0;
  while (stack.length) {
    const { node, depth, parent } = stack.pop();
    if (++count > MAX_NODES || depth > MAX_DEPTH) fail("Slide HTML is too complex.");
    if (node.nodeName === "#text" || node.nodeName === "#comment") continue;
    if (!node.tagName || !safeTags.has(node.tagName.toLowerCase())) fail("Slide contains an unsupported HTML element.");
    const tagName = node.tagName.toLowerCase();
    if (tagName === "video") videos.push(node);
    if (tagName === "source" && parent?.tagName?.toLowerCase() !== "video") fail("Slide sources must be direct children of a video.");
    for (const attribute of [...(node.attrs || [])]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (/^on/i.test(name) || name === "srcdoc" || name === "dangerouslysetinnerhtml" || !safeAttributes.has(name) && !/^(?:aria-[a-z0-9-]+|data-[a-z0-9-]+)$/.test(name)) {
        node.attrs.splice(node.attrs.indexOf(attribute), 1);
        continue;
      }
      if (name === "style") {
        const safe = safeStyle(value);
        if (safe) attribute.value = safe;
        else node.attrs.splice(node.attrs.indexOf(attribute), 1);
        continue;
      }
      if (name === "src") {
        if (!["img", "video", "source"].includes(tagName) || !/^asset:\/\/[A-Za-z0-9_-]{1,200}$/.test(value)) fail("Media references must use uploaded asset handles.");
      }
      if (name === "poster" && (tagName !== "video" || !/^asset:\/\/[A-Za-z0-9_-]{1,200}$/.test(value))) fail("Video posters must use uploaded asset handles.");
      if (name === "preload" && !["none", "metadata", "auto"].includes(value.toLowerCase())) fail("Video preload must be none, metadata, or auto.");
      if (name === "href" && !/^#[A-Za-z][A-Za-z0-9_.:-]{0,200}$/.test(value)) {
        node.attrs.splice(node.attrs.indexOf(attribute), 1);
        continue;
      }
      if (name === "id" && !/^[A-Za-z][A-Za-z0-9_.:-]{0,200}$/.test(value)) node.attrs.splice(node.attrs.indexOf(attribute), 1);
      if (name === "data-slide-loc" && !/^\d{1,6}:\d{1,6}$/.test(value)) node.attrs.splice(node.attrs.indexOf(attribute), 1);
    }
    if (tagName === "source" && !(node.attrs || []).some((attribute) => attribute.name.toLowerCase() === "src")) fail("Video sources need an uploaded asset handle.");
    for (const child of node.childNodes || []) stack.push({ node: child, depth: depth + 1, parent: node });
  }
  for (const video of videos) {
    const hasSource = (video.attrs || []).some((attribute) => attribute.name.toLowerCase() === "src") || (video.childNodes || []).some((child) => child.tagName?.toLowerCase() === "source" && (child.attrs || []).some((attribute) => attribute.name.toLowerCase() === "src"));
    if (!hasSource) fail("Video elements need an uploaded asset source.");
  }
  const safe = serialize(fragment);
  if (safe.length > MAX_HTML) fail("Sanitized slide HTML is too large.");
  return safe;
}

function handleMessage(event) {
  const request = event.data;
  const requestId = request && typeof request.requestId === "string" ? request.requestId.slice(0, 80) : "";
  try {
    if (!request || request.type !== "render" || !requestId || !request.page || !Number.isSafeInteger(request.page.current) || !Number.isSafeInteger(request.page.total) || request.page.current < 1 || request.page.total < request.page.current || (request.revealedSteps !== null && (!Number.isInteger(request.revealedSteps) || request.revealedSteps < 0 || request.revealedSteps > 500)) || typeof request.isActivePage !== "boolean") fail("Slide render request is invalid.");
    OpenSlideCore.__slideRuntimeReset(request.revealedSteps);
    const context = { page: request.page, isActivePage: request.isActivePage, revealedSteps: request.revealedSteps };
    const markup = renderToStaticMarkup(React.createElement(OpenSlideCore.SlideRuntimeProvider, { value: context }, React.createElement(SlidePage)));
    const html = sanitizeHtml(markup);
    postMessage({ type: "rendered", requestId, html, stepCount: Math.min(500, OpenSlideCore.__slideRuntimeStepCount()) });
  } catch (error) {
    postMessage({ type: "error", requestId, message: error instanceof Error ? error.message.slice(0, 300) : "Slide rendering failed." });
  }
}
self.onmessage = handleMessage;
`;

export function prepareReactSlideSource(sourceTsx: string): PreparedModule {
  if (!sourceTsx.trim() || !isSlideSourceWithinByteLimit(sourceTsx)) {
    throw new SlideSourceError(SLIDE_SOURCE_BYTE_LIMIT_MESSAGE);
  }
  const original = parseModule(sourceTsx);
  const staticBindings = collectStaticBindings(original);
  const exportValues = readModuleMetadata(original, staticBindings);
  const extractedStyles = collectModuleStyles(original, staticBindings);
  const guardedRanges = findDocumentGuards(original, sourceTsx);
  let safeSource = replaceRangesWithSpaces(sourceTsx, guardedRanges);
  const ast = parseModule(safeSource);
  validateReactModule(ast);
  safeSource = addSourceLocations(safeSource, ast);
  const locatedAst = parseModule(safeSource);
  safeSource = instrumentBoundedCollectionCalls(safeSource, locatedAst);
  safeSource = `import { __slideRuntimeGet, __slideRuntimeJoin, __slideRuntimeMap, __slideRuntimePadStart, __slideRuntimePush, __slideRuntimeReplace } from "@open-slide/core";\n${safeSource}`;
  return {
    source: safeSource,
    ...exportValues,
    styles: sanitizeStyles(extractedStyles),
  };
}

export async function buildReactSlideRuntime(
  sourceTsx: string,
  options: {
    current: number;
    total: number;
    assetUrls: ReadonlyMap<string, string>;
  },
): Promise<SlideWorkerRuntime> {
  const prepared = prepareReactSlideSource(sourceTsx);
  let workerSource: string | undefined;
  try {
    const { build } = await import("esbuild");
    const templateRoot = fileURLToPath(new URL("../../", import.meta.url));
    const result = await build({
      stdin: {
        contents: WORKER_ENTRY,
        resolveDir: templateRoot,
        sourcefile: "slide-worker-entry.tsx",
        loader: "tsx",
      },
      absWorkingDir: templateRoot,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      legalComments: "none",
      minify: true,
      sourcemap: false,
      write: false,
      treeShaking: true,
      plugins: [
        {
          name: "slides-2-react-source",
          setup(builder) {
            builder.onResolve({ filter: /^virtual:slide-page$/ }, () => ({
              path: "slide-page",
              namespace: "slides-2-worker",
            }));
            builder.onLoad(
              { filter: /^slide-page$/, namespace: "slides-2-worker" },
              () => ({
                contents: prepared.source,
                loader: "tsx",
                resolveDir: templateRoot,
              }),
            );
            builder.onResolve(
              { filter: /^(?:@open-slide\/core|virtual:slide-page-shim)$/ },
              () => ({
                path: "slide-page-shim",
                namespace: "slides-2-worker",
              }),
            );
            builder.onLoad(
              { filter: /^slide-page-shim$/, namespace: "slides-2-worker" },
              () => ({
                contents: slidePageShim,
                loader: "tsx",
                resolveDir: templateRoot,
              }),
            );
          },
        },
      ],
    });
    workerSource = result.outputFiles[0]?.text;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Compilation failed.";
    throw new SlideSourceError(
      `Slide Worker bundle could not be compiled: ${message.slice(0, 500)}`,
    );
  }
  if (
    !workerSource ||
    workerSource.length > MAX_REACT_SLIDE_WORKER_SOURCE_LENGTH
  ) {
    throw new SlideSourceError(
      "Slide Worker bundle is empty or exceeds 4 MiB.",
    );
  }
  return {
    kind: "open-slide-react-worker-v1",
    workerSource,
    page: {
      current: clampPage(options.current, options.total),
      total: clampPageTotal(options.total),
    },
    assetUrls: Object.fromEntries(options.assetUrls),
    styles: prepared.styles,
    ...(prepared.design ? { design: prepared.design } : {}),
    ...(prepared.meta ? { meta: prepared.meta } : {}),
    ...(prepared.transition ? { transition: prepared.transition } : {}),
    timeoutMs: REACT_SLIDE_WORKER_TIMEOUT_MS,
  };
}

function parseModule(source: string): t.File {
  const ast = parseSource(source);
  if (!ast) throw new SlideSourceError("Slide source has a syntax error.");
  let nodeCount = 0;
  walkAll(ast, () => {
    nodeCount += 1;
    if (nodeCount > MAX_REACT_SLIDE_AST_NODES) {
      throw new SlideSourceError(
        "Slide source is too complex for the React runtime.",
      );
    }
  });
  return ast;
}

function collectStaticBindings(ast: t.File): Map<string, t.Node> {
  const bindings = new Map<string, t.Node>();
  for (const statement of ast.program.body) {
    const declaration = t.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (t.isVariableDeclaration(declaration) && declaration.kind === "const") {
      for (const item of declaration.declarations) {
        if (t.isIdentifier(item.id) && item.init)
          bindings.set(item.id.name, item.init);
      }
    }
  }
  return bindings;
}

function readModuleMetadata(
  ast: t.File,
  bindings: Map<string, t.Node>,
): Pick<PreparedModule, "design" | "meta" | "transition"> {
  const exports = new Map<string, t.Node>();
  for (const statement of ast.program.body) {
    if (
      !t.isExportNamedDeclaration(statement) ||
      !t.isVariableDeclaration(statement.declaration)
    )
      continue;
    for (const item of statement.declaration.declarations) {
      if (t.isIdentifier(item.id) && item.init)
        exports.set(item.id.name, item.init);
    }
  }
  const designValue = exports.has("design")
    ? evaluateStatic(exports.get("design")!, bindings)
    : undefined;
  const metaValue = exports.has("meta")
    ? evaluateStatic(exports.get("meta")!, bindings)
    : undefined;
  const transitionValue = exports.has("transition")
    ? evaluateStatic(exports.get("transition")!, bindings)
    : undefined;
  return {
    ...(designValue === undefined
      ? {}
      : { design: validateDesign(designValue) }),
    ...(metaValue === undefined ? {} : { meta: validateMeta(metaValue) }),
    ...(transitionValue === undefined
      ? {}
      : { transition: validateTransition(transitionValue) }),
  };
}

function evaluateStatic(
  node: t.Node,
  bindings: Map<string, t.Node>,
  active = new Set<string>(),
  depth = 0,
  budget = { nodes: 0 },
): unknown {
  if (
    depth > MAX_STATIC_VALUE_DEPTH ||
    ++budget.nodes > MAX_STATIC_VALUE_NODES
  ) {
    throw new SlideSourceError("Slide module metadata is too complex.");
  }
  while (
    t.isTSAsExpression(node) ||
    t.isTSSatisfiesExpression(node) ||
    t.isTSTypeAssertion(node) ||
    t.isTSNonNullExpression(node)
  )
    node = node.expression;
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node)
  )
    return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isIdentifier(node)) {
    if (node.name === "undefined") return undefined;
    const reference = bindings.get(node.name);
    if (!reference || active.has(node.name))
      throw new SlideSourceError(
        `Metadata references a non-static value: ${node.name}.`,
      );
    active.add(node.name);
    const value = evaluateStatic(
      reference,
      bindings,
      active,
      depth + 1,
      budget,
    );
    active.delete(node.name);
    return value;
  }
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  )
    return -node.argument.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? "";
  if (t.isArrayExpression(node)) {
    if (node.elements.length > 500)
      throw new SlideSourceError("Slide module metadata arrays are too large.");
    return node.elements.map((element) =>
      element
        ? evaluateStatic(element, bindings, active, depth + 1, budget)
        : null,
    );
  }
  if (t.isObjectExpression(node)) {
    const value: Record<string, unknown> = Object.create(null);
    if (node.properties.length > 500)
      throw new SlideSourceError(
        "Slide module metadata objects are too large.",
      );
    for (const property of node.properties) {
      if (
        !t.isObjectProperty(property) ||
        property.computed ||
        property.shorthand
      ) {
        throw new SlideSourceError(
          "Slide module metadata must use static object properties.",
        );
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null;
      if (!key || BLOCKED_PROPERTIES.has(key))
        throw new SlideSourceError("Slide module metadata has an invalid key.");
      value[key] = evaluateStatic(
        property.value,
        bindings,
        active,
        depth + 1,
        budget,
      );
    }
    return value;
  }
  throw new SlideSourceError("Slide module metadata must be a static object.");
}

function validateDesign(value: unknown): OpenSlideDesign {
  if (!isRecord(value))
    throw new SlideSourceError("The design export must be a static object.");
  const palette = value.palette;
  const fonts = value.fonts;
  const typeScale = value.typeScale;
  if (!isRecord(palette) || !isRecord(fonts) || !isRecord(typeScale))
    throw new SlideSourceError(
      "Design must include palette, fonts, and typeScale objects.",
    );
  const design: OpenSlideDesign = {
    palette: {
      bg: validateCssScalar(palette.bg, "design.palette.bg"),
      text: validateCssScalar(palette.text, "design.palette.text"),
      accent: validateCssScalar(palette.accent, "design.palette.accent"),
    },
    fonts: {
      display: validateFontStack(fonts.display, "design.fonts.display"),
      body: validateFontStack(fonts.body, "design.fonts.body"),
    },
    typeScale: {
      hero: validateSize(typeScale.hero, "design.typeScale.hero"),
      body: validateSize(typeScale.body, "design.typeScale.body"),
    },
    radius: validateRadius(value.radius),
  };
  return design;
}

function validateMeta(value: unknown): OpenSlideMeta {
  if (!isRecord(value))
    throw new SlideSourceError("The meta export must be a static object.");
  const meta: OpenSlideMeta = {};
  for (const key of ["title", "theme", "createdAt"] as const) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (
      typeof candidate !== "string" ||
      candidate.length > 300 ||
      /[\u0000-\u001f]/.test(candidate)
    ) {
      throw new SlideSourceError(`Meta field ${key} must be a short string.`);
    }
    meta[key] = candidate;
  }
  return meta;
}

function validateTransition(value: unknown): SlideTransition {
  const parsed = SlideTransitionSchema.safeParse(value);
  if (!parsed.success) {
    throw new SlideSourceError(
      `The transition export is invalid: ${parsed.error.issues[0]?.message ?? "check the transition fields"}.`,
    );
  }
  if (JSON.stringify(parsed.data).length > 16 * 1024) {
    throw new SlideSourceError("The transition export is too large.");
  }
  return parsed.data as SlideTransition;
}

function validateCssScalar(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    /[\\\u0000-\u001f\u007f;{}<>@]|\/\*|\*\/|url\s*\(/i.test(value)
  ) {
    throw new SlideSourceError(`${name} must be a safe CSS value.`);
  }
  return value;
}

function validateFontStack(value: unknown, name: string): string {
  const font = validateCssScalar(value, name);
  if (!/^[A-Za-z0-9\s"',._-]+$/.test(font))
    throw new SlideSourceError(`${name} must be a static font stack.`);
  return font;
}

function validateSize(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 320
  ) {
    throw new SlideSourceError(`${name} must be between 0 and 320 pixels.`);
  }
  return value;
}

function validateRadius(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 128
  ) {
    throw new SlideSourceError(
      "design.radius must be between 0 and 128 pixels.",
    );
  }
  return value;
}

function collectModuleStyles(
  ast: t.File,
  bindings: Map<string, t.Node>,
): string[] {
  const styles = new Set<string>();
  for (const statement of ast.program.body) {
    const declaration = t.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!t.isVariableDeclaration(declaration) || declaration.kind !== "const")
      continue;
    for (const item of declaration.declarations) {
      if (
        !t.isIdentifier(item.id) ||
        !item.init ||
        !/style|css|keyframe/i.test(item.id.name)
      )
        continue;
      const value = evaluateStatic(item.init, bindings);
      if (typeof value !== "string" || !value.includes("{")) continue;
      if (value.length > MAX_STYLE_LENGTH)
        throw new SlideSourceError("A slide CSS block exceeds 64 KiB.");
      styles.add(value);
    }
  }
  if (
    [...styles].reduce((size, style) => size + style.length, 0) >
    MAX_TOTAL_STYLE_LENGTH
  ) {
    throw new SlideSourceError("Slide CSS exceeds 128 KiB.");
  }
  return [...styles];
}

function sanitizeStyles(styles: string[]): string[] {
  const sanitized: string[] = [];
  for (const source of styles) {
    let root: postcss.Root;
    try {
      root = postcss.parse(source, { from: undefined });
    } catch {
      throw new SlideSourceError("A static CSS block has invalid syntax.");
    }
    root.walkAtRules((rule) => {
      const name = rule.name.toLowerCase();
      if (
        name === "import" ||
        name === "font-face" ||
        name === "namespace" ||
        name === "charset" ||
        name === "document" ||
        name === "supports"
      ) {
        rule.remove();
        return;
      }
      if (
        name === "media" &&
        !/^\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*$/i.test(
          rule.params,
        )
      ) {
        rule.remove();
        return;
      }
      if (
        name !== "keyframes" &&
        name !== "-webkit-keyframes" &&
        name !== "media"
      )
        rule.remove();
    });
    root.walkComments((comment) => {
      comment.remove();
    });
    root.walkDecls((decl) => {
      const value = decl.value;
      if (
        BLOCKED_CSS_PROPERTIES.has(decl.prop.toLowerCase()) ||
        /[\\\u0000-\u001f\u007f{}<>@]|\/\*|\*\/|url\s*\(|javascript:/i.test(
          value,
        )
      ) {
        decl.remove();
        return;
      }
      for (const match of value.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) {
        if (!SAFE_CSS_FUNCTIONS.has(match[1]!.toLowerCase())) {
          decl.remove();
          return;
        }
      }
    });
    root.walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name))
        return;
      if (/[\\\u0000-\u001f\u007f{}<>@]|\/\*|\*\//.test(rule.selector)) {
        rule.remove();
        return;
      }
      rule.selector = `#slide-root :is(${rule.selector})`;
    });
    const css = root.toString();
    if (css) sanitized.push(css);
  }
  return sanitized;
}

function validateReactModule(ast: t.File): void {
  const defaultExport = ast.program.body.filter(t.isExportDefaultDeclaration);
  if (defaultExport.length !== 1)
    throw new SlideSourceError(
      "Slide source must have one default page component.",
    );
  const declaration = defaultExport[0]!.declaration;
  if (
    !t.isIdentifier(declaration) &&
    !t.isFunctionDeclaration(declaration) &&
    !t.isArrowFunctionExpression(declaration) &&
    !t.isFunctionExpression(declaration)
  ) {
    throw new SlideSourceError(
      "The default export must be a React page component.",
    );
  }
  for (const statement of ast.program.body) {
    if (t.isImportDeclaration(statement)) {
      validateImport(statement);
      continue;
    }
    if (
      t.isExportDefaultDeclaration(statement) ||
      t.isTSInterfaceDeclaration(statement) ||
      t.isTSTypeAliasDeclaration(statement) ||
      t.isEmptyStatement(statement) ||
      t.isFunctionDeclaration(statement)
    )
      continue;
    if (t.isVariableDeclaration(statement) && statement.kind === "const")
      continue;
    if (
      t.isExportNamedDeclaration(statement) &&
      t.isVariableDeclaration(statement.declaration) &&
      statement.declaration.kind === "const"
    ) {
      for (const declaration of statement.declaration.declarations) {
        if (
          !t.isIdentifier(declaration.id) ||
          !["design", "meta", "notes", "transition"].includes(
            declaration.id.name,
          )
        ) {
          throw new SlideSourceError(
            "Named exports are limited to design, meta, notes, and transition.",
          );
        }
      }
      continue;
    }
    throw new SlideSourceError(
      `Top-level ${statement.type} code is not supported in slide modules.`,
    );
  }
  const allowedObjectIdentifiers = new WeakSet<t.Identifier>();
  const allowedArrayIdentifiers = new WeakSet<t.Identifier>();
  const boundedCallMembers = new WeakSet<t.MemberExpression>();
  walkAll(ast, (node) => {
    if (
      (t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        UNSUPPORTED_REACT_EFFECT_HOOKS.has(node.callee.name)) ||
      (t.isCallExpression(node) &&
        t.isMemberExpression(node.callee) &&
        UNSUPPORTED_REACT_EFFECT_HOOKS.has(
          staticMemberProperty(node.callee) ?? "",
        )) ||
      (t.isMemberExpression(node) &&
        UNSUPPORTED_REACT_EFFECT_HOOKS.has(staticMemberProperty(node) ?? "")) ||
      (t.isObjectPattern(node) &&
        node.properties.some(
          (property) =>
            t.isObjectProperty(property) &&
            UNSUPPORTED_REACT_EFFECT_HOOKS.has(
              t.isIdentifier(property.key)
                ? property.key.name
                : t.isStringLiteral(property.key)
                  ? property.key.value
                  : "",
            ),
        ))
    ) {
      throw new SlideSourceError(
        "React effect hooks do not run during static slide rendering; render visual states directly or use CSS motion.",
      );
    }
    if (
      t.isOptionalMemberExpression(node) ||
      t.isOptionalCallExpression(node)
    ) {
      throw new SlideSourceError(
        "Optional access and calls are not supported in slide source.",
      );
    }
    if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
      const callee = node.callee;
      const method = staticMemberProperty(callee);
      if (!method) {
        throw new SlideSourceError(
          "Member calls must use an approved static method.",
        );
      }
      const root = memberRootIdentifier(callee);
      if (BOUNDED_MEMBER_METHODS.has(method)) {
        boundedCallMembers.add(callee);
      } else if (root?.name === "Object" && SAFE_OBJECT_METHODS.has(method)) {
        // Object collection calls below are restricted to this small static allowlist.
      } else if (root?.name === "Array" && SAFE_ARRAY_METHODS.has(method)) {
        // Array.isArray is the only permitted Array constructor access.
      } else if (root?.name === "React" && SAFE_REACT_MEMBERS.has(method)) {
        // React calls are limited to the imported component/hook surface.
      } else if (root?.name === "Math" && SAFE_MATH_METHODS.has(method)) {
        // These scalar math functions do not allocate collections or access browser state.
      } else if (SAFE_VALUE_METHODS.has(method)) {
        // Used by generated geometry helpers and primitive formatting.
      } else {
        throw new SlideSourceError(
          `Member call ${method} is not supported in slide source.`,
        );
      }
    }
    if (!t.isMemberExpression(node)) return;
    const property = staticMemberProperty(node);
    const root = memberRootIdentifier(node);
    if (
      property &&
      BOUNDED_MEMBER_METHODS.has(property) &&
      !boundedCallMembers.has(node)
    ) {
      throw new SlideSourceError(
        `Method ${property} must be called directly so its bounds can be enforced.`,
      );
    }
    if (root?.name === "Object") {
      if (!property || !SAFE_OBJECT_METHODS.has(property)) {
        throw new SlideSourceError(
          "Object access is limited to safe static collection methods.",
        );
      }
      if (t.isIdentifier(node.object, { name: "Object" })) {
        allowedObjectIdentifiers.add(node.object);
      }
    }
    if (root?.name === "Array") {
      if (!property || !SAFE_ARRAY_METHODS.has(property)) {
        throw new SlideSourceError("Array access is limited to Array.isArray.");
      }
      if (t.isIdentifier(node.object, { name: "Array" })) {
        allowedArrayIdentifiers.add(node.object);
      }
    }
    if (root?.name === "React") {
      if (!property || !SAFE_REACT_MEMBERS.has(property)) {
        throw new SlideSourceError(
          "React access must use an approved static member.",
        );
      }
    }
  });
  walkAll(ast, (node) => {
    if (t.isIdentifier(node) && BLOCKED_GLOBALS.has(node.name)) {
      throw new SlideSourceError(`Slide source cannot access ${node.name}.`);
    }
    if (
      t.isIdentifier(node, { name: "Object" }) &&
      !allowedObjectIdentifiers.has(node)
    ) {
      throw new SlideSourceError(
        "Object may only be used with an approved static collection method.",
      );
    }
    if (
      t.isIdentifier(node, { name: "Array" }) &&
      !allowedArrayIdentifiers.has(node)
    ) {
      throw new SlideSourceError("Array may only be used with Array.isArray.");
    }
    if (t.isIdentifier(node) && node.name.startsWith("__slideRuntime")) {
      throw new SlideSourceError(
        "Slide source uses a reserved runtime identifier.",
      );
    }
    if (
      t.isNewExpression(node) ||
      t.isImportExpression(node) ||
      t.isWithStatement(node)
    ) {
      throw new SlideSourceError(
        `${node.type} is not supported in slide source.`,
      );
    }
    if (t.isMemberExpression(node)) {
      const property = staticMemberProperty(node);
      if (property && BLOCKED_PROPERTIES.has(property))
        throw new SlideSourceError(
          "Prototype access is not allowed in slide source.",
        );
    }
    if (t.isCallExpression(node)) {
      const callee = node.callee;
      if (
        t.isIdentifier(callee) &&
        ["Array", "Function", "eval", "require"].includes(callee.name)
      ) {
        throw new SlideSourceError(
          `Call to ${callee.name} is not supported in slide source.`,
        );
      }
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "Array" }) &&
        !t.isIdentifier(callee.property, { name: "isArray" })
      ) {
        throw new SlideSourceError(
          "Array constructors and generators are not supported in slide source.",
        );
      }
    }
    if (t.isJSXElement(node)) {
      const name = t.isJSXIdentifier(node.openingElement.name)
        ? node.openingElement.name.name
        : null;
      if (!name)
        throw new SlideSourceError(
          "Namespaced and member JSX tags are not supported.",
        );
      if (
        /^(?:script|style|iframe|frame|object|embed|link|meta|base|form|input|audio|portal|canvas|foreignObject)$/i.test(
          name,
        )
      ) {
        throw new SlideSourceError(`JSX element <${name}> is not allowed.`);
      }
      for (const attribute of node.openingElement.attributes) {
        if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name))
          continue;
        const attributeName = attribute.name.name;
        if (attributeName === "data-slide-loc") {
          throw new SlideSourceError(
            "data-slide-loc is reserved for source mapping.",
          );
        }
        if (/^on/i.test(attributeName)) {
          throw new SlideSourceError(
            "Event handlers are not allowed in slide source.",
          );
        }
      }
    }
  });
}

function staticMemberProperty(
  node: t.MemberExpression | t.OptionalMemberExpression,
): string | null {
  if (!node.computed && t.isIdentifier(node.property))
    return node.property.name;
  if (node.computed && t.isStringLiteral(node.property))
    return node.property.value;
  if (node.computed && t.isNumericLiteral(node.property))
    return String(node.property.value);
  return null;
}

function memberRootIdentifier(
  node: t.MemberExpression | t.OptionalMemberExpression,
): t.Identifier | null {
  let current: t.Expression | t.Super = node;
  while (
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current)
  ) {
    current = current.object;
  }
  return t.isIdentifier(current) ? current : null;
}

function validateImport(declaration: t.ImportDeclaration): void {
  const moduleName = declaration.source.value;
  if (moduleName !== "react" && moduleName !== "@open-slide/core") {
    throw new SlideSourceError(
      `Import from ${moduleName} is not supported; use React and the supported @open-slide/core exports only.`,
    );
  }
  if (declaration.importKind === "type") return;
  const reactImports = new Set([
    "useId",
    "useState",
    "useMemo",
    "useCallback",
    "useContext",
    "createContext",
    "Fragment",
    "Children",
    "cloneElement",
    "isValidElement",
    "memo",
    "forwardRef",
  ]);
  const coreImports = new Set([
    "CANVAS_HEIGHT",
    "CANVAS_WIDTH",
    "Step",
    "Steps",
    "cssVarsToString",
    "defaultDesign",
    "designToCssVars",
    "useSlidePageNumber",
    "useIsActivePage",
    "ImagePlaceholder",
    "MorphElement",
  ]);
  for (const specifier of declaration.specifiers) {
    if (t.isImportNamespaceSpecifier(specifier))
      throw new SlideSourceError(
        "Namespace imports are not supported in slide modules.",
      );
    if (t.isImportDefaultSpecifier(specifier)) {
      if (moduleName !== "react")
        throw new SlideSourceError("Only React may be default-imported.");
      continue;
    }
    if (t.isImportSpecifier(specifier) && specifier.importKind !== "type") {
      const imported = t.isIdentifier(specifier.imported)
        ? specifier.imported.name
        : specifier.imported.value;
      if (
        moduleName === "react" &&
        UNSUPPORTED_REACT_EFFECT_HOOKS.has(imported)
      ) {
        throw new SlideSourceError(
          "React effect hooks do not run during static slide rendering; render visual states directly or use CSS motion.",
        );
      }
      const allowed = moduleName === "react" ? reactImports : coreImports;
      if (!allowed.has(imported))
        throw new SlideSourceError(
          `Import ${imported} from ${moduleName} is not supported.`,
        );
    }
  }
}

function findDocumentGuards(
  ast: t.File,
  source: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const statement of ast.program.body) {
    if (
      !t.isIfStatement(statement) ||
      statement.alternate ||
      !containsDocumentTypeof(statement.test)
    )
      continue;
    if (statement.start == null || statement.end == null)
      throw new SlideSourceError("Document guard has no source location.");
    ranges.push({ start: statement.start, end: statement.end });
  }
  if (ranges.length) return ranges;
  return [];
}

function containsDocumentTypeof(node: t.Node): boolean {
  let found = false;
  walkAll(node, (child) => {
    if (
      t.isUnaryExpression(child, { operator: "typeof" }) &&
      t.isIdentifier(child.argument, { name: "document" })
    )
      found = true;
  });
  return found;
}

function replaceRangesWithSpaces(
  source: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  let result = source;
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    const blank = source.slice(range.start, range.end).replace(/[^\r\n]/g, " ");
    result = result.slice(0, range.start) + blank + result.slice(range.end);
  }
  return result;
}

function addSourceLocations(source: string, ast: t.File): string {
  const edits: Array<{ at: number; value: string }> = [];
  walkAll(ast, (node) => {
    if (!t.isJSXOpeningElement(node) || node.end == null || !node.loc) return;
    const beforeClose = node.selfClosing ? node.end - 2 : node.end - 1;
    edits.push({
      at: beforeClose,
      value: ` data-slide-loc="${node.loc.start.line}:${node.loc.start.column}"`,
    });
  });
  let result = source;
  for (const edit of edits.sort((a, b) => b.at - a.at))
    result = result.slice(0, edit.at) + edit.value + result.slice(edit.at);
  return result;
}

function instrumentBoundedCollectionCalls(source: string, ast: t.File): string {
  type Target = {
    node: t.CallExpression | t.MemberExpression;
    start: number;
    end: number;
    kind: "call" | "computed";
    method?: string;
    children: Target[];
  };
  const targets: Target[] = [];
  walkAll(ast, (node) => {
    if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
      const method = staticMemberProperty(node.callee);
      if (
        method &&
        BOUNDED_MEMBER_METHODS.has(method) &&
        node.start != null &&
        node.end != null
      ) {
        targets.push({
          node,
          start: node.start,
          end: node.end,
          kind: "call",
          method,
          children: [],
        });
      }
      return;
    }
    if (
      t.isMemberExpression(node) &&
      node.computed &&
      !t.isStringLiteral(node.property) &&
      !t.isNumericLiteral(node.property) &&
      node.start != null &&
      node.end != null
    ) {
      targets.push({
        node,
        start: node.start,
        end: node.end,
        kind: "computed",
        children: [],
      });
    }
  });
  targets.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const roots: Target[] = [];
  const stack: Target[] = [];
  for (const target of targets) {
    while (stack.length) {
      const parent = stack[stack.length - 1]!;
      if (target.start >= parent.start && target.end <= parent.end) break;
      stack.pop();
    }
    if (stack.length) stack[stack.length - 1]!.children.push(target);
    else roots.push(target);
    stack.push(target);
  }

  function transformRange(
    start: number,
    end: number,
    children: Target[],
  ): string {
    let cursor = start;
    let result = "";
    for (const child of children) {
      if (child.start < cursor || child.start < start || child.end > end)
        continue;
      result += source.slice(cursor, child.start) + transformTarget(child);
      cursor = child.end;
    }
    return result + source.slice(cursor, end);
  }

  function transformTarget(target: Target): string {
    if (target.kind === "computed") {
      const member = target.node as t.MemberExpression;
      if (
        member.object.start == null ||
        member.object.end == null ||
        member.property.start == null ||
        member.property.end == null
      ) {
        throw new SlideSourceError(
          "Computed slide access has no source location.",
        );
      }
      return `__slideRuntimeGet(${transformRange(member.object.start, member.object.end, target.children)}, ${transformRange(member.property.start, member.property.end, target.children)})`;
    }
    const call = target.node as t.CallExpression;
    const callee = call.callee;
    if (
      !t.isMemberExpression(callee) ||
      callee.object.start == null ||
      callee.object.end == null
    ) {
      throw new SlideSourceError(
        "Bounded slide method has no source location.",
      );
    }
    const receiver = transformRange(
      callee.object.start,
      callee.object.end,
      target.children,
    );
    const args = call.arguments.map((argument) => {
      if (
        t.isSpreadElement(argument) ||
        t.isArgumentPlaceholder(argument) ||
        argument.start == null ||
        argument.end == null
      ) {
        throw new SlideSourceError(
          "Spread and partial method calls are not supported in slide source.",
        );
      }
      return transformRange(argument.start, argument.end, target.children);
    });
    const name = {
      map: "__slideRuntimeMap",
      push: "__slideRuntimePush",
      join: "__slideRuntimeJoin",
      padStart: "__slideRuntimePadStart",
      replace: "__slideRuntimeReplace",
    }[target.method!]!;
    return `${name}(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
  }

  return transformRange(0, source.length, roots);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampPage(current: number, total: number): number {
  const safeTotal = clampPageTotal(total);
  const safeCurrent = Number.isFinite(current) ? Math.trunc(current) : 1;
  return Math.max(1, Math.min(safeTotal, safeCurrent));
}

function clampPageTotal(total: number): number {
  const safeTotal = Number.isFinite(total) ? Math.trunc(total) : 1;
  return Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, safeTotal));
}

const slidePageShim = String.raw`
import React, { Children, cloneElement, createContext, isValidElement, useContext } from "react";
const Context = createContext(null);
const Budget = { values: 0, bytes: 0, stepCount: 0, remainingSteps: Infinity };
const MAX_VALUES = 50_000;
const MAX_BYTES = 16 * 1024 * 1024;
function fail(message) { throw new Error(message); }
function reserve(values, bytes = 0) { if (!Number.isSafeInteger(values) || values < 0 || Budget.values + values > MAX_VALUES) fail("Slide render exceeded its value budget."); if (!Number.isSafeInteger(bytes) || bytes < 0 || Budget.bytes + bytes > MAX_BYTES) fail("Slide render exceeded its memory estimate."); Budget.values += values; Budget.bytes += bytes; }
function estimate(value, depth = 0, seen = new Set()) { if (depth > 16) fail("Slide data is nested too deeply."); if (typeof value === "string") { reserve(1, value.length * 2); return; } if (value == null || typeof value === "boolean" || typeof value === "number") { reserve(1, 16); return; } if (typeof value === "function") { reserve(1, 64); return; } if (typeof value !== "object" || seen.has(value)) { reserve(1, 32); return; } seen.add(value); reserve(1, 64); if (Array.isArray(value)) { if (value.length > MAX_VALUES) fail("Slide data array is too large."); for (const child of value) estimate(child, depth + 1, seen); return; } const keys = Object.keys(value); if (keys.length > 256) fail("Slide data object is too large."); for (const key of keys) estimate(value[key], depth + 1, seen); }
export function __slideRuntimeReset(revealedSteps) { Budget.values = 0; Budget.bytes = 0; Budget.stepCount = 0; Budget.remainingSteps = revealedSteps == null ? Infinity : revealedSteps; }
export function __slideRuntimeStepCount() { return Budget.stepCount; }
export function __slideRuntimeGet(target, key) { if (typeof key === "string" && /^(?:0|[1-9][0-9]{0,5})$/.test(key)) key = Number(key); if (!Number.isSafeInteger(key) || key < 0 || key > MAX_VALUES) fail("Computed slide access must use a bounded array index."); if (Array.isArray(target) && key < target.length) return target[key]; if (typeof target === "string" && key < target.length) return target[key]; return undefined; }
export function __slideRuntimeMap(array, callback, thisArg) { if (!Array.isArray(array) || typeof callback !== "function") fail("Only static arrays can be mapped in slide source."); if (array.length > MAX_VALUES) fail("Slide render exceeded its map budget."); reserve(array.length, array.length * 8); const result = new Array(array.length); for (let index = 0; index < array.length; index++) { if (!(index in array)) continue; const value = callback.call(thisArg, array[index], index, array); estimate(value); result[index] = value; } return result; }
export function __slideRuntimePush(array, ...values) { if (!Array.isArray(array) || values.some((value) => value === undefined)) fail("Only explicit values can be appended in slide source."); if (array.length + values.length > MAX_VALUES) fail("Slide render exceeded its array budget."); for (const value of values) estimate(value); for (const value of values) array[array.length] = value; return array.length; }
export function __slideRuntimeJoin(array, separator = ",") { if (!Array.isArray(array) || array.length > MAX_VALUES || !isPrimitive(separator)) fail("Only bounded primitive arrays can be joined in slide source."); reserve(array.length, 0); if (!array.every(isPrimitive)) fail("Only bounded primitive arrays can be joined in slide source."); const joiner = String(separator); let length = Math.max(0, array.length - 1) * joiner.length; for (const value of array) length += value == null ? 0 : String(value).length; if (length > 1024 * 1024) fail("Slide render string is too large."); reserve(1, length * 2); return array.join(joiner); }
export function __slideRuntimePadStart(value, length, padding) { if (!isPrimitive(value) || (padding !== undefined && !isPrimitive(padding))) fail("Slide padding accepts primitive text only."); const text = String(value); const requested = Number(length); if (!Number.isFinite(requested) || requested > 1024 * 1024 || requested < 0) fail("Slide padding is out of bounds."); const outputLength = Math.max(text.length, Math.trunc(requested)); if (outputLength > 1024 * 1024) fail("Slide padding is out of bounds."); reserve(1, outputLength * 2); return text.padStart(requested, padding === undefined ? " " : String(padding)); }
export function __slideRuntimeReplace(value, pattern, replacement) { if (!isPrimitive(value) || typeof replacement !== "string" || replacement.includes("$") || (typeof pattern !== "string" && !(pattern instanceof RegExp))) fail("Slide replacement must use primitive text and a literal replacement string."); const text = String(value); const matches = []; if (pattern instanceof RegExp) { const regex = new RegExp(pattern.source, pattern.flags); let match; while ((match = regex.exec(text))) { reserve(1, 24); matches.push({ index: match.index, length: match[0].length }); if (!regex.global) break; if (match[0].length === 0) regex.lastIndex++; if (matches.length > MAX_VALUES) fail("Slide replacement has too many matches."); } } else { const search = String(pattern); let cursor = 0; if (!search) { reserve(1, 24); matches.push({ index: 0, length: 0 }); } else while ((cursor = text.indexOf(search, cursor)) !== -1) { reserve(1, 24); matches.push({ index: cursor, length: search.length }); cursor += search.length; if (matches.length > MAX_VALUES) fail("Slide replacement has too many matches."); } } const outputLength = text.length + matches.length * replacement.length - matches.reduce((size, match) => size + match.length, 0); if (outputLength > 1024 * 1024) fail("Slide render string is too large."); reserve(matches.length * 2 + 1, outputLength * 2); const parts = new Array(matches.length * 2 + 1); let cursor = 0; let part = 0; for (const match of matches) { parts[part++] = text.slice(cursor, match.index); parts[part++] = replacement; cursor = match.index + match.length; } parts[part] = text.slice(cursor); return parts.join(""); }
function isPrimitive(value) { return value == null || ["string", "number", "boolean"].includes(typeof value); }
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;
export const defaultDesign = Object.freeze({
  palette: Object.freeze({ bg: "#f7f5f0", text: "#1a1814", accent: "#6d4cff" }), // guard:allow-raw-color — default generated slide palette, not app chrome.
  fonts: Object.freeze({
    display: 'Georgia, "Times New Roman", serif',
    body: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
  }),
  typeScale: Object.freeze({ hero: 168, body: 36 }),
  radius: 12,
});
export function designToCssVars(design) {
  return {
    "--osd-bg": design.palette.bg,
    "--osd-text": design.palette.text,
    "--osd-accent": design.palette.accent,
    "--osd-font-display": design.fonts.display,
    "--osd-font-body": design.fonts.body,
    "--osd-size-hero": design.typeScale.hero + "px",
    "--osd-size-body": design.typeScale.body + "px",
    "--osd-radius": design.radius + "px",
  };
}
export function cssVarsToString(vars) {
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) fail("CSS variables must be a map.");
  const keys = Object.keys(vars);
  if (keys.length > 64) fail("CSS variable map exceeds 64 entries.");
  let outputLength = Math.max(0, keys.length - 1);
  for (const key of keys) {
    const value = vars[key];
    if (!/^--[A-Za-z_][A-Za-z0-9_-]{0,125}$/.test(key)) fail("CSS variable names must be bounded custom properties.");
    if (typeof value !== "string" || value.length > 160 || /[\\\u0000-\u001f\u007f;{}<>@]|\/\*|\*\/|url\s*\(/i.test(value)) fail("CSS variable values must be safe scalar text.");
    outputLength += key.length + value.length + 5;
    if (outputLength > 64 * 1024) fail("CSS variable text is too large.");
  }
  return keys.map((key) => "  " + key + ": " + vars[key] + ";").join("\n");
}
export function SlideRuntimeProvider({ value, children }) { __slideRuntimeReset(value.revealedSteps); return React.createElement(Context.Provider, { value }, children); }
export function useSlidePageNumber() { const context = useContext(Context); if (!context) fail("useSlidePageNumber must be called from a rendered slide page."); return { current: context.page.current, total: context.page.total }; }
export function useIsActivePage() { return useContext(Context)?.isActivePage ?? false; }
export function Step({ children, duration = 180, _revealed }) { const revealed = _revealed ?? true; return React.createElement("div", { "data-osd-step": revealed ? "revealed" : "pending", style: { opacity: revealed ? 1 : 0, visibility: revealed ? "visible" : "hidden", transition: "opacity " + duration + "ms cubic-bezier(0, 0, 0.2, 1)" } }, children); }
export function Steps({ children }) { const childrenArray = Children.toArray(children); let count = 0; for (const child of childrenArray) if (isValidElement(child) && child.type === Step) count++; Budget.stepCount += count; const revealed = Math.min(count, Budget.remainingSteps); Budget.remainingSteps = Math.max(0, Budget.remainingSteps - revealed); let index = 0; return React.createElement(React.Fragment, null, ...childrenArray.map((child, key) => { if (isValidElement(child) && child.type === Step) { const stepIndex = index++; return cloneElement(child, { key: child.key ?? key, _revealed: stepIndex < revealed }); } return child; })); }
export function ImagePlaceholder({ hint, label, children, width, height, style, className, ...props }) { const description = typeof hint === "string" ? hint : typeof label === "string" ? label : "Image placeholder"; return React.createElement("div", { "data-slide-loc": props["data-slide-loc"], "data-slide-placeholder": description, "data-placeholder-w": width, "data-placeholder-h": height, "aria-label": description, className, style: { width: width ?? "100%", height: height ?? "100%", border: "2px dashed currentColor", display: "flex", alignItems: "center", justifyContent: "center", ...(style && typeof style === "object" ? style : {}) } }, children ?? description); }
export function MorphElement({ id, children, as = "div", ...props }) { return React.createElement(as, { ...props, "data-osd-morph": id }, children); }
`;
