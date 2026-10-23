import { fileURLToPath } from "node:url";

import * as t from "@babel/types";
import postcss from "postcss";

import {
  SlideTransitionSchema,
  type SlideTransition,
} from "../../shared/slides-2-transition.js";
import { parseSource, walkAll } from "./slide-source-editing/babel-walk.js";
import {
  isSlideSourceWithinByteLimit,
  MAX_SLIDE_SOURCE_BYTES,
  SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
} from "./slide-source-limits.js";
import { findStaticLocalPageArray, SlideSourceError } from "./slide-source.js";
import {
  isSafeStaticSvgNoiseBackgroundCssValue,
  normalizeSvgNoiseBackgroundProps,
  SVG_NOISE_COLOR_MATRIX_VALUES,
} from "./static-svg-noise-background.js";

export const MAX_REACT_SLIDE_SOURCE_BYTES = MAX_SLIDE_SOURCE_BYTES;
export const MAX_REACT_SLIDE_AST_NODES = 50_000;
export const MAX_REACT_SLIDE_WORKER_SOURCE_LENGTH = 4 * 1024 * 1024;
export const MAX_REACT_SLIDE_LIVE_SOURCE_LENGTH = 4 * 1024 * 1024;
export const REACT_SLIDE_WORKER_TIMEOUT_MS = 2_500;

export type Slides2Design = {
  palette: { bg: string; text: string; accent: string };
  fonts: { display: string; body: string };
  typeScale: { hero: number; body: number };
  radius: number;
};

export type Slides2Meta = {
  title?: string;
  theme?: string;
  createdAt?: string;
};

export type SlideWorkerRuntime = {
  kind: "agent-native-slides-react-worker-v1";
  workerSource: string;
  liveSource?: string;
  page: { current: number; total: number };
  assetUrls: Record<string, string>;
  styles: string[];
  design?: Slides2Design;
  meta?: Slides2Meta;
  transition?: SlideTransition;
  timeoutMs: typeof REACT_SLIDE_WORKER_TIMEOUT_MS;
};

type PreparedModule = {
  source: string;
  design?: Slides2Design;
  meta?: Slides2Meta;
  transition?: SlideTransition;
  styles: string[];
};

const MAX_STYLE_LENGTH = 64 * 1024;
const MAX_TOTAL_STYLE_LENGTH = 128 * 1024;
const MAX_STATIC_VALUE_DEPTH = 16;
const MAX_STATIC_VALUE_NODES = 5_000;
const MAX_SAFE_SVG_NOISE_BACKGROUNDS_PER_RENDER = 8;
const SAFE_STATIC_SVG_NOISE_VALIDATOR =
  isSafeStaticSvgNoiseBackgroundCssValue.toString();
const SAFE_SVG_NOISE_PROPS_NORMALIZER =
  normalizeSvgNoiseBackgroundProps.toString();
const SVG_NOISE_MATRIX_JSON = JSON.stringify(SVG_NOISE_COLOR_MATRIX_VALUES);
const REDUCED_MOTION_STEPS_CSS =
  "@media (prefers-reduced-motion: reduce) { [data-slides2-step] { transition-duration: 0ms !important; } }";
const SAFE_CSS_FUNCTIONS = new Set([
  "calc",
  "clamp",
  "color",
  "color-mix",
  "conic-gradient",
  "cubic-bezier",
  "fit-content",
  "hsl",
  "hsla",
  "hwb",
  "inset",
  "lab",
  "lch",
  "linear-gradient",
  "max",
  "min",
  "minmax",
  "oklab",
  "oklch",
  "polygon",
  "radial-gradient",
  "repeating-conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeat",
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
  "steps",
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
  "clearInterval",
  "clearTimeout",
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
  "opener",
  "parent",
  "postMessage",
  "process",
  "queueMicrotask",
  "require",
  "self",
  "sessionStorage",
  "setInterval",
  "setTimeout",
  "window",
  "frames",
  "frameElement",
  "top",
  "content",
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
  "contentDocument",
  "contentWindow",
  "defaultView",
  "frameElement",
  "frames",
  "opener",
  "parent",
  "postMessage",
  "top",
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
  "isValidElement",
  "memo",
  "useCallback",
  "useContext",
  "useEffect",
  "useId",
  "useLayoutEffect",
  "useMemo",
  "useReducer",
  "useRef",
  "useState",
]);
const SAFE_WINDOW_MEMBER_PATHS = new Set([
  "window.matchMedia",
  "window.requestAnimationFrame",
  "window.cancelAnimationFrame",
  "window.setInterval",
  "window.clearInterval",
  "window.setTimeout",
  "window.clearTimeout",
  "window.performance",
  "window.performance.now",
]);
const SAFE_MEDIA_QUERY_PROPERTIES = new Set([
  "matches",
  "media",
  "addEventListener",
  "removeEventListener",
  "addListener",
  "removeListener",
]);
const SAFE_EVENT_METHODS = new Set(["preventDefault", "stopPropagation"]);
const SAFE_EVENT_PROPS = new Set([
  "onAnimationEnd",
  "onAnimationIteration",
  "onAnimationStart",
  "onBlur",
  "onChange",
  "onClick",
  "onDoubleClick",
  "onFocus",
  "onInput",
  "onKeyDown",
  "onKeyPress",
  "onKeyUp",
  "onMouseDown",
  "onMouseEnter",
  "onMouseLeave",
  "onMouseMove",
  "onMouseOut",
  "onMouseOver",
  "onMouseUp",
  "onPointerCancel",
  "onPointerDown",
  "onPointerEnter",
  "onPointerLeave",
  "onPointerMove",
  "onPointerOut",
  "onPointerOver",
  "onPointerUp",
  "onSubmit",
  "onTouchCancel",
  "onTouchEnd",
  "onTouchMove",
  "onTouchStart",
  "onTransitionEnd",
  "onWheel",
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
  "filter",
  "feturbulence",
  "fecolormatrix",
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
  "basefrequency",
  "decoding",
  "dir",
  "draggable",
  "fill",
  "fill-opacity",
  "fill-rule",
  "focusable",
  "filter",
  "in",
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
  "numoctaves",
  "offset",
  "opacity",
  "points",
  "patterntransform",
  "patternunits",
  "poster",
  "pathlength",
  "preload",
  "preserveaspectratio",
  "result",
  "r",
  "rx",
  "rel",
  "role",
  "rowspan",
  "scope",
  "seed",
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
  "stitchtiles",
  "style",
  "tabindex",
  "text-anchor",
  "title",
  "transform",
  "vector-effect",
  "values",
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
  "data-slides2-step",
  "data-slides2-step-duration",
]);

const WORKER_ENTRY = String.raw`
import React, { Children, cloneElement, createContext, isValidElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { parseFragment, serialize } from "parse5";
import postcss from "postcss";
import SlidePage from "virtual:slide-page";
import * as Slides2Core from "virtual:slide-page-shim";

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
${SAFE_STATIC_SVG_NOISE_VALIDATOR}

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
  const safeDuration = Number.isFinite(duration) ? Math.max(0, Math.min(5000, duration)) : 180;
  const revealed = _revealed ?? true;
  return React.createElement("div", {
    "data-slides2-step": revealed ? "revealed" : "pending",
    "data-slides2-step-duration": String(safeDuration),
    style: {
      opacity: revealed ? 1 : 0,
      visibility: revealed ? "visible" : "hidden",
      transition: "opacity " + safeDuration + "ms cubic-bezier(0, 0, 0.2, 1)",
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
  return React.createElement(as, { ...props, "data-slides2-morph": id }, children);
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
    const safeNoiseBackground = (property === "background" || property === "background-image") && isSafeStaticSvgNoiseBackgroundCssValue(text.trim());
    if (safeNoiseBackground) Slides2Core.__slideRuntimeCountSvgNoiseBackground();
    if (!/^(?:--[a-z0-9_-]+|[a-z][a-z0-9-]*)$/.test(property) || blockedCssProperties.has(property) || /[\\\u0000-\u001f\u007f{}<>@]|\/\*|\*\/|javascript:/i.test(text)) { child.remove(); continue; }
    if (/\b(?:url|expression|image-set|cross-fade|paint|element)\s*\(/i.test(text)) {
      const local = localSvgReferenceProperties.has(property) && /^url\(\s*#[a-z][a-z0-9_.:-]*\s*\)$/i.test(text.trim());
      if (!local && !safeNoiseBackground) { child.remove(); continue; }
    }
    const variables = [...text.matchAll(/var\(\s*(--[a-z0-9_-]+)/gi)];
    if (/\bvar\s*\(/i.test(text.replace(/var\(\s*--[a-z0-9_-]+\s*(?:,\s*[^()]*)?\)/gi, ""))) { child.remove(); continue; }
    if (variables.some((match) => !/^(?:--deck-|--ds-|--slides2-|--d$)/i.test(match[1]))) { child.remove(); continue; }
    let unsafeFunction = false;
    for (const match of text.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) {
      const name = match[1].toLowerCase();
      if ((blockedCssFunctions.has(name) || !safeCssFunctions.has(name)) && !(safeNoiseBackground && name === "url")) unsafeFunction = true;
    }
    if (unsafeFunction) child.remove();
  }
  return (rule.nodes || []).map((node) => node.toString()).join(";");
}

const svgNoiseFilterTags = new Set(["filter", "feturbulence", "fecolormatrix"]);
const svgNoiseMatrix = ${SVG_NOISE_MATRIX_JSON};
function elementChildren(node) { return (node.childNodes || []).filter((child) => child.tagName); }
function elementAttributes(node) { return Object.fromEntries((node.attrs || []).map((attribute) => [attribute.name.toLowerCase(), attribute.value])); }
function hasExactAttributes(attributes, allowed, required) { const names = Object.keys(attributes); return names.every((name) => allowed.includes(name)) && required.every((name) => Object.prototype.hasOwnProperty.call(attributes, name)); }
function collectNoiseFilterNodes(node, output = []) { if (node.tagName && svgNoiseFilterTags.has(node.tagName.toLowerCase())) output.push(node); for (const child of node.childNodes || []) collectNoiseFilterNodes(child, output); return output; }
function validateNoiseSvg(root) {
  const rootAttributes = elementAttributes(root);
  if (!hasExactAttributes(rootAttributes, ["xmlns", "aria-hidden", "focusable", "width", "height", "viewbox", "preserveaspectratio", "data-slide-loc", "data-slides2-noise", "style"], ["xmlns", "aria-hidden", "focusable", "width", "height", "viewbox", "preserveaspectratio", "style"]) || rootAttributes.xmlns !== "http://www.w3.org/2000/svg" || rootAttributes["aria-hidden"] !== "true" || rootAttributes.focusable !== "false" || rootAttributes.width !== "100%" || rootAttributes.height !== "100%" || rootAttributes.viewbox !== "0 0 220 220" || rootAttributes.preserveaspectratio !== "none" || rootAttributes.style !== "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none" || (rootAttributes["data-slide-loc"] !== undefined && !/^\d{1,6}:\d{1,6}$/.test(rootAttributes["data-slide-loc"])) || (rootAttributes["data-slides2-noise"] !== undefined && rootAttributes["data-slides2-noise"] !== "1")) fail("SVG filters must use the bounded NoiseBackground renderer.");
  const children = elementChildren(root);
  if (children.length !== 2 || children[0].tagName.toLowerCase() !== "defs" || children[1].tagName.toLowerCase() !== "rect") fail("SVG filters must use the bounded NoiseBackground renderer.");
  const defs = children[0];
  const rect = children[1];
  if ((defs.attrs || []).length !== 0) fail("SVG filter definitions cannot have attributes.");
  const definitionChildren = elementChildren(defs);
  if (definitionChildren.length !== 1 || definitionChildren[0].tagName.toLowerCase() !== "filter") fail("SVG filters must use the bounded NoiseBackground renderer.");
  const filter = definitionChildren[0];
  const filterAttributes = elementAttributes(filter);
  const filterId = filterAttributes.id;
  if (!hasExactAttributes(filterAttributes, ["id", "x", "y", "width", "height"], ["id", "x", "y", "width", "height"]) || !/^slides2-noise-\d{1,2}$/.test(filterId || "") || filterAttributes.x !== "0" || filterAttributes.y !== "0" || filterAttributes.width !== "100%" || filterAttributes.height !== "100%") fail("SVG filter bounds are invalid.");
  const filterChildren = elementChildren(filter);
  if (filterChildren.length !== 2 || filterChildren[0].tagName.toLowerCase() !== "feturbulence" || filterChildren[1].tagName.toLowerCase() !== "fecolormatrix") fail("SVG filter primitives are invalid.");
  const turbulence = elementAttributes(filterChildren[0]);
  const frequency = turbulence.basefrequency;
  const frequencyNumber = Number(frequency);
  const octaves = Number(turbulence.numoctaves);
  const seed = Number(turbulence.seed);
  if (!hasExactAttributes(turbulence, ["type", "basefrequency", "numoctaves", "seed", "stitchtiles", "result"], ["type", "basefrequency", "numoctaves", "seed", "stitchtiles", "result"]) || turbulence.type !== "fractalNoise" || !Number.isFinite(frequencyNumber) || frequencyNumber < 0.0001 || frequencyNumber > 1 || !/^\d+$/.test(turbulence.numoctaves || "") || !Number.isInteger(octaves) || octaves < 1 || octaves > 4 || !Number.isFinite(seed) || Math.abs(seed) > 10000 || turbulence.stitchtiles !== "stitch" || turbulence.result !== "noise" || elementChildren(filterChildren[0]).length !== 0) fail("SVG turbulence parameters are out of bounds.");
  const matrix = elementAttributes(filterChildren[1]);
  if (!hasExactAttributes(matrix, ["in", "type", "values"], ["in", "type", "values"]) || matrix.in !== "noise" || matrix.type !== "matrix" || matrix.values !== svgNoiseMatrix || elementChildren(filterChildren[1]).length !== 0) fail("SVG color matrix is invalid.");
  const rectAttributes = elementAttributes(rect);
  const opacity = Number(rectAttributes.opacity);
  if (!hasExactAttributes(rectAttributes, ["width", "height", "filter", "opacity", "fill"], ["width", "height", "filter", "opacity", "fill"]) || rectAttributes.width !== "100%" || rectAttributes.height !== "100%" || rectAttributes.filter !== "url(#" + filterId + ")" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1 || !/^(?:white|#[0-9a-f]{3}(?:[0-9a-f]{3})?)$/i.test(rectAttributes.fill || "") || elementChildren(rect).length !== 0) fail("SVG noise texture is invalid.");
  return collectNoiseFilterNodes(root);
}
function validateNoiseSvgTree(fragment) {
  const svgRoots = [];
  const filterNodes = [];
  const stack = [...(fragment.childNodes || [])];
  while (stack.length) {
    const node = stack.pop();
    if (node.tagName?.toLowerCase() === "svg") svgRoots.push(node);
    if (node.tagName && svgNoiseFilterTags.has(node.tagName.toLowerCase())) filterNodes.push(node);
    for (const child of node.childNodes || []) stack.push(child);
  }
  const validated = new Set();
  let count = 0;
  for (const root of svgRoots) {
    const nestedFilters = collectNoiseFilterNodes(root);
    if (!nestedFilters.length) continue;
    for (const node of validateNoiseSvg(root)) validated.add(node);
    const attributes = elementAttributes(root);
    const builtIn = attributes["data-slides2-noise"] === "1";
    if (!builtIn) Slides2Core.__slideRuntimeCountSvgNoiseBackground();
    if (builtIn) root.attrs = (root.attrs || []).filter((attribute) => attribute.name !== "data-slides2-noise");
    count++;
    if (count > ${MAX_SAFE_SVG_NOISE_BACKGROUNDS_PER_RENDER}) fail("Slide uses too many filtered backgrounds.");
  }
  if (filterNodes.some((node) => !validated.has(node))) fail("SVG filters must use the bounded NoiseBackground renderer.");
}

function sanitizeHtml(html) {
  if (typeof html !== "string" || html.length > MAX_HTML) fail("Slide HTML is too large.");
  const fragment = parseFragment(html);
  const topLevelChildren = fragment.childNodes || [];
  for (let index = topLevelChildren.length - 1; index >= 0; index--) {
    const node = topLevelChildren[index];
    if (node.tagName?.toLowerCase() !== "link") continue;
    const attributes = new Map(
      (node.attrs || []).map((attribute) => [
        attribute.name.toLowerCase(),
        attribute.value,
      ]),
    );
    // React's server renderer prepends this hint; the host resolves the handle on the image itself.
    if (
      attributes.get("rel")?.toLowerCase() === "preload" &&
      attributes.get("as")?.toLowerCase() === "image" &&
      /^asset:\/\/[A-Za-z0-9_-]{1,200}$/.test(
        attributes.get("href") || "",
      )
    ) {
      topLevelChildren.splice(index, 1);
    }
  }
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
      if (name === "href" && !/^#[A-Za-z_][A-Za-z0-9_.:-]{0,200}$/.test(value)) {
        node.attrs.splice(node.attrs.indexOf(attribute), 1);
        continue;
      }
      if (name === "id" && !/^[A-Za-z_][A-Za-z0-9_.:-]{0,200}$/.test(value)) node.attrs.splice(node.attrs.indexOf(attribute), 1);
      if (name === "data-slide-loc" && !/^\d{1,6}:\d{1,6}$/.test(value)) node.attrs.splice(node.attrs.indexOf(attribute), 1);
    }
    if (tagName === "source" && !(node.attrs || []).some((attribute) => attribute.name.toLowerCase() === "src")) fail("Video sources need an uploaded asset handle.");
    for (const child of node.childNodes || []) stack.push({ node: child, depth: depth + 1, parent: node });
  }
  for (const video of videos) {
    const hasSource = (video.attrs || []).some((attribute) => attribute.name.toLowerCase() === "src") || (video.childNodes || []).some((child) => child.tagName?.toLowerCase() === "source" && (child.attrs || []).some((attribute) => attribute.name.toLowerCase() === "src"));
    if (!hasSource) fail("Video elements need an uploaded asset source.");
  }
  validateNoiseSvgTree(fragment);
  const safe = serialize(fragment);
  if (safe.length > MAX_HTML) fail("Sanitized slide HTML is too large.");
  return safe;
}

function handleMessage(event) {
  const request = event.data;
  const requestId = request && typeof request.requestId === "string" ? request.requestId.slice(0, 80) : "";
  try {
    if (!request || request.type !== "render" || !requestId || !request.page || !Number.isSafeInteger(request.page.current) || !Number.isSafeInteger(request.page.total) || request.page.current < 1 || request.page.total < request.page.current || (request.revealedSteps !== null && (!Number.isInteger(request.revealedSteps) || request.revealedSteps < 0 || request.revealedSteps > 500)) || typeof request.isActivePage !== "boolean") fail("Slide render request is invalid.");
    Slides2Core.__slideRuntimeReset(request.revealedSteps, false);
    const context = { page: request.page, isActivePage: request.isActivePage, revealedSteps: request.revealedSteps, countBuiltinNoiseBackgrounds: false };
    const markup = renderToStaticMarkup(React.createElement(Slides2Core.SlideRuntimeProvider, { value: context }, React.createElement(SlidePage)));
    const html = sanitizeHtml(markup);
    postMessage({ type: "rendered", requestId, html, stepCount: Math.min(500, Slides2Core.__slideRuntimeStepCount()) });
  } catch (error) {
    postMessage({ type: "error", requestId, message: error instanceof Error ? error.message.slice(0, 300) : "Slide rendering failed." });
  }
}
self.onmessage = handleMessage;
`;

const LIVE_ENTRY = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import SlidePage from "virtual:slide-page";
import * as Slides2Core from "virtual:slide-page-shim";

function makeWindowApi(onError) {
  let active = true;
  const frames = new Map();
  const mediaQueries = new Map();
  const timers = new Map();
  const hostWindow = window;
  let frameCount = 0;
  let timerScheduleCount = 0;
  let timerCallbackWindowStart = hostWindow.performance.now();
  let timerCallbacksInWindow = 0;
  let nextTimerId = 0;
  let mediaQueryListenerCount = 0;
  const MAX_ACTIVE_TIMERS = 64;
  const MAX_TIMER_SCHEDULES = 256;
  const MAX_TIMER_CALLBACKS_PER_WINDOW = 256;
  const TIMER_CALLBACK_WINDOW_MS = 10000;
  const MAX_TIMER_DELAY_MS = 300000;
  const MIN_INTERVAL_DELAY_MS = 50;
  const MAX_MEDIA_QUERY_LISTENERS = 64;
  function clearTimer(id) {
    const timer = timers.get(id);
    if (!timer) return;
    timers.delete(id);
    if (timer.interval) hostWindow.clearInterval(timer.handle);
    else hostWindow.clearTimeout(timer.handle);
  }
  function scheduleTimer(callback, delay, interval) {
    if (!active) return 0;
    if (typeof callback !== "function") throw new Error("Slide timers require a function callback.");
    const delayMs = delay === undefined ? 0 : delay;
    if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_TIMER_DELAY_MS) {
      throw new Error("Slide timer delay is out of bounds.");
    }
    if (timers.size >= MAX_ACTIVE_TIMERS || timerScheduleCount >= MAX_TIMER_SCHEDULES) {
      throw new Error("Slide exceeded its timer schedule budget.");
    }
    timerScheduleCount++;
    const id = ++nextTimerId;
    const tick = () => {
      if (!active || !timers.has(id)) return;
      const now = hostWindow.performance.now();
      if (now - timerCallbackWindowStart >= TIMER_CALLBACK_WINDOW_MS) {
        timerCallbackWindowStart = now;
        timerCallbacksInWindow = 0;
      }
      timerCallbacksInWindow++;
      if (timerCallbacksInWindow > MAX_TIMER_CALLBACKS_PER_WINDOW) {
        clearTimer(id);
        onError(new Error("Slide exceeded its timer callback budget."));
        return;
      }
      if (!interval) timers.delete(id);
      try {
        callback();
      } catch (error) {
        if (interval) clearTimer(id);
        onError(error);
      }
    };
    const handle = interval
      ? hostWindow.setInterval(tick, Math.max(MIN_INTERVAL_DELAY_MS, delayMs))
      : hostWindow.setTimeout(tick, delayMs);
    timers.set(id, { handle, interval });
    return id;
  }
  const api = {
    matchMedia(query) {
      if (query !== "(prefers-reduced-motion: reduce)" && query !== "(prefers-reduced-motion: no-preference)") {
        throw new Error("Only reduced-motion media queries are available to slide source.");
      }
      let record = mediaQueries.get(query);
      if (!record) {
        const hostQuery = hostWindow.matchMedia(query);
        const listeners = new Map();
        const emit = () => {
          const event = Object.freeze({ type: "change", media: query, matches: Boolean(hostQuery.matches) });
          for (const listener of listeners.values()) listener(event);
        };
        const add = (type, listener) => {
          if (!active || type !== "change" || typeof listener !== "function" || listeners.has(listener)) return;
          if (mediaQueryListenerCount >= MAX_MEDIA_QUERY_LISTENERS) {
            throw new Error("Slide exceeded its media query listener budget.");
          }
          const callback = emitFor(listener);
          listeners.set(listener, callback);
          mediaQueryListenerCount++;
          if (typeof hostQuery.addEventListener === "function") hostQuery.addEventListener("change", callback);
          else hostQuery.addListener?.(callback);
        };
        const remove = (type, listener) => {
          if (type !== "change") return;
          const callback = listeners.get(listener);
          if (!callback) return;
          listeners.delete(listener);
          mediaQueryListenerCount--;
          if (typeof hostQuery.removeEventListener === "function") hostQuery.removeEventListener("change", callback);
          else hostQuery.removeListener?.(callback);
        };
        function emitFor(listener) {
          return () => listener(Object.freeze({ type: "change", media: query, matches: Boolean(hostQuery.matches) }));
        }
        record = Object.freeze({
          get matches() { return Boolean(hostQuery.matches); },
          media: query,
          addEventListener: add,
          removeEventListener: remove,
          addListener: (listener) => add("change", listener),
          removeListener: (listener) => remove("change", listener),
          dispose() {
            for (const callback of listeners.values()) {
              if (typeof hostQuery.removeEventListener === "function") hostQuery.removeEventListener("change", callback);
              else hostQuery.removeListener?.(callback);
            }
            mediaQueryListenerCount -= listeners.size;
            listeners.clear();
          },
        });
        mediaQueries.set(query, record);
      }
      return record;
    },
    setTimeout(callback, delay) {
      return scheduleTimer(callback, delay, false);
    },
    clearTimeout(id) {
      clearTimer(id);
    },
    setInterval(callback, delay) {
      return scheduleTimer(callback, delay, true);
    },
    clearInterval(id) {
      clearTimer(id);
    },
    requestAnimationFrame(callback) {
      if (!active || typeof callback !== "function") return 0;
      if (frames.size >= 120 || frameCount >= 1200) throw new Error("Slide animation exceeded its frame budget.");
      frameCount++;
      let id = 0;
      id = hostWindow.requestAnimationFrame((time) => {
        frames.delete(id);
        if (!active) return;
        try { callback(time); } catch (error) { onError(error); }
      });
      frames.set(id, true);
      return id;
    },
    cancelAnimationFrame(id) {
      if (!frames.has(id)) return;
      frames.delete(id);
      hostWindow.cancelAnimationFrame(id);
    },
    performance: Object.freeze({ now: () => hostWindow.performance.now() }),
    dispose() {
      if (!active) return;
      active = false;
      for (const id of frames.keys()) hostWindow.cancelAnimationFrame(id);
      frames.clear();
      for (const id of timers.keys()) clearTimer(id);
      for (const query of mediaQueries.values()) query.dispose();
      mediaQueries.clear();
    },
  };
  return Object.freeze(api);
}

function mount(container, context, onCommit, onError) {
  if (!(container instanceof HTMLElement) || typeof onCommit !== "function") throw new Error("Live slide mount request is invalid.");
  const windowApi = makeWindowApi(onError);
  Slides2Core.__slideRuntimeConfigureLive({ window: windowApi, resolveAssetUrl: context.resolveAssetUrl });
  const root = createRoot(container);
  let renderContext = { page: context.page, isActivePage: Boolean(context.isActivePage), revealedSteps: null };
  let renderVersion = 0;
  let disposed = false;
  function CommitProbe({ children }) {
    React.useLayoutEffect(() => {
      if (!disposed) onCommit(container.querySelectorAll("[data-slides2-step]").length);
    });
    return children;
  }
  function PageHost() {
    return React.createElement(Slides2Core.SlideRuntimeProvider, { value: renderContext },
      React.createElement(CommitProbe, null, React.createElement(SlidePage)));
  }
  function render() {
    renderVersion++;
    root.render(React.createElement(PageHost, { key: renderVersion }));
  }
  render();
  return Object.freeze({
    update(next) {
      if (disposed || !next || !next.page) return;
      renderContext = { page: next.page, isActivePage: Boolean(next.isActivePage), revealedSteps: null };
      render();
    },
    unmount() {
      if (disposed) return;
      disposed = true;
      windowApi.dispose();
      root.unmount();
      Slides2Core.__slideRuntimeConfigureLive(null);
    },
  });
}

Object.defineProperty(window, "__slideRuntimeLive", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({ mount }),
});
`;

const LIVE_REACT_SHIM = String.raw`
import * as ReactBase from "react";
import { jsx as baseJsx, jsxs as baseJsxs, Fragment } from "react/jsx-runtime";
import { __slideRuntimeCountSvgNoiseBackground, __slideRuntimeResolveAssetUrl } from "virtual:slide-page-shim";

const safeTags = new Set(${JSON.stringify([...SAFE_HTML_TAGS])});
const safeAttributes = new Set(${JSON.stringify([...SAFE_HTML_ATTRIBUTES])});
const safeEvents = new Set(${JSON.stringify([...SAFE_EVENT_PROPS])});
const safeCssFunctions = new Set(${JSON.stringify([...SAFE_CSS_FUNCTIONS])});
const blockedCssProperties = new Set(${JSON.stringify([...BLOCKED_CSS_PROPERTIES])});
const aliases = Object.freeze({ className: "class", tabIndex: "tabindex", viewBox: "viewbox", preserveAspectRatio: "preserveaspectratio", patternTransform: "patterntransform", patternUnits: "patternunits", pathLength: "pathlength", strokeWidth: "stroke-width", strokeLinecap: "stroke-linecap", strokeLinejoin: "stroke-linejoin", strokeDasharray: "stroke-dasharray", strokeDashoffset: "stroke-dashoffset", strokeOpacity: "stroke-opacity", fillOpacity: "fill-opacity", fillRule: "fill-rule", stopColor: "stop-color", stopOpacity: "stop-opacity", markerEnd: "marker-end", markerMid: "marker-mid", markerStart: "marker-start", shapeRendering: "shape-rendering", vectorEffect: "vector-effect", colSpan: "colspan", rowSpan: "rowspan", autoPlay: "autoplay", playsInline: "playsinline" });
${SAFE_STATIC_SVG_NOISE_VALIDATOR}

function fail(message) { throw new Error(message); }
function cssName(name) { return name.startsWith("--") ? name : name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()).toLowerCase(); }
function safeCssValue(value, property) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1000000) fail("Slide style number is out of bounds.");
    return value;
  }
  const safeNoiseBackground = (property === "background" || property === "background-image") && isSafeStaticSvgNoiseBackgroundCssValue(value);
  if (safeNoiseBackground) __slideRuntimeCountSvgNoiseBackground();
  if (typeof value !== "string" || value.length > 4096 || /[\\\u0000-\u001f\u007f{}<>@]|\/\*|\*\/|javascript:/i.test(value) || (/url\s*\(/i.test(value) && !safeNoiseBackground)) fail("Slide style value is not allowed.");
  for (const match of value.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) {
    const name = match[1].toLowerCase();
    if (!safeCssFunctions.has(name) && !(safeNoiseBackground && name === "url")) fail("Slide style function " + name + " is not allowed.");
  }
  return value;
}
function sanitizeStyle(style) {
  if (style == null) return style;
  if (typeof style !== "object" || Array.isArray(style)) fail("Slide styles must be a static property map.");
  const keys = Object.keys(style);
  if (keys.length > 100) fail("Slide style map is too large.");
  const clean = {};
  for (const key of keys) {
    const name = cssName(key);
    if (!/^(?:--[A-Za-z_][A-Za-z0-9_-]{0,125}|[a-z][a-z0-9-]{0,80})$/.test(name) || blockedCssProperties.has(name)) fail("Slide style property is not allowed.");
    const value = style[key];
    if (value == null || typeof value === "boolean") continue;
    clean[key] = safeCssValue(value, name);
  }
  return clean;
}
function targetSummary(target) {
  if (!(target instanceof Element)) return null;
  const summary = { tagName: target.tagName.toLowerCase(), id: String(target.id || "").slice(0, 200), className: String(target.className?.baseVal ?? target.className ?? "").slice(0, 500) };
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    summary.value = String(target.value).slice(0, 1000);
    summary.checked = Boolean(target.checked);
  }
  return Object.freeze(summary);
}
function eventFacade(event) {
  const value = { type: String(event.type).slice(0, 40), target: targetSummary(event.target), currentTarget: targetSummary(event.currentTarget), defaultPrevented: Boolean(event.defaultPrevented), timeStamp: Number(event.timeStamp) || 0 };
  for (const key of ["button", "buttons", "clientX", "clientY", "pointerId", "pointerType", "key", "code", "keyCode", "which", "detail", "deltaX", "deltaY", "deltaMode", "ctrlKey", "shiftKey", "altKey", "metaKey", "repeat", "charCode"]) {
    const field = event[key];
    if (["string", "number", "boolean"].includes(typeof field)) value[key] = typeof field === "string" ? field.slice(0, 100) : field;
  }
  value.preventDefault = () => event.preventDefault();
  value.stopPropagation = () => event.stopPropagation();
  return Object.freeze(value);
}
function sanitizeProps(type, props) {
  const source = props && typeof props === "object" ? props : {};
  for (const key of Object.keys(source)) if (key === "ref" || key === "dangerouslySetInnerHTML" || key === "innerHTML") fail("Slide DOM property is not allowed.");
  if (typeof type !== "string") return source;
  const tag = type.toLowerCase();
  if (!safeTags.has(tag)) fail("Slide element is not allowed.");
  const clean = {};
  let hasInteraction = false;
  for (const key of Object.keys(source)) {
    if (key === "children") {
      clean.children = source.children;
      continue;
    }
    if (key === "key") continue;
    const value = source[key];
    if (/^on/i.test(key)) {
      if (!safeEvents.has(key) || (value != null && typeof value !== "function")) fail("Slide event handler is not allowed.");
      if (typeof value === "function") clean[key] = (event) => value(eventFacade(event));
      hasInteraction = true;
      continue;
    }
    if (key === "style") { clean.style = sanitizeStyle(value); continue; }
    const name = aliases[key] ?? key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()).toLowerCase();
    if (name.startsWith("data-slides2-")) fail("Slide runtime attributes are reserved.");
    if (!(safeAttributes.has(name) || /^(?:aria|data)-[a-z0-9_.:-]{1,120}$/.test(name))) fail("Slide attribute is not allowed.");
    if (name === "src" || name === "poster") {
      if ((name === "poster" && tag !== "video") || (name === "src" && !["img", "video", "source"].includes(tag)) || typeof value !== "string" || !/^asset:\/\/[A-Za-z0-9_-]{1,200}$/.test(value)) fail("Media references must use uploaded asset handles.");
      clean[key] = __slideRuntimeResolveAssetUrl(value);
      continue;
    }
    if (name === "href" && (typeof value !== "string" || !/^#[A-Za-z_][A-Za-z0-9_.:-]{0,200}$/.test(value))) fail("Links must use local slide anchors.");
    if (name === "id" && (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,200}$/.test(value))) fail("Slide ids are invalid.");
    if (name === "data-slide-loc" && (typeof value !== "string" || !/^\d{1,6}:\d{1,6}$/.test(value))) fail("Slide source locations are invalid.");
    if (name === "data-slides2-step" && value !== "revealed" && value !== "pending") fail("Slide step markers are invalid.");
    if (name === "data-slides2-step-duration" && (typeof value !== "string" || !/^\d{1,4}$/.test(value) || Number(value) > 5000)) fail("Slide step duration is invalid.");
    if (typeof value === "string" && value.length > 4096 || typeof value === "number" && !Number.isFinite(value)) fail("Slide attribute value is out of bounds.");
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) clean[key] = value;
    else fail("Slide attribute values must be primitive.");
  }
  if (hasInteraction) clean["data-slides2-interactive"] = "";
  return clean;
}
function createElement(type, props, ...children) { return ReactBase.createElement(type, sanitizeProps(type, props), ...children); }
function cloneElement(element, props, ...children) {
  if (!ReactBase.isValidElement(element)) fail("Slide element cloning is invalid.");
  const merged = { ...element.props, ...(props || {}) };
  const clean = sanitizeProps(element.type, merged);
  return children.length ? ReactBase.cloneElement(element, clean, ...children) : ReactBase.cloneElement(element, clean);
}
function jsx(type, props, key) { return baseJsx(type, sanitizeProps(type, props), key); }
function jsxs(type, props, key) { return baseJsxs(type, sanitizeProps(type, props), key); }
const Children = Object.freeze({ count: ReactBase.Children.count, forEach: ReactBase.Children.forEach, map: ReactBase.Children.map, only: ReactBase.Children.only, toArray: ReactBase.Children.toArray });
const React = Object.freeze({ Children, Fragment, cloneElement, createContext: ReactBase.createContext, createElement, isValidElement: ReactBase.isValidElement, memo: ReactBase.memo, useCallback: ReactBase.useCallback, useContext: ReactBase.useContext, useEffect: ReactBase.useEffect, useId: ReactBase.useId, useLayoutEffect: ReactBase.useLayoutEffect, useMemo: ReactBase.useMemo, useReducer: ReactBase.useReducer, useRef: ReactBase.useRef, useState: ReactBase.useState });
export { Children, Fragment, cloneElement, createElement, jsx, jsxs };
export const createContext = ReactBase.createContext;
export const isValidElement = ReactBase.isValidElement;
export const memo = ReactBase.memo;
export const useCallback = ReactBase.useCallback;
export const useContext = ReactBase.useContext;
export const useEffect = ReactBase.useEffect;
export const useId = ReactBase.useId;
export const useLayoutEffect = ReactBase.useLayoutEffect;
export const useMemo = ReactBase.useMemo;
export const useReducer = ReactBase.useReducer;
export const useRef = ReactBase.useRef;
export const useState = ReactBase.useState;
export default React;
`;

export function prepareReactSlideSource(sourceTsx: string): PreparedModule {
  if (!sourceTsx.trim() || !isSlideSourceWithinByteLimit(sourceTsx)) {
    throw new SlideSourceError(SLIDE_SOURCE_BYTE_LIMIT_MESSAGE);
  }
  const original = parseModule(sourceTsx);
  const staticBindings = collectStaticBindings(original);
  const exportValues = readModuleMetadata(original, staticBindings);
  const extractedStyles = collectModuleStyles(original, staticBindings);
  const styles = sanitizeStyles(extractedStyles);
  const reducedMotionStepStyle = sanitizeStyles([REDUCED_MOTION_STEPS_CSS])[0];
  if (styles.length === 0) {
    if (reducedMotionStepStyle) styles.push(reducedMotionStepStyle);
  } else if (reducedMotionStepStyle) {
    const lastStyleIndex = styles.length - 1;
    styles[lastStyleIndex] =
      `${styles[lastStyleIndex] ?? ""}\n${reducedMotionStepStyle}`;
  }
  const guardedRanges = findDocumentGuards(original, sourceTsx);
  let safeSource = replaceRangesWithSpaces(sourceTsx, guardedRanges);
  const ast = parseModule(safeSource);
  validateReactModule(ast);
  validateLiveExecution(ast);
  safeSource = instrumentSourceFunctions(safeSource, ast);
  safeSource = addSourceLocations(safeSource, parseModule(safeSource));
  const locatedAst = parseModule(safeSource);
  safeSource = instrumentBoundedCollectionCalls(safeSource, locatedAst);
  safeSource = `import { __slideRuntimeEnter, __slideRuntimeGet, __slideRuntimeJoin, __slideRuntimeLeave, __slideRuntimeMap, __slideRuntimePadStart, __slideRuntimePush, __slideRuntimeReplace, window } from "@agent-native/slides-core";\n${safeSource}`;
  return {
    source: safeSource,
    ...exportValues,
    styles,
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
  let liveSource: string | undefined;
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
              {
                filter:
                  /^(?:@agent-native\/slides-core|@open-slide\/core|@Slides 2\/core|virtual:slide-page-shim)$/,
              },
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
    const liveResult = await build({
      stdin: {
        contents: LIVE_ENTRY,
        resolveDir: templateRoot,
        sourcefile: "slide-live-entry.tsx",
        loader: "tsx",
      },
      absWorkingDir: templateRoot,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      jsxImportSource: "virtual:slides2-live",
      legalComments: "none",
      minify: true,
      sourcemap: false,
      write: false,
      treeShaking: true,
      plugins: [
        {
          name: "slides-2-live-source",
          setup(builder) {
            builder.onResolve({ filter: /^virtual:slide-page$/ }, () => ({
              path: "slide-page",
              namespace: "slides-2-live",
            }));
            builder.onLoad(
              { filter: /^slide-page$/, namespace: "slides-2-live" },
              () => ({
                contents: prepared.source,
                loader: "tsx",
                resolveDir: templateRoot,
              }),
            );
            builder.onResolve(
              {
                filter:
                  /^(?:@agent-native\/slides-core|@open-slide\/core|@Slides 2\/core|virtual:slide-page-shim)$/,
              },
              () => ({ path: "slide-page-shim", namespace: "slides-2-live" }),
            );
            builder.onLoad(
              { filter: /^slide-page-shim$/, namespace: "slides-2-live" },
              () => ({
                contents: slidePageShim,
                loader: "tsx",
                resolveDir: templateRoot,
              }),
            );
            builder.onResolve(
              { filter: /^virtual:slides2-live\/jsx-runtime$/ },
              () => ({
                path: "slide-live-react-shim",
                namespace: "slides-2-live",
              }),
            );
            builder.onResolve(
              { filter: /^react(?:\/jsx-runtime)?$/ },
              (args) => {
                if (
                  args.importer === "slide-live-react-shim" ||
                  args.importer === "slide-page-shim" ||
                  args.importer.includes("node_modules/")
                )
                  return undefined;
                return {
                  path: "slide-live-react-shim",
                  namespace: "slides-2-live",
                };
              },
            );
            builder.onLoad(
              { filter: /^slide-live-react-shim$/, namespace: "slides-2-live" },
              () => ({
                contents: LIVE_REACT_SHIM,
                loader: "tsx",
                resolveDir: templateRoot,
              }),
            );
          },
        },
      ],
    });
    liveSource = liveResult.outputFiles[0]?.text;
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
  if (!liveSource || liveSource.length > MAX_REACT_SLIDE_LIVE_SOURCE_LENGTH) {
    throw new SlideSourceError("Live slide bundle is empty or exceeds 4 MiB.");
  }
  return {
    kind: "agent-native-slides-react-worker-v1",
    workerSource,
    liveSource,
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
  const exportedTransitionValue = exports.has("transition")
    ? validateTransition(evaluateStatic(exports.get("transition")!, bindings))
    : undefined;
  const pageTransitionValue = readDefaultPageTransition(ast, bindings);
  const transitionValue = pageTransitionValue ?? exportedTransitionValue;
  return {
    ...(designValue === undefined
      ? {}
      : { design: validateDesign(designValue) }),
    ...(metaValue === undefined ? {} : { meta: validateMeta(metaValue) }),
    ...(transitionValue === undefined ? {} : { transition: transitionValue }),
  };
}

function readDefaultPageTransition(
  ast: t.File,
  bindings: Map<string, t.Node>,
): SlideTransition | undefined {
  const componentName = defaultComponentName(ast);
  if (!componentName) return undefined;

  const assignments = ast.program.body.flatMap((statement) => {
    const assignment = defaultPageTransitionAssignment(
      statement,
      componentName,
    );
    return assignment ? [assignment] : [];
  });
  if (assignments.length > 1) {
    throw new SlideSourceError(
      "A page may only declare one transition override.",
    );
  }
  const assignment = assignments[0];
  if (!assignment) return undefined;
  return validateTransition(evaluateStatic(assignment.right, bindings));
}

function defaultComponentName(ast: t.File): string | null {
  const declaration = ast.program.body.find(
    t.isExportDefaultDeclaration,
  )?.declaration;
  if (t.isIdentifier(declaration)) return declaration.name;
  if (
    (t.isFunctionDeclaration(declaration) ||
      t.isFunctionExpression(declaration)) &&
    declaration.id
  ) {
    return declaration.id.name;
  }
  return null;
}

function defaultPageTransitionAssignment(
  statement: t.Statement,
  componentName: string,
): t.AssignmentExpression | null {
  if (
    !t.isExpressionStatement(statement) ||
    !t.isAssignmentExpression(statement.expression)
  ) {
    return null;
  }
  const assignment = statement.expression;
  const left = assignment.left;
  if (
    assignment.operator !== "=" ||
    !t.isMemberExpression(left) ||
    left.computed ||
    !t.isIdentifier(left.object, { name: componentName }) ||
    !t.isIdentifier(left.property, { name: "transition" })
  ) {
    return null;
  }
  return assignment;
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

function validateDesign(value: unknown): Slides2Design {
  if (!isRecord(value))
    throw new SlideSourceError("The design export must be a static object.");
  const palette = value.palette;
  const fonts = value.fonts;
  const typeScale = value.typeScale;
  if (!isRecord(palette) || !isRecord(fonts) || !isRecord(typeScale))
    throw new SlideSourceError(
      "Design must include palette, fonts, and typeScale objects.",
    );
  const design: Slides2Design = {
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

function validateMeta(value: unknown): Slides2Meta {
  if (!isRecord(value))
    throw new SlideSourceError("The meta export must be a static object.");
  const meta: Slides2Meta = {};
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
  if (findStaticLocalPageArray(ast, declaration)) {
    throw new SlideSourceError(
      "The default export must be a React page component.",
    );
  }
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
  const pageComponentName = defaultComponentName(ast);
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
    if (
      pageComponentName &&
      defaultPageTransitionAssignment(statement, pageComponentName)
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
  const allowedWindowIdentifiers = new WeakSet<t.Identifier>();
  const allowedWindowPropertyIdentifiers = new WeakSet<t.Identifier>();
  const boundedCallMembers = new WeakSet<t.MemberExpression>();
  const reactBindings = new Set(["React"]);
  for (const statement of ast.program.body) {
    if (!t.isImportDeclaration(statement) || statement.source.value !== "react")
      continue;
    for (const specifier of statement.specifiers) {
      if (t.isImportDefaultSpecifier(specifier))
        reactBindings.add(specifier.local.name);
      else if (t.isImportSpecifier(specifier)) {
        const imported = t.isIdentifier(specifier.imported)
          ? specifier.imported.name
          : specifier.imported.value;
        if (SAFE_REACT_MEMBERS.has(imported))
          reactBindings.add(specifier.local.name);
      }
    }
  }
  walkAll(ast, (node) => {
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
      } else if (
        root?.name === "window" &&
        SAFE_WINDOW_MEMBER_PATHS.has(staticMemberPath(callee) ?? "")
      ) {
        if (staticMemberPath(callee) === "window.matchMedia") {
          const query = node.arguments[0];
          if (
            !t.isStringLiteral(query) ||
            ![
              "(prefers-reduced-motion: reduce)",
              "(prefers-reduced-motion: no-preference)",
            ].includes(query.value)
          ) {
            throw new SlideSourceError(
              "Only explicit reduced-motion media queries are supported.",
            );
          }
        }
        allowedWindowIdentifiers.add(root);
      } else if (SAFE_MEDIA_QUERY_PROPERTIES.has(method)) {
        // The live runtime returns a plain, filtered media-query view here.
      } else if (root?.name === "Object" && SAFE_OBJECT_METHODS.has(method)) {
        // Object collection calls below are restricted to this small static allowlist.
      } else if (root?.name === "Array" && SAFE_ARRAY_METHODS.has(method)) {
        // Array.isArray is the only permitted Array constructor access.
      } else if (
        root &&
        reactBindings.has(root.name) &&
        SAFE_REACT_MEMBERS.has(method)
      ) {
        // React calls are limited to the imported component/hook surface.
      } else if (SAFE_EVENT_METHODS.has(method)) {
        // Event handlers receive a filtered facade that exposes only these methods.
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
    if (root?.name === "window") {
      const path = staticMemberPath(node);
      if (!path || !SAFE_WINDOW_MEMBER_PATHS.has(path)) {
        throw new SlideSourceError(
          "Slide source can only use reduced-motion matching, bounded timers, animation frames, and performance.now().",
        );
      }
      allowedWindowIdentifiers.add(root);
      if (t.isIdentifier(node.property)) {
        allowedWindowPropertyIdentifiers.add(node.property);
      }
    }
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
    if (root && reactBindings.has(root.name)) {
      if (!property || !SAFE_REACT_MEMBERS.has(property)) {
        throw new SlideSourceError(
          "React access must use an approved static member.",
        );
      }
    }
  });
  const staticObjectPropertyKeys = new WeakSet<t.Identifier>();
  walkAll(ast, (node) => {
    if (
      t.isObjectProperty(node) &&
      !node.computed &&
      !node.shorthand &&
      t.isIdentifier(node.key)
    ) {
      staticObjectPropertyKeys.add(node.key);
    }
  });
  walkAll(ast, (node) => {
    if (
      t.isIdentifier(node) &&
      BLOCKED_GLOBALS.has(node.name) &&
      !staticObjectPropertyKeys.has(node) &&
      !allowedWindowPropertyIdentifiers.has(node) &&
      !(node.name === "window" && allowedWindowIdentifiers.has(node))
    ) {
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
        /^(?:script|style|iframe|frame|object|embed|link|meta|base|form|input|audio|portal|canvas|foreignObject|filter|feTurbulence|feColorMatrix)$/i.test(
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
        if (
          /^on/i.test(attributeName) &&
          !SAFE_EVENT_PROPS.has(attributeName)
        ) {
          throw new SlideSourceError(
            `Event handlers are not allowed unless ${attributeName} is supported by the slide runtime.`,
          );
        }
        if (
          attributeName === "ref" ||
          attributeName === "dangerouslySetInnerHTML"
        ) {
          throw new SlideSourceError(
            `JSX attribute ${attributeName} is not allowed in slide source.`,
          );
        }
        if (attributeName.toLowerCase().startsWith("data-slides2-")) {
          throw new SlideSourceError(
            "data-slides2 attributes are reserved for the slide runtime.",
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

function staticMemberPath(
  node: t.MemberExpression | t.OptionalMemberExpression,
): string | null {
  const properties: string[] = [];
  let current: t.Expression | t.Super = node;
  while (
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current)
  ) {
    const property = staticMemberProperty(current);
    if (!property) return null;
    properties.unshift(property);
    current = current.object;
  }
  return t.isIdentifier(current)
    ? [current.name, ...properties].join(".")
    : null;
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
  if (
    moduleName !== "react" &&
    moduleName !== "@agent-native/slides-core" &&
    moduleName !== "@open-slide/core"
  ) {
    throw new SlideSourceError(
      `Import from ${moduleName} is not supported; use React and the supported @agent-native/slides-core or @open-slide/core exports.`,
    );
  }
  if (declaration.importKind === "type") return;
  const reactImports = new Set([
    "useId",
    "useEffect",
    "useLayoutEffect",
    "useReducer",
    "useRef",
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
    "NoiseBackground",
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
      const allowed = moduleName === "react" ? reactImports : coreImports;
      if (!allowed.has(imported))
        throw new SlideSourceError(
          `Import ${imported} from ${moduleName} is not supported.`,
        );
    }
  }
}

type SourceFunction = {
  node:
    | t.FunctionDeclaration
    | t.FunctionExpression
    | t.ArrowFunctionExpression;
  name: string | null;
  start: number;
  end: number;
};

function collectSourceFunctions(ast: t.File): SourceFunction[] {
  const functions: SourceFunction[] = [];
  const assignedNames = new Map<t.Node, string>();
  walkAll(ast, (node) => {
    if (
      t.isVariableDeclarator(node) &&
      t.isIdentifier(node.id) &&
      node.init &&
      (t.isFunctionExpression(node.init) ||
        t.isArrowFunctionExpression(node.init))
    ) {
      assignedNames.set(node.init, node.id.name);
    }
    if (
      t.isObjectProperty(node) &&
      t.isIdentifier(node.key) &&
      (t.isFunctionExpression(node.value) ||
        t.isArrowFunctionExpression(node.value))
    ) {
      assignedNames.set(node.value, node.key.name);
    }
    if (
      !t.isFunctionDeclaration(node) &&
      !t.isFunctionExpression(node) &&
      !t.isArrowFunctionExpression(node)
    )
      return;
    if (node.start == null || node.end == null) return;
    const name =
      (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)
        ? node.id?.name
        : null) ??
      assignedNames.get(node) ??
      null;
    functions.push({ node, name, start: node.start, end: node.end });
  });
  return functions;
}

function validateLiveExecution(ast: t.File): void {
  const functions = collectSourceFunctions(ast);
  const namedFunctions = new Map<string, SourceFunction>();
  for (const fn of functions) {
    if (fn.name) namedFunctions.set(fn.name, fn);
    if (fn.node.async || ("generator" in fn.node && fn.node.generator)) {
      throw new SlideSourceError(
        "Async and generator functions are not supported in slide source.",
      );
    }
  }
  walkAll(ast, (node) => {
    if (
      t.isForStatement(node) ||
      t.isForInStatement(node) ||
      t.isForOfStatement(node) ||
      t.isWhileStatement(node) ||
      t.isDoWhileStatement(node)
    ) {
      throw new SlideSourceError(
        "Loops are not supported in live slide source.",
      );
    }
    if (t.isAwaitExpression(node) || t.isYieldExpression(node)) {
      throw new SlideSourceError(
        "Async and generator execution is not supported in slide source.",
      );
    }
  });
  const edges = new Map<string, Set<string>>();
  const calls: t.CallExpression[] = [];
  walkAll(ast, (node) => {
    if (t.isCallExpression(node)) calls.push(node);
  });
  const events = [
    ...functions.map((fn) => ({ start: fn.start, end: fn.end, fn })),
    ...calls
      .filter((call) => call.start != null && call.end != null)
      .map((call) => ({ start: call.start!, end: call.end!, call })),
  ].sort((left, right) => left.start - right.start || right.end - left.end);
  const active: SourceFunction[] = [];
  for (const event of events) {
    while (active.length && active[active.length - 1]!.end <= event.start)
      active.pop();
    if ("fn" in event) {
      active.push(event.fn);
      continue;
    }
    if (!t.isIdentifier(event.call.callee)) continue;
    const target = namedFunctions.get(event.call.callee.name);
    const caller = active[active.length - 1];
    if (!target || !caller?.name) continue;
    let targets = edges.get(caller.name);
    if (!targets) edges.set(caller.name, (targets = new Set()));
    targets.add(target.name!);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): boolean => {
    if (visiting.has(name)) return true;
    if (visited.has(name)) return false;
    visiting.add(name);
    for (const child of edges.get(name) ?? []) if (visit(child)) return true;
    visiting.delete(name);
    visited.add(name);
    return false;
  };
  for (const name of edges.keys()) {
    if (visit(name))
      throw new SlideSourceError(
        "Recursive slide source functions are not supported.",
      );
  }
}

function instrumentSourceFunctions(source: string, ast: t.File): string {
  const functions = collectSourceFunctions(ast);
  const parentByChild = new Map<SourceFunction, SourceFunction>();
  const orderedFunctions = [...functions].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const activeFunctions: SourceFunction[] = [];
  for (const child of orderedFunctions) {
    while (
      activeFunctions.length &&
      activeFunctions[activeFunctions.length - 1]!.end <= child.start
    )
      activeFunctions.pop();
    const parent = activeFunctions[activeFunctions.length - 1];
    if (parent) parentByChild.set(child, parent);
    activeFunctions.push(child);
  }
  const childrenByParent = new Map<SourceFunction, SourceFunction[]>();
  for (const [child, parent] of parentByChild) {
    let children = childrenByParent.get(parent);
    if (!children) childrenByParent.set(parent, (children = []));
    children.push(child);
  }
  const renderNested = (
    start: number,
    end: number,
    children: SourceFunction[],
  ): string => {
    const replacements = children
      .map((child) => ({
        start: child.start,
        end: child.end,
        text: renderFunction(child),
      }))
      .sort((left, right) => right.start - left.start);
    let result = source.slice(start, end);
    for (const replacement of replacements) {
      result =
        result.slice(0, replacement.start - start) +
        replacement.text +
        result.slice(replacement.end - start);
    }
    return result;
  };
  const renderFunction = (fn: SourceFunction): string => {
    const body = fn.node.body;
    const nested = childrenByParent.get(fn) ?? [];
    if (t.isBlockStatement(body)) {
      const contents = renderNested(body.start! + 1, body.end! - 1, nested);
      return (
        source.slice(fn.start, body.start! + 1) +
        "__slideRuntimeEnter();try{" +
        contents +
        "}finally{__slideRuntimeLeave();}" +
        source.slice(body.end! - 1, fn.end)
      );
    }
    const parenthesizedStart =
      body.extra?.parenthesized === true &&
      typeof body.extra.parenStart === "number"
        ? body.extra.parenStart
        : null;
    const expressionStart = parenthesizedStart ?? body.start!;
    const expressionEnd = parenthesizedStart == null ? body.end! : fn.end;
    const expression = renderNested(expressionStart, expressionEnd, nested);
    return (
      source.slice(fn.start, expressionStart) +
      "{__slideRuntimeEnter();try{return (" +
      expression +
      ");}finally{__slideRuntimeLeave();}}" +
      source.slice(expressionEnd, fn.end)
    );
  };
  const roots = functions.filter((fn) => !parentByChild.has(fn));
  return renderNested(0, source.length, roots);
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
const Budget = { values: 0, bytes: 0, stepCount: 0, remainingSteps: Infinity, svgNoiseBackgrounds: 0, countBuiltinNoiseBackgrounds: true };
const MAX_VALUES = 50_000;
const MAX_BYTES = 16 * 1024 * 1024;
let executionDepth = 0;
let liveEnvironment = null;
function fail(message) { throw new Error(message); }
${SAFE_SVG_NOISE_PROPS_NORMALIZER}
const SVG_NOISE_COLOR_MATRIX_VALUES = ${SVG_NOISE_MATRIX_JSON};
export function __slideRuntimeEnter() { if (executionDepth >= 128) fail("Slide source exceeded its call-depth budget."); executionDepth++; }
export function __slideRuntimeLeave() { if (executionDepth <= 0) fail("Slide runtime call accounting is invalid."); executionDepth--; }
function inertMatchMedia(query) { if (query !== "(prefers-reduced-motion: reduce)" && query !== "(prefers-reduced-motion: no-preference)") fail("Only reduced-motion media queries are available to slide source."); return Object.freeze({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); }
const inertWindow = Object.freeze({ matchMedia: inertMatchMedia, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {}, requestAnimationFrame() { return 0; }, cancelAnimationFrame() {}, performance: Object.freeze({ now: () => 0 }) });
export const window = Object.freeze({
  matchMedia(query) { return (liveEnvironment?.window ?? inertWindow).matchMedia(query); },
  setTimeout(callback, delay) { return (liveEnvironment?.window ?? inertWindow).setTimeout(callback, delay); },
  clearTimeout(id) { return (liveEnvironment?.window ?? inertWindow).clearTimeout(id); },
  setInterval(callback, delay) { return (liveEnvironment?.window ?? inertWindow).setInterval(callback, delay); },
  clearInterval(id) { return (liveEnvironment?.window ?? inertWindow).clearInterval(id); },
  requestAnimationFrame(callback) { return (liveEnvironment?.window ?? inertWindow).requestAnimationFrame(callback); },
  cancelAnimationFrame(id) { return (liveEnvironment?.window ?? inertWindow).cancelAnimationFrame(id); },
  performance: Object.freeze({ now() { return (liveEnvironment?.window ?? inertWindow).performance.now(); } }),
});
export function __slideRuntimeConfigureLive(environment) { liveEnvironment = environment; }
export function __slideRuntimeResolveAssetUrl(value) { if (!liveEnvironment || typeof liveEnvironment.resolveAssetUrl !== "function") fail("Slide asset resolution is unavailable."); return liveEnvironment.resolveAssetUrl(value); }
function reserve(values, bytes = 0) { if (!Number.isSafeInteger(values) || values < 0 || Budget.values + values > MAX_VALUES) fail("Slide render exceeded its value budget."); if (!Number.isSafeInteger(bytes) || bytes < 0 || Budget.bytes + bytes > MAX_BYTES) fail("Slide render exceeded its memory estimate."); Budget.values += values; Budget.bytes += bytes; }
function estimate(value, depth = 0, seen = new Set()) { if (depth > 16) fail("Slide data is nested too deeply."); if (typeof value === "string") { reserve(1, value.length * 2); return; } if (value == null || typeof value === "boolean" || typeof value === "number") { reserve(1, 16); return; } if (typeof value === "function") { reserve(1, 64); return; } if (typeof value !== "object" || seen.has(value)) { reserve(1, 32); return; } seen.add(value); reserve(1, 64); if (Array.isArray(value)) { if (value.length > MAX_VALUES) fail("Slide data array is too large."); for (const child of value) estimate(child, depth + 1, seen); return; } const keys = Object.keys(value); if (keys.length > 256) fail("Slide data object is too large."); for (const key of keys) estimate(value[key], depth + 1, seen); }
export function __slideRuntimeReset(revealedSteps, countBuiltinNoiseBackgrounds = true) { Budget.values = 0; Budget.bytes = 0; Budget.stepCount = 0; Budget.remainingSteps = revealedSteps == null ? Infinity : revealedSteps; Budget.svgNoiseBackgrounds = 0; Budget.countBuiltinNoiseBackgrounds = countBuiltinNoiseBackgrounds; }
export function __slideRuntimeCountSvgNoiseBackground() { Budget.svgNoiseBackgrounds++; if (Budget.svgNoiseBackgrounds > ${MAX_SAFE_SVG_NOISE_BACKGROUNDS_PER_RENDER}) fail("Slide uses too many filtered backgrounds."); return Budget.svgNoiseBackgrounds; }
export function __slideRuntimeStepCount() { return Budget.stepCount; }
export function __slideRuntimeGet(target, key) { if (typeof key === "string" && /^(?:0|[1-9][0-9]{0,5})$/.test(key)) key = Number(key); if (!Number.isSafeInteger(key) || key < 0 || key > MAX_VALUES) fail("Computed slide access must use a bounded array index."); if (Array.isArray(target) && key < target.length) return target[key]; if (typeof target === "string" && key < target.length) return target[key]; return undefined; }
export function __slideRuntimeMap(array, callback, thisArg) { if (!Array.isArray(array) || typeof callback !== "function") fail("Only static arrays can be mapped in slide source."); if (array.length > MAX_VALUES) fail("Slide render exceeded its map budget."); reserve(array.length, array.length * 8); const result = new Array(array.length); for (let index = 0; index < array.length; index++) { if (!(index in array)) continue; const value = callback.call(thisArg, array[index], index, array); estimate(value); result[index] = value; } return result; }
export function __slideRuntimePush(array, ...values) { if (!Array.isArray(array) || values.some((value) => value === undefined)) fail("Only explicit values can be appended in slide source."); if (array.length + values.length > MAX_VALUES) fail("Slide render exceeded its array budget."); for (const value of values) estimate(value); for (const value of values) array[array.length] = value; return array.length; }
export function __slideRuntimeJoin(array, separator = ",") { if (!Array.isArray(array) || array.length > MAX_VALUES || !isPrimitive(separator)) fail("Only bounded primitive arrays can be joined in slide source."); reserve(array.length, 0); if (!array.every(isPrimitive)) fail("Only bounded primitive arrays can be joined in slide source."); const joiner = String(separator); let length = Math.max(0, array.length - 1) * joiner.length; for (const value of array) length += value == null ? 0 : String(value).length; if (length > 1024 * 1024) fail("Slide render string is too large."); reserve(1, length * 2); return array.join(joiner); }
export function __slideRuntimePadStart(value, length, padding) { if (!isPrimitive(value) || (padding !== undefined && !isPrimitive(padding))) fail("Slide padding accepts primitive text only."); const text = String(value); const requested = Number(length); if (!Number.isFinite(requested) || requested > 1024 * 1024 || requested < 0) fail("Slide padding is out of bounds."); const outputLength = Math.max(text.length, Math.trunc(requested)); if (outputLength > 1024 * 1024) fail("Slide padding is out of bounds."); reserve(1, outputLength * 2); return text.padStart(requested, padding === undefined ? " " : String(padding)); }
export function __slideRuntimeReplace(value, pattern, replacement) { if (!isPrimitive(value) || typeof replacement !== "string" || replacement.includes("$") || (typeof pattern !== "string" && !(pattern instanceof RegExp))) fail("Slide replacement must use primitive text and a literal replacement string."); const text = String(value); const matches = []; if (pattern instanceof RegExp) { const regex = new RegExp(pattern.source, pattern.flags); let match; while ((match = regex.exec(text))) { reserve(1, 24); matches.push({ index: match.index, length: match[0].length }); if (!regex.global) break; if (match[0].length === 0) regex.lastIndex++; if (matches.length > MAX_VALUES) fail("Slide replacement has too many matches."); } } else { const search = String(pattern); let cursor = 0; if (!search) { reserve(1, 24); matches.push({ index: 0, length: 0 }); } else while ((cursor = text.indexOf(search, cursor)) !== -1) { reserve(1, 24); matches.push({ index: cursor, length: search.length }); cursor += search.length; if (matches.length > MAX_VALUES) fail("Slide replacement has too many matches."); } } const outputLength = text.length + matches.length * replacement.length - matches.reduce((size, match) => size + match.length, 0); if (outputLength > 1024 * 1024) fail("Slide render string is too large."); reserve(matches.length * 2 + 1, outputLength * 2); const parts = new Array(matches.length * 2 + 1); let cursor = 0; let part = 0; for (const match of matches) { parts[part++] = text.slice(cursor, match.index); parts[part++] = replacement; cursor = match.index + match.length; } parts[part] = text.slice(cursor); return parts.join(""); }
function isPrimitive(value) { return value == null || ["string", "number", "boolean"].includes(typeof value); }
const builtinSafeTags = new Set(${JSON.stringify([...SAFE_HTML_TAGS])});
const builtinSafeAttributes = new Set(${JSON.stringify([...SAFE_HTML_ATTRIBUTES])});
const builtinSafeEvents = new Set(${JSON.stringify([...SAFE_EVENT_PROPS])});
const builtinSafeCssFunctions = new Set(${JSON.stringify([...SAFE_CSS_FUNCTIONS])});
const builtinBlockedCssProperties = new Set(${JSON.stringify([...BLOCKED_CSS_PROPERTIES])});
const builtinAliases = Object.freeze({ className: "class", tabIndex: "tabindex", viewBox: "viewbox", preserveAspectRatio: "preserveaspectratio", patternTransform: "patterntransform", patternUnits: "patternunits", pathLength: "pathlength", strokeWidth: "stroke-width", strokeLinecap: "stroke-linecap", strokeLinejoin: "stroke-linejoin", strokeDasharray: "stroke-dasharray", strokeDashoffset: "stroke-dashoffset", strokeOpacity: "stroke-opacity", fillOpacity: "fill-opacity", fillRule: "fill-rule", stopColor: "stop-color", stopOpacity: "stop-opacity", markerEnd: "marker-end", markerMid: "marker-mid", markerStart: "marker-start", shapeRendering: "shape-rendering", vectorEffect: "vector-effect", colSpan: "colspan", rowSpan: "rowspan", autoPlay: "autoplay", playsInline: "playsinline" });
${SAFE_STATIC_SVG_NOISE_VALIDATOR}
function builtinCssName(name) { return name.startsWith("--") ? name : name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()).toLowerCase(); }
function sanitizeBuiltinStyle(style, countNoiseBackgrounds = Budget.countBuiltinNoiseBackgrounds) {
  if (style == null) return style;
  if (typeof style !== "object" || Array.isArray(style)) fail("Slide styles must be a static property map.");
  const keys = Object.keys(style);
  if (keys.length > 100) fail("Slide style map is too large.");
  const clean = {};
  for (const key of keys) {
    const name = builtinCssName(key);
    if (!/^(?:--[A-Za-z_][A-Za-z0-9_-]{0,125}|[a-z][a-z0-9-]{0,80})$/.test(name) || builtinBlockedCssProperties.has(name)) fail("Slide style property is not allowed.");
    const value = style[key];
    if (value == null || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > 1000000) fail("Slide style number is out of bounds.");
      clean[key] = value;
      continue;
    }
    const safeNoiseBackground = (name === "background" || name === "background-image") && isSafeStaticSvgNoiseBackgroundCssValue(value);
    if (safeNoiseBackground && countNoiseBackgrounds) __slideRuntimeCountSvgNoiseBackground();
    if (typeof value !== "string" || value.length > 4096 || /[\\\u0000-\u001f\u007f{}<>@]|\/\*|\*\/|javascript:/i.test(value) || (/url\s*\(/i.test(value) && !safeNoiseBackground)) fail("Slide style value is not allowed.");
    for (const match of value.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) if (!builtinSafeCssFunctions.has(match[1].toLowerCase()) && !(safeNoiseBackground && match[1].toLowerCase() === "url")) fail("Slide style function " + match[1].toLowerCase() + " is not allowed.");
    clean[key] = value;
  }
  return clean;
}
function builtinTargetSummary(target) {
  if (!target || typeof target !== "object" || typeof target.tagName !== "string") return null;
  const className = target.className;
  const summary = { tagName: target.tagName.toLowerCase().slice(0, 40), id: typeof target.id === "string" ? target.id.slice(0, 200) : "", className: String(className && typeof className === "object" ? className.baseVal ?? "" : className ?? "").slice(0, 500) };
  if (summary.tagName === "input" || summary.tagName === "textarea") {
    if (typeof target.value === "string") summary.value = target.value.slice(0, 1000);
    summary.checked = Boolean(target.checked);
  }
  return Object.freeze(summary);
}
function builtinEventFacade(event) {
  const value = { type: String(event.type ?? "").slice(0, 40), target: builtinTargetSummary(event.target), currentTarget: builtinTargetSummary(event.currentTarget), defaultPrevented: Boolean(event.defaultPrevented), timeStamp: Number(event.timeStamp) || 0 };
  for (const key of ["button", "buttons", "clientX", "clientY", "pointerId", "pointerType", "key", "code", "keyCode", "which", "detail", "deltaX", "deltaY", "deltaMode", "ctrlKey", "shiftKey", "altKey", "metaKey", "repeat", "charCode"]) {
    const field = event[key];
    if (["string", "number", "boolean"].includes(typeof field)) value[key] = typeof field === "string" ? field.slice(0, 100) : field;
  }
  value.preventDefault = () => event.preventDefault();
  value.stopPropagation = () => event.stopPropagation();
  return Object.freeze(value);
}
function sanitizeBuiltinProps(tag, props) {
  if (typeof tag !== "string" || !builtinSafeTags.has(tag.toLowerCase())) fail("Slide element is not allowed.");
  const source = props && typeof props === "object" && !Array.isArray(props) ? props : {};
  if (Object.keys(source).length > 100) fail("Slide element has too many attributes.");
  const clean = {};
  let hasInteraction = false;
  for (const key of Object.keys(source)) {
    if (key === "children" || key === "key") continue;
    if (key === "ref" || key === "dangerouslySetInnerHTML" || key === "innerHTML") fail("Slide DOM property is not allowed.");
    const value = source[key];
    if (/^on/i.test(key)) {
      if (!builtinSafeEvents.has(key) || (value != null && typeof value !== "function")) fail("Slide event handler is not allowed.");
      if (typeof value === "function") clean[key] = (event) => value(builtinEventFacade(event));
      hasInteraction = true;
      continue;
    }
    if (key === "style") { clean.style = sanitizeBuiltinStyle(value); continue; }
    const name = builtinAliases[key] ?? key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()).toLowerCase();
    if (name.startsWith("data-slides2-")) fail("Slide runtime attributes are reserved.");
    if (!(builtinSafeAttributes.has(name) || /^(?:aria|data)-[a-z0-9_.:-]{1,120}$/.test(name))) fail("Slide attribute is not allowed.");
    if (name === "src" || name === "poster") {
      if ((name === "poster" && tag !== "video") || (name === "src" && !["img", "video", "source"].includes(tag)) || typeof value !== "string" || !/^asset:\/\/[A-Za-z0-9_-]{1,200}$/.test(value)) fail("Media references must use uploaded asset handles.");
      clean[key] = liveEnvironment?.resolveAssetUrl ? liveEnvironment.resolveAssetUrl(value) : value;
      continue;
    }
    if (name === "href" && (typeof value !== "string" || !/^#[A-Za-z_][A-Za-z0-9_.:-]{0,200}$/.test(value))) fail("Links must use local slide anchors.");
    if (name === "id" && (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,200}$/.test(value))) fail("Slide ids are invalid.");
    if (name === "data-slide-loc" && (typeof value !== "string" || !/^\d{1,6}:\d{1,6}$/.test(value))) fail("Slide source locations are invalid.");
    if (typeof value === "string" && value.length > 4096 || typeof value === "number" && !Number.isFinite(value)) fail("Slide attribute value is out of bounds.");
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) clean[key] = value;
    else fail("Slide attribute values must be primitive.");
  }
  if (hasInteraction) clean["data-slides2-interactive"] = "";
  return clean;
}
function safeBuiltinClassName(value) {
  if (value == null) return value;
  if (typeof value !== "string" || value.length > 4096) fail("Slide class names must be short text.");
  return value;
}
function safeBuiltinDimension(value) {
  if (value == null) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 1000000) fail("Slide dimensions are out of bounds.");
    return value;
  }
  if (typeof value !== "string" || value.length > 4096 || /[\\\u0000-\u001f\u007f{}<>@]|\/\*|\*\/|url\s*\(|javascript:/i.test(value)) fail("Slide dimensions are invalid.");
  for (const match of value.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) if (!builtinSafeCssFunctions.has(match[1].toLowerCase())) fail("Slide dimension function " + match[1].toLowerCase() + " is not allowed.");
  return value;
}
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
    "--slides2-bg": design.palette.bg,
    "--slides2-text": design.palette.text,
    "--slides2-accent": design.palette.accent,
    "--slides2-font-display": design.fonts.display,
    "--slides2-font-body": design.fonts.body,
    "--slides2-size-hero": design.typeScale.hero + "px",
    "--slides2-size-body": design.typeScale.body + "px",
    "--slides2-radius": design.radius + "px",
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
export function SlideRuntimeProvider({ value, children }) { __slideRuntimeReset(value.revealedSteps, value.countBuiltinNoiseBackgrounds !== false); return React.createElement(Context.Provider, { value }, children); }
export function useSlidePageNumber() { const context = useContext(Context); if (!context) fail("useSlidePageNumber must be called from a rendered slide page."); return { current: context.page.current, total: context.page.total }; }
export function useIsActivePage() { return useContext(Context)?.isActivePage ?? false; }
export function Step({ children, duration = 180, _revealed }) { const safeDuration = Number.isFinite(duration) ? Math.max(0, Math.min(5000, duration)) : 180; const revealed = _revealed ?? true; return React.createElement("div", { "data-slides2-step": revealed ? "revealed" : "pending", "data-slides2-step-duration": String(safeDuration), style: { opacity: revealed ? 1 : 0, visibility: revealed ? "visible" : "hidden", transition: "opacity " + safeDuration + "ms cubic-bezier(0, 0, 0.2, 1)" } }, children); }
export function NoiseBackground(props) {
  const options = normalizeSvgNoiseBackgroundProps(props);
  if (!options) fail("NoiseBackground props must use bounded static values.");
  const id = "slides2-noise-" + __slideRuntimeCountSvgNoiseBackground();
  return React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    focusable: false,
    width: "100%",
    height: "100%",
    viewBox: "0 0 220 220",
    preserveAspectRatio: "none",
    "data-slide-loc": options.dataSlideLoc,
    "data-slides2-noise": "1",
    style: { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" },
  },
    React.createElement("defs", null,
      React.createElement("filter", { id, x: "0", y: "0", width: "100%", height: "100%" },
        React.createElement("feTurbulence", { type: "fractalNoise", baseFrequency: String(options.baseFrequency), numOctaves: String(options.numOctaves), seed: String(options.seed), stitchTiles: "stitch", result: "noise" }),
        React.createElement("feColorMatrix", { in: "noise", type: "matrix", values: SVG_NOISE_COLOR_MATRIX_VALUES }),
      ),
    ),
    React.createElement("rect", { width: "100%", height: "100%", filter: "url(#" + id + ")", opacity: String(options.opacity), fill: options.fill }),
  );
}
export function Steps({ children }) { const childrenArray = Children.toArray(children); let count = 0; for (const child of childrenArray) if (isValidElement(child) && child.type === Step) count++; Budget.stepCount += count; const revealed = Math.min(count, Budget.remainingSteps); Budget.remainingSteps = Math.max(0, Budget.remainingSteps - revealed); let index = 0; return React.createElement(React.Fragment, null, ...childrenArray.map((child, key) => { if (isValidElement(child) && child.type === Step) { const stepIndex = index++; return cloneElement(child, { key: child.key ?? key, _revealed: stepIndex < revealed }); } return child; })); }
export function ImagePlaceholder({ hint, label, width, height, style, className, ...props }) {
  const safeProps = sanitizeBuiltinProps("div", props);
  const safeStyle = sanitizeBuiltinStyle(style);
  const safeWidth = safeBuiltinDimension(width);
  const safeHeight = safeBuiltinDimension(height);
  const description =
    typeof hint === "string"
      ? hint
      : typeof label === "string"
        ? label
        : "Image placeholder";
  const dimensions = safeWidth && safeHeight ? safeWidth + " × " + safeHeight : null;
  const icon = React.createElement("svg", {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: { opacity: 0.55 },
    role: "img",
    "aria-label": "image placeholder",
  },
    React.createElement("rect", { x: 4, y: 6, width: 24, height: 20, rx: 2.5 }),
    React.createElement("circle", { cx: 11, cy: 13, r: 2 }),
    React.createElement("path", { d: "M4 22l7-7 6 6 4-4 7 7" }),
  );
  const detail = React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      maxWidth: "85%",
    },
  },
    React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        opacity: 0.55,
      },
    }, "Image"),
    React.createElement("span", {
      style: {
        fontSize: 16,
        fontWeight: 500,
        lineHeight: 1.4,
        color:
          "color-mix(in srgb, var(--slides2-text, currentColor) 85%, transparent)",
      },
    }, description),
    dimensions && React.createElement("span", {
      style: {
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        opacity: 0.5,
        marginTop: 2,
      },
    }, dimensions),
  );
  return React.createElement("div", {
    ...safeProps,
    "data-slide-loc": safeProps["data-slide-loc"],
    "data-slide-placeholder": description,
    "data-placeholder-w": safeWidth,
    "data-placeholder-h": safeHeight,
    role: "img",
    "aria-label": description,
    className: safeBuiltinClassName(className),
    style: {
      position: "relative",
      width: safeWidth ?? "100%",
      height: safeHeight ?? "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 14,
      border:
        "1px dashed color-mix(in srgb, var(--slides2-text, currentColor) 35%, transparent)",
      borderRadius: 12,
      background:
        "linear-gradient(135deg, color-mix(in srgb, var(--slides2-text, currentColor) 6%, transparent) 0%, color-mix(in srgb, var(--slides2-text, currentColor) 2%, transparent) 50%, color-mix(in srgb, var(--slides2-text, currentColor) 6%, transparent) 100%)",
      color:
        "color-mix(in srgb, var(--slides2-text, currentColor) 70%, transparent)",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif',
      textAlign: "center",
      padding: 24,
      boxSizing: "border-box",
      overflow: "hidden",
      ...(safeStyle && typeof safeStyle === "object" ? safeStyle : {}),
    },
  }, icon, detail);
}
export function MorphElement({ id, children, as = "div", className, style, ...props }) {
  if (typeof id !== "string" || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,200}$/.test(id)) fail("Slide morph ids are invalid.");
  if (typeof as !== "string" || !builtinSafeTags.has(as.toLowerCase())) fail("Slide element is not allowed.");
  const safeProps = sanitizeBuiltinProps(as, props);
  const safeClassName = safeBuiltinClassName(className);
  const safeStyle = sanitizeBuiltinStyle(style);
  const child = Children.toArray(children)[0] ?? null;
  if (Children.count(children) === 1 && isValidElement(child) && typeof child.type === "string") {
    if (!builtinSafeTags.has(child.type.toLowerCase())) fail("Slide element is not allowed.");
    const childClassName = safeBuiltinClassName(child.props.className);
    return cloneElement(child, {
      ...safeProps,
      "data-slides2-morph": id,
      className: [childClassName, safeClassName].filter(Boolean).join(" ") || undefined,
      style: sanitizeBuiltinStyle({ ...(child.props.style || {}), ...(safeStyle || {}) }, false),
    });
  }
  return React.createElement(as, { ...safeProps, className: safeClassName, style: safeStyle, "data-slides2-morph": id }, children);
}
`;
