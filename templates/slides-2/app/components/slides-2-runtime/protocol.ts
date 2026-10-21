import {
  isSafeSlideFontFamily,
  SLIDE_FONT_VARIANT_PATTERN,
  type SlideDesignTokens,
  type SlideFontAsset,
} from "@shared/slide-design-tokens";
import { isSlideTransition } from "@shared/slides-2-transition";

import type { SlideWorkerRuntime } from "../../../server/lib/slide-worker-runtime";
import {
  MAX_RENDERED_SLIDE_HTML_LENGTH,
  SLIDES_2_CANVAS_HEIGHT,
  SLIDES_2_CANVAS_WIDTH,
  SLIDE_FRAME_PROTOCOL_VERSION,
} from "./constants";

export type { SlideDesignTokens };

export type SlideRenderArtifact = {
  protocolVersion: number;
  deckId: string;
  slideId: string;
  revision: number;
  sourceHash: string;
  width: number;
  height: number;
  html: string;
  assetOrigins?: string[];
  fontOrigins?: string[];
  fontAssets?: SlideFontAsset[];
  designTokens?: SlideDesignTokens;
  runtime?: SlideWorkerRuntime;
};

const MAX_RUNTIME_STYLE_LENGTH = 65_536;
export const MAX_SLIDE_FRAME_ANCESTORS = 64;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_CSS_FUNCTIONS = new Set([
  "cross-fade",
  "element",
  "expression",
  "image",
  "image-set",
  "paint",
  "url",
]);

function hasForbiddenCssFunction(source: string): boolean {
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\" || (char === "/" && source[index + 1] === "*"))
      return true;
    if (!/[a-z-]/i.test(char)) {
      index++;
      continue;
    }
    const start = index++;
    while (/[a-z0-9-]/i.test(source[index] ?? "")) index++;
    const name = source.slice(start, index).toLowerCase();
    while (/\s/.test(source[index] ?? "")) index++;
    if (source[index] === "(" && FORBIDDEN_CSS_FUNCTIONS.has(name)) return true;
  }
  return false;
}

function hasUnsafeRuntimeStyle(source: string): boolean {
  if (
    source.length > MAX_RUNTIME_STYLE_LENGTH ||
    source.includes("\\") ||
    source.includes("/*") ||
    source.includes("*/")
  ) {
    return true;
  }
  const lower = source.toLowerCase();
  if (
    lower.includes("@import") ||
    lower.includes("@font-face") ||
    lower.includes("javascript:")
  ) {
    return true;
  }
  for (const char of source) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127 || char === "<" || char === ">") return true;
  }
  return hasForbiddenCssFunction(source);
}

function isAllowedSlideResourceOrigin(
  origin: string,
  appOrigin?: string,
): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:" || !appOrigin) return false;

    const appUrl = new URL(appOrigin);
    if (parsed.origin === appUrl.origin) return true;
    return (
      appUrl.protocol === "http:" &&
      LOOPBACK_HOSTS.has(appUrl.hostname) &&
      LOOPBACK_HOSTS.has(parsed.hostname)
    );
  } catch {
    // coercion-ok: malformed origins fail the runtime's URL safety validation.
    return false;
  }
}

export type SlideFrameContext = Pick<
  SlideRenderArtifact,
  "deckId" | "slideId" | "revision" | "sourceHash"
> & { nonce: string };

export type SlideFramePointerType = "mouse" | "pen" | "touch";

export function isSlideFramePointerType(
  value: unknown,
): value is SlideFramePointerType {
  return value === "mouse" || value === "pen" || value === "touch";
}

export type SlideFrameMessage = {
  protocolVersion: number;
  nonce: string;
  deckId: string;
  slideId: string;
  revision: number;
  sourceHash: string;
  type:
    | "bootstrapped"
    | "ready"
    | "rendered"
    | "snapshot"
    | "inspect"
    | "text-range-style"
    | "pointer"
    | "keyboard"
    | "navigation"
    | "error";
  html?: string;
  stepCount?: number;
  nodes?: unknown;
  pointer?: unknown;
  keyboard?: unknown;
  navigation?: unknown;
  rangeStyle?: SlideFrameTextRangeStyle;
  message?: string;
  stage?: "bridge" | "worker";
};

export type SlideFrameTextRangeStyle = {
  line: number;
  column: number;
  nodeId: string;
  start: number;
  end: number;
  expectedText: string;
  styles: Record<SlideInlineTextStyleKey, string>;
};

export type SlideInlineTextStyleKey =
  | "fontFamily"
  | "fontSize"
  | "fontStyle"
  | "fontWeight"
  | "color";

export type SlideFrameNavigationInput =
  | {
      type: "wheel";
      deltaX: number;
      deltaY: number;
      deltaMode: number;
      ctrlKey: boolean;
    }
  | {
      type: "click";
      x: number;
      y: number;
      button: number;
      defaultPrevented: boolean;
      interactive: boolean;
      hasSelection: boolean;
    };

export type SlidePreviewRangeStyle = {
  start: number;
  end: number;
  key: "fontFamily" | "fontSize" | "fontStyle" | "fontWeight" | "color";
  value: string | null;
  expectedText: string;
};

export type SlidePreviewPatch = {
  line: number;
  column: number;
  styles?: Record<string, string | null>;
  text?: string;
  rangeStyles?: SlidePreviewRangeStyle[];
};

export type SlideFrameCommand =
  | { type: "clear-preview" }
  | {
      type: "inspect";
      targets: Array<{ line: number; column: number; nodeId: string }>;
    }
  | {
      type: "inspect-text-range";
      target: { line: number; column: number; nodeId: string };
      start: number;
      end: number;
      expectedText: string;
    }
  | {
      type: "preview";
      patches: SlidePreviewPatch[];
    }
  | { type: "set-design-tokens"; tokens: SlideDesignTokens }
  | { type: "set-revealed-steps"; revealedSteps: number | null };

export function isSlideFrameAncestorData(
  ancestorLocators: unknown,
  complete: unknown,
): boolean {
  if (
    !Array.isArray(ancestorLocators) ||
    ancestorLocators.length > MAX_SLIDE_FRAME_ANCESTORS ||
    typeof complete !== "boolean"
  ) {
    return false;
  }
  return ancestorLocators.every((locator) => {
    if (typeof locator !== "string" || locator.length > 40) return false;
    const match = /^(\d+):(\d+)$/.exec(locator);
    if (!match) return false;
    const line = Number(match[1]);
    const column = Number(match[2]);
    return (
      Number.isSafeInteger(line) &&
      line > 0 &&
      Number.isSafeInteger(column) &&
      column >= 0
    );
  });
}

export function isSlideDesignTokens(
  value: unknown,
): value is SlideDesignTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tokens = value as Record<string, unknown>;
  const isHexColor = (color: unknown) =>
    typeof color === "string" && /^#[\da-f]{6}$/i.test(color);
  const isFontAssetId = (assetId: unknown) =>
    assetId === undefined ||
    (typeof assetId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(assetId));
  return (
    isHexColor(tokens.background) &&
    isHexColor(tokens.text) &&
    isHexColor(tokens.accent) &&
    isSafeSlideFontFamily(tokens.displayFont) &&
    isFontAssetId(tokens.displayFontAssetId) &&
    isSafeSlideFontFamily(tokens.bodyFont) &&
    isFontAssetId(tokens.bodyFontAssetId) &&
    typeof tokens.heroScale === "number" &&
    Number.isFinite(tokens.heroScale) &&
    tokens.heroScale >= 0.5 &&
    tokens.heroScale <= 2 &&
    typeof tokens.bodyScale === "number" &&
    Number.isFinite(tokens.bodyScale) &&
    tokens.bodyScale >= 0.5 &&
    tokens.bodyScale <= 2 &&
    typeof tokens.radius === "number" &&
    Number.isFinite(tokens.radius) &&
    tokens.radius >= 0 &&
    tokens.radius <= 48
  );
}

export function isSlideFrameNavigationInput(
  value: unknown,
): value is SlideFrameNavigationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.type === "wheel") {
    return (
      typeof input.deltaX === "number" &&
      Number.isFinite(input.deltaX) &&
      Math.abs(input.deltaX) <= 1_000_000 &&
      typeof input.deltaY === "number" &&
      Number.isFinite(input.deltaY) &&
      Math.abs(input.deltaY) <= 1_000_000 &&
      Number.isInteger(input.deltaMode) &&
      Number(input.deltaMode) >= 0 &&
      Number(input.deltaMode) <= 2 &&
      typeof input.ctrlKey === "boolean"
    );
  }
  return (
    input.type === "click" &&
    typeof input.x === "number" &&
    Number.isFinite(input.x) &&
    input.x >= 0 &&
    input.x <= 1 &&
    typeof input.y === "number" &&
    Number.isFinite(input.y) &&
    input.y >= 0 &&
    input.y <= 1 &&
    Number.isInteger(input.button) &&
    Number(input.button) >= 0 &&
    Number(input.button) <= 5 &&
    typeof input.defaultPrevented === "boolean" &&
    typeof input.interactive === "boolean" &&
    typeof input.hasSelection === "boolean"
  );
}

export function isSlideRenderArtifact(
  value: unknown,
  appOrigin?: string,
): value is SlideRenderArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const artifact = value as Record<string, unknown>;
  const assetOrigins = artifact.assetOrigins;
  const validAssetOrigins =
    assetOrigins === undefined ||
    (Array.isArray(assetOrigins) &&
      assetOrigins.length <= 20 &&
      assetOrigins.every((origin) => {
        return (
          typeof origin === "string" &&
          origin.length <= 2048 &&
          isAllowedSlideResourceOrigin(origin, appOrigin)
        );
      }));
  const fontOrigins = artifact.fontOrigins;
  const validFontOrigins =
    fontOrigins === undefined ||
    (Array.isArray(fontOrigins) &&
      fontOrigins.length <= 2 &&
      fontOrigins.every((origin) => {
        return (
          typeof origin === "string" &&
          origin.length <= 2048 &&
          isAllowedSlideResourceOrigin(origin, appOrigin)
        );
      }));
  const fontAssets = artifact.fontAssets;
  const validFontAssets =
    (fontAssets === undefined &&
      fontOrigins === undefined &&
      (artifact.designTokens === undefined ||
        (isSlideDesignTokens(artifact.designTokens) &&
          artifact.designTokens.displayFontAssetId === undefined &&
          artifact.designTokens.bodyFontAssetId === undefined))) ||
    (Array.isArray(fontAssets) &&
      Array.isArray(fontOrigins) &&
      isSlideFontAssetList(
        fontAssets,
        fontOrigins,
        artifact.designTokens,
        appOrigin,
      ));
  const runtime = artifact.runtime;
  const validRuntime =
    runtime === undefined ||
    isSlideWorkerRuntime(runtime, assetOrigins, appOrigin);
  return (
    artifact.protocolVersion === SLIDE_FRAME_PROTOCOL_VERSION &&
    typeof artifact.deckId === "string" &&
    artifact.deckId.length !== 0 &&
    artifact.deckId.length <= 200 &&
    typeof artifact.slideId === "string" &&
    artifact.slideId.length > 0 &&
    Number.isInteger(artifact.revision) &&
    typeof artifact.sourceHash === "string" &&
    /^[a-f0-9]{64}$/.test(artifact.sourceHash) &&
    artifact.width === SLIDES_2_CANVAS_WIDTH &&
    artifact.height === SLIDES_2_CANVAS_HEIGHT &&
    typeof artifact.html === "string" &&
    artifact.html.length <= MAX_RENDERED_SLIDE_HTML_LENGTH &&
    (artifact.designTokens === undefined ||
      isSlideDesignTokens(artifact.designTokens)) &&
    validAssetOrigins &&
    validFontOrigins &&
    validFontAssets &&
    validRuntime
  );
}

export function isSlideFontAssetList(
  assets: unknown[],
  origins: unknown[],
  tokens: unknown,
  appOrigin?: string,
): boolean {
  if (assets.length === 0 && origins.length === 0 && tokens === undefined) {
    return true;
  }
  if (!isSlideDesignTokens(tokens)) return false;
  if (assets.length > 2 || origins.length > 2) return false;
  if (appOrigin) {
    try {
      new URL(appOrigin);
    } catch {
      // coercion-ok: an invalid app origin makes this font asset list invalid.
      return false;
    }
  }
  const selected = new Map<string, string>();
  for (const [family, id] of [
    [tokens.displayFont, tokens.displayFontAssetId],
    [tokens.bodyFont, tokens.bodyFontAssetId],
  ] as const) {
    if (typeof id === "string") selected.set(id, family);
  }
  if (assets.length === 0) {
    return (
      origins.length === 0 &&
      tokens.displayFontAssetId === undefined &&
      tokens.bodyFontAssetId === undefined
    );
  }
  if (selected.size !== assets.length) return false;
  const allowedOrigins = new Set<string>();
  for (const origin of origins) {
    if (typeof origin !== "string" || origin.length > 2048) return false;
    try {
      const url = new URL(origin);
      if (
        url.origin !== origin ||
        !isAllowedSlideResourceOrigin(origin, appOrigin)
      ) {
        return false;
      }
    } catch {
      // coercion-ok: malformed asset origins fail the font asset list validation.
      return false;
    }
    allowedOrigins.add(origin);
  }
  if (allowedOrigins.size !== origins.length) return false;
  const seenIds = new Set<string>();
  const assetOrigins = new Set<string>();
  for (const value of assets) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const asset = value as Record<string, unknown>;
    const extension =
      asset.mimeType === "font/otf"
        ? "otf"
        : asset.mimeType === "font/ttf"
          ? "ttf"
          : asset.mimeType === "font/woff"
            ? "woff"
            : asset.mimeType === "font/woff2"
              ? "woff2"
              : null;
    if (
      typeof asset.assetId !== "string" ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(asset.assetId) ||
      seenIds.has(asset.assetId) ||
      selected.get(asset.assetId) !== asset.family ||
      !isSafeSlideFontFamily(asset.family) ||
      typeof asset.variant !== "string" ||
      !SLIDE_FONT_VARIANT_PATTERN.test(asset.variant) ||
      !extension ||
      typeof asset.url !== "string" ||
      asset.url.length > 4096
    ) {
      return false;
    }
    try {
      const url = new URL(asset.url);
      if (
        url.href !== asset.url ||
        url.username ||
        url.password ||
        !isAllowedSlideResourceOrigin(url.origin, appOrigin) ||
        !allowedOrigins.has(url.origin)
      ) {
        return false;
      }
      assetOrigins.add(url.origin);
    } catch {
      // coercion-ok: malformed font URLs fail the font asset list validation.
      return false;
    }
    seenIds.add(asset.assetId);
  }
  return (
    seenIds.size === selected.size &&
    assetOrigins.size === allowedOrigins.size &&
    [...assetOrigins].every((origin) => allowedOrigins.has(origin))
  );
}

function isSlideWorkerRuntime(
  value: unknown,
  assetOrigins: unknown,
  appOrigin?: string,
): value is SlideWorkerRuntime {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const runtime = value as Record<string, unknown>;
  if (
    runtime.kind !== "open-slide-react-worker-v1" ||
    typeof runtime.workerSource !== "string" ||
    runtime.workerSource.length === 0 ||
    runtime.workerSource.length > 4 * 1024 * 1024 ||
    runtime.timeoutMs !== 2500 ||
    !runtime.page ||
    typeof runtime.page !== "object" ||
    Array.isArray(runtime.page) ||
    !runtime.assetUrls ||
    typeof runtime.assetUrls !== "object" ||
    Array.isArray(runtime.assetUrls) ||
    !Array.isArray(runtime.styles) ||
    runtime.styles.length > 20
  ) {
    return false;
  }
  const page = runtime.page as Record<string, unknown>;
  if (
    !Number.isSafeInteger(page.current) ||
    Number(page.current) < 1 ||
    !Number.isSafeInteger(page.total) ||
    Number(page.total) < Number(page.current)
  ) {
    return false;
  }
  let totalStyleLength = 0;
  for (const style of runtime.styles) {
    if (typeof style !== "string" || hasUnsafeRuntimeStyle(style)) {
      return false;
    }
    totalStyleLength += style.length;
  }
  if (totalStyleLength > 128 * 1024) return false;

  const origins = new Set(
    Array.isArray(assetOrigins)
      ? assetOrigins.filter(
          (origin): origin is string => typeof origin === "string",
        )
      : [],
  );
  const assets = runtime.assetUrls as Record<string, unknown>;
  const entries = Object.entries(assets);
  if (entries.length > 100) return false;
  for (const [id, value] of entries) {
    if (
      !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
      typeof value !== "string" ||
      value.length > 4096
    ) {
      return false;
    }
    try {
      const url = new URL(value);
      const appUrl = appOrigin ? new URL(appOrigin) : null;
      if (
        url.href !== value ||
        url.username ||
        url.password ||
        (url.protocol !== "https:" &&
          (appUrl === null || url.origin !== appUrl.origin)) ||
        !origins.has(url.origin)
      ) {
        return false;
      }
    } catch {
      // coercion-ok: malformed runtime asset URLs fail runtime validation.
      return false;
    }
  }
  if (runtime.design !== undefined && !isSlides2Design(runtime.design))
    return false;
  if (runtime.meta !== undefined && !isSlides2Meta(runtime.meta)) return false;
  if (
    runtime.transition !== undefined &&
    (!isSlideTransition(runtime.transition) ||
      safeJson(runtime.transition).length > 16 * 1024)
  ) {
    return false;
  }
  return true;
}

function isSlides2Design(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const design = value as Record<string, unknown>;
  const palette = design.palette;
  const fonts = design.fonts;
  const typeScale = design.typeScale;
  const isCssScalar = (entry: unknown) => {
    if (typeof entry !== "string" || entry.length > 160) return false;
    if (
      entry.includes("\\") ||
      entry.includes(";") ||
      entry.includes("{") ||
      entry.includes("}") ||
      entry.includes("<") ||
      entry.includes(">") ||
      entry.includes("@") ||
      entry.includes("/*") ||
      entry.includes("*/") ||
      entry.toLowerCase().includes("url(")
    ) {
      return false;
    }
    for (const char of entry) {
      const code = char.charCodeAt(0);
      if (code < 32 || code === 127) return false;
    }
    return true;
  };
  const isFont = (entry: unknown) =>
    typeof entry === "string" &&
    isCssScalar(entry) &&
    /^[A-Za-z0-9\s"',._-]+$/.test(entry);
  const isSize = (entry: unknown) =>
    typeof entry === "number" &&
    Number.isFinite(entry) &&
    entry > 0 &&
    entry <= 320;
  return Boolean(
    palette &&
    typeof palette === "object" &&
    isCssScalar((palette as Record<string, unknown>).bg) &&
    isCssScalar((palette as Record<string, unknown>).text) &&
    isCssScalar((palette as Record<string, unknown>).accent) &&
    fonts &&
    typeof fonts === "object" &&
    isFont((fonts as Record<string, unknown>).display) &&
    isFont((fonts as Record<string, unknown>).body) &&
    typeScale &&
    typeof typeScale === "object" &&
    isSize((typeScale as Record<string, unknown>).hero) &&
    isSize((typeScale as Record<string, unknown>).body) &&
    typeof design.radius === "number" &&
    Number.isFinite(design.radius) &&
    design.radius >= 0 &&
    design.radius <= 128,
  );
}

function isSlides2Meta(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const meta = value as Record<string, unknown>;
  return Object.entries(meta).every(
    ([key, entry]) =>
      ["title", "theme", "createdAt"].includes(key) &&
      typeof entry === "string" &&
      entry.length <= 300 &&
      !/[\u0000-\u001f]/.test(entry),
  );
}

function isSlideFrameTextRangeStyle(
  value: unknown,
): value is SlideFrameTextRangeStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const range = value as Record<string, unknown>;
  if (
    !Number.isInteger(range.line) ||
    Number(range.line) < 1 ||
    !Number.isInteger(range.column) ||
    Number(range.column) < 0 ||
    typeof range.nodeId !== "string" ||
    range.nodeId.length > 100 ||
    !Number.isInteger(range.start) ||
    Number(range.start) < 0 ||
    !Number.isInteger(range.end) ||
    Number(range.end) <= Number(range.start) ||
    typeof range.expectedText !== "string" ||
    range.expectedText.length > 12000 ||
    Number(range.end) > range.expectedText.length ||
    !isSlideFrameNodeId(
      range.nodeId,
      Number(range.line),
      Number(range.column),
    ) ||
    !range.styles ||
    typeof range.styles !== "object" ||
    Array.isArray(range.styles)
  ) {
    return false;
  }
  const styles = range.styles as Record<string, unknown>;
  const keys: SlideInlineTextStyleKey[] = [
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "color",
  ];
  return (
    Object.keys(styles).length === keys.length &&
    keys.every(
      (key) => typeof styles[key] === "string" && styles[key].length <= 400,
    )
  );
}

function isSlideFrameNodeId(
  nodeId: string,
  line: number,
  column: number,
): boolean {
  const match = /^(\d+):(\d+):(\d+)$/.exec(nodeId);
  return Boolean(
    match && Number(match[1]) === line && Number(match[2]) === column,
  );
}

export function isSlideFrameMessage(
  value: unknown,
  context: SlideFrameContext,
): value is SlideFrameMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    message.protocolVersion === SLIDE_FRAME_PROTOCOL_VERSION &&
    message.nonce === context.nonce &&
    message.deckId === context.deckId &&
    message.slideId === context.slideId &&
    message.revision === context.revision &&
    message.sourceHash === context.sourceHash &&
    (message.type === "bootstrapped" ||
      message.type === "ready" ||
      (message.type === "rendered" &&
        typeof message.html === "string" &&
        message.html.length <= MAX_RENDERED_SLIDE_HTML_LENGTH &&
        Number.isInteger(message.stepCount) &&
        Number(message.stepCount) >= 0 &&
        Number(message.stepCount) <= 500) ||
      message.type === "snapshot" ||
      message.type === "inspect" ||
      (message.type === "text-range-style" &&
        isSlideFrameTextRangeStyle(message.rangeStyle)) ||
      message.type === "pointer" ||
      message.type === "keyboard" ||
      (message.type === "navigation" &&
        isSlideFrameNavigationInput(message.navigation)) ||
      (message.type === "error" &&
        (message.stage === undefined ||
          message.stage === "bridge" ||
          message.stage === "worker")))
  );
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function designTokenStyle(tokens: SlideDesignTokens | undefined): string {
  if (!tokens) return "";
  const style = [
    `--deck-bg:${tokens.background}`,
    `--deck-ink:${tokens.text}`,
    `--deck-accent:${tokens.accent}`,
    `--deck-heading-font:${tokens.displayFont}`,
    `--deck-body-font:${tokens.bodyFont}`,
    `--deck-hero-scale:${tokens.heroScale}`,
    `--deck-body-scale:${tokens.bodyScale}`,
    `--deck-radius:${tokens.radius}px`,
    `background-color:${tokens.background}`,
    `color:${tokens.text}`,
    `font-family:${tokens.bodyFont}`,
  ].join(";");
  return ` style="${style.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`;
}

export function buildSlideFontFaceCss(
  assets: readonly SlideFontAsset[],
): string {
  return assets
    .map((asset) => {
      const italic =
        asset.variant === "italic" || asset.variant.endsWith("italic");
      const weight =
        asset.variant === "regular" || asset.variant === "italic"
          ? "400"
          : asset.variant.replace(/italic$/, "");
      const format =
        asset.mimeType === "font/otf"
          ? "opentype"
          : asset.mimeType === "font/ttf"
            ? "truetype"
            : asset.mimeType === "font/woff"
              ? "woff"
              : "woff2";
      return `@font-face{font-family:${JSON.stringify(asset.family)};font-style:${italic ? "italic" : "normal"};font-weight:${weight};font-display:swap;src:url(${JSON.stringify(asset.url)}) format(${JSON.stringify(format)})}`;
    })
    .join("\n");
}

export function resolveSlideAssetReference(
  reference: string,
  assetUrls: Readonly<Record<string, string>>,
  appOrigin: string,
  allowedOrigins: readonly string[],
): string {
  const match = /^asset:\/\/([A-Za-z0-9_-]{1,200})$/.exec(reference);
  const value =
    match && Object.hasOwn(assetUrls, match[1]!)
      ? assetUrls[match[1]!]
      : undefined;
  if (typeof value !== "string") {
    throw new Error("Slide references an unavailable uploaded asset.");
  }
  let url: URL;
  let appUrl: URL;
  try {
    url = new URL(value);
    appUrl = new URL(appOrigin);
  } catch {
    throw new Error("Slide asset URL is invalid.");
  }
  if (
    url.href !== value ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && url.origin !== appUrl.origin) ||
    !allowedOrigins.includes(url.origin)
  ) {
    throw new Error("Slide asset origin is invalid.");
  }
  return value;
}

export function resolveSlideWorkerMarkup(
  html: string,
  runtime: SlideWorkerRuntime | null,
  appOrigin: string,
  assetOrigins: readonly string[],
  resolveAssetUrl: typeof resolveSlideAssetReference,
): string {
  if (typeof html !== "string" || html.length > 1024 * 1024) {
    throw new Error("Slide HTML is too large.");
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const elements = template.content.querySelectorAll("*");
  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();
    if (
      /^(?:script|style|iframe|frame|object|embed|link|meta|base|form|input|audio)$/i.test(
        tagName,
      )
    ) {
      throw new Error("Slide contains an unsupported element.");
    }
    if (
      tagName === "source" &&
      element.parentElement?.tagName.toLowerCase() !== "video"
    ) {
      throw new Error("Slide sources must be direct children of a video.");
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        throw new Error("Slide contains an executable attribute.");
      }
      if (name === "src" || name === "poster") {
        if (
          (name === "src" && !["img", "video", "source"].includes(tagName)) ||
          (name === "poster" && tagName !== "video")
        ) {
          throw new Error(
            "Media references are only allowed on supported media elements.",
          );
        }
        if (!runtime) {
          throw new Error("Slide references an unavailable uploaded asset.");
        }
        element.setAttribute(
          name,
          resolveAssetUrl(
            attribute.value,
            runtime.assetUrls,
            appOrigin,
            assetOrigins,
          ),
        );
      }
    }
    if (tagName === "source" && !element.hasAttribute("src")) {
      throw new Error("Video sources need an uploaded asset handle.");
    }
  }
  for (const video of template.content.querySelectorAll("video")) {
    if (
      !video.hasAttribute("src") &&
      !video.querySelector(":scope > source[src]")
    ) {
      throw new Error("Video elements need an uploaded asset source.");
    }
  }
  return template.innerHTML;
}

function frameBridge(
  context: SlideFrameContext,
  artifact: SlideRenderArtifact,
  initialRevealedSteps: number | null,
  appOrigin: string,
): string {
  const config = safeJson({
    protocolVersion: SLIDE_FRAME_PROTOCOL_VERSION,
    ...context,
    appOrigin,
    assetOrigins: artifact.assetOrigins ?? [],
    fontAssets: artifact.fontAssets ?? [],
    runtime: artifact.runtime ?? null,
    initialRevealedSteps,
  });
  return `(() => {
    const config = ${config};
    const resolveAssetUrl = (${resolveSlideAssetReference.toString()});
    const resolveWorkerMarkup = (${resolveSlideWorkerMarkup.toString()});
    const parentWindow = window.parent;
    const root = document.getElementById('slide-root');
    const selectors = '[data-slide-loc]';
    const maxAncestorLocators = ${MAX_SLIDE_FRAME_ANCESTORS};
    const maxAncestorDepth = 512;
    const styleKeys = ['width','height','fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textAlign','color','backgroundColor','opacity','borderRadius','padding','display','position','zIndex','rotate','translate','objectFit','objectPosition','objectViewBox'];
    const originals = new Map();
    let pointerId = null;
    let slideWorker = null;
    let workerUrl = null;
    let workerTimer = null;
    let workerRequest = 0;
    let workerReady = false;
    let bridgeFailureReported = false;
    const send = (type, data = {}) => parentWindow.postMessage({ protocolVersion: config.protocolVersion, nonce: config.nonce, deckId: config.deckId, slideId: config.slideId, revision: config.revision, sourceHash: config.sourceHash, type, ...data }, '*');
    send('bootstrapped');
    const bridgeFailure = () => {
      if (bridgeFailureReported || workerReady) return;
      bridgeFailureReported = true;
      send('error', { stage: 'bridge' });
    };
    window.addEventListener('error', bridgeFailure, { once: true });
    window.addEventListener('unhandledrejection', bridgeFailure, { once: true });
    const stopWorker = () => {
      if (workerTimer !== null) clearTimeout(workerTimer);
      workerTimer = null;
      if (slideWorker) slideWorker.terminate();
      slideWorker = null;
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    };
    const workerFailure = () => {
      bridgeFailureReported = true;
      stopWorker();
      if (root) root.replaceChildren();
      send('error', { stage: 'worker' });
    };
    const renderWorker = (revealedSteps = null) => {
      const runtime = config.runtime;
      if (!runtime || !root) return;
      stopWorker();
      const requestId = String(++workerRequest);
      try {
        workerUrl = URL.createObjectURL(new Blob([runtime.workerSource], { type: 'text/javascript' }));
        slideWorker = new Worker(workerUrl);
        const activeWorker = slideWorker;
        activeWorker.onmessage = (event) => {
          if (activeWorker !== slideWorker) return;
          const result = event.data;
          if (!result || result.requestId !== requestId) return;
          if (result.type === 'error') { workerFailure(); return; }
          if (result.type !== 'rendered' || typeof result.html !== 'string' || result.html.length > 1024 * 1024 || !Number.isInteger(result.stepCount) || result.stepCount < 0 || result.stepCount > 500) { workerFailure(); return; }
          try {
            const html = resolveWorkerMarkup(result.html, config.runtime, config.appOrigin, config.assetOrigins, resolveAssetUrl);
            root.replaceChildren();
            const template = document.createElement('template');
            template.innerHTML = html;
            root.append(template.content);
            send('rendered', { html, stepCount: result.stepCount });
            if (!workerReady) { workerReady = true; send('ready'); }
            requestAnimationFrame(snapshot);
          } catch {
            workerFailure();
          }
          stopWorker();
        };
        activeWorker.onerror = () => workerFailure();
        workerTimer = setTimeout(workerFailure, runtime.timeoutMs);
        activeWorker.postMessage({ type: 'render', requestId, page: runtime.page, revealedSteps, isActivePage: true });
      } catch {
        workerFailure();
      }
    };
    const applySlides2Design = (design) => {
      if (!root || !design) return;
      const { palette, fonts, typeScale } = design;
      root.style.setProperty('--slides2-bg', palette.bg);
      root.style.setProperty('--slides2-text', palette.text);
      root.style.setProperty('--slides2-accent', palette.accent);
      root.style.setProperty('--slides2-font-display', fonts.display);
      root.style.setProperty('--slides2-font-body', fonts.body);
      root.style.setProperty('--slides2-size-hero', typeScale.hero + 'px');
      root.style.setProperty('--slides2-size-body', typeScale.body + 'px');
      root.style.setProperty('--slides2-radius', design.radius + 'px');
    };
    const parseLoc = (element) => {
      const match = /^(\\d+):(\\d+)$/.exec(element.getAttribute('data-slide-loc') || '');
      return match ? { line: Number(match[1]), column: Number(match[2]) } : null;
    };
    const toRect = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    };
    const visibleNodesAt = (loc) => Array.from(document.querySelectorAll('[data-slide-loc="' + loc.line + ':' + loc.column + '"]')).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const localDelta = (basis, delta) => {
      const determinant = basis.a * basis.d - basis.b * basis.c;
      if (Math.abs(determinant) < 0.000001) return { x: 0, y: 0 };
      return { x: (basis.d * delta.x - basis.c * delta.y) / determinant, y: (basis.a * delta.y - basis.b * delta.x) / determinant };
    };
    const angleDegrees = (value) => {
      if (!value || value === 'none') return 0;
      const match = /(-?[\\d.]+)(deg|grad|rad|turn)$/.exec(value.trim());
      if (!match) return 0;
      const angle = Number(match[1]);
      if (!Number.isFinite(angle)) return 0;
      if (match[2] === 'grad') return angle * 0.9;
      if (match[2] === 'rad') return angle * 180 / Math.PI;
      if (match[2] === 'turn') return angle * 360;
      return angle;
    };
    const captureTransform = (element) => {
      const originalStyle = element.getAttribute('style');
      const computed = getComputedStyle(element);
      const width = Number.parseFloat(computed.width) || element.offsetWidth;
      const height = Number.parseFloat(computed.height) || element.offsetHeight;
      const rotation = angleDegrees(computed.rotate);
      const before = element.getBoundingClientRect();
      element.style.transition = 'none';
      element.style.translate = '0px 0px';
      const zero = element.getBoundingClientRect();
      element.style.translate = '100px 0px';
      const x = element.getBoundingClientRect();
      element.style.translate = '0px 100px';
      const y = element.getBoundingClientRect();
      if (originalStyle === null) element.removeAttribute('style');
      else element.setAttribute('style', originalStyle);
      const basis = { a: (x.x - zero.x) / 100, b: (x.y - zero.y) / 100, c: (y.x - zero.x) / 100, d: (y.y - zero.y) / 100 };
      return { basis, translate: localDelta(basis, { x: before.x - zero.x, y: before.y - zero.y }), width, height, rotation };
    };
    const ancestorDataFor = (element) => {
      const ancestorLocators = [];
      let current = element.parentElement;
      let depth = 0;
      let ancestorLocatorsComplete = true;
      while (current && depth < maxAncestorDepth) {
        if (current.matches(selectors)) {
          const loc = parseLoc(current);
          if (loc) {
            if (ancestorLocators.length >= maxAncestorLocators) {
              ancestorLocatorsComplete = false;
              break;
            }
            ancestorLocators.push(loc.line + ':' + loc.column);
          }
        }
        current = current.parentElement;
        depth++;
      }
      if (current) ancestorLocatorsComplete = false;
      return { ancestorLocators, ancestorLocatorsComplete };
    };
    const readNode = (element, nodeId, includeTransform = false, instanceIndex, instanceCount) => {
      const loc = parseLoc(element);
      const rect = toRect(element);
      const style = getComputedStyle(element);
      const styles = {};
      for (const key of styleKeys) styles[key] = key === 'objectViewBox' ? (style.getPropertyValue('object-view-box') || style[key] || '') : (style[key] || '');
      return { nodeId, ...loc, instanceIndex, instanceCount, tagName: element.tagName.toLowerCase(), bounds: rect, text: (element.innerText || '').slice(0, 12000), styles, ...ancestorDataFor(element), ...(includeTransform ? { transform: captureTransform(element) } : {}) };
    };
    const readNodes = () => {
      const visibleNodes = Array.from(document.querySelectorAll(selectors)).flatMap((element) => {
        const loc = parseLoc(element);
        const rect = toRect(element);
        const style = getComputedStyle(element);
        if (!loc || rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return [];
        return [{ element, loc }];
      });
      const instanceCounts = new Map();
      for (const { loc } of visibleNodes) {
        const key = loc.line + ':' + loc.column;
        instanceCounts.set(key, (instanceCounts.get(key) || 0) + 1);
      }
      const instanceIndices = new Map();
      return visibleNodes.map(({ element, loc }) => {
        const key = loc.line + ':' + loc.column;
        const instanceIndex = instanceIndices.get(key) || 0;
        instanceIndices.set(key, instanceIndex + 1);
        return readNode(element, key + ':' + instanceIndex, false, instanceIndex, instanceCounts.get(key));
      });
    };
    const snapshot = () => send('snapshot', { nodes: readNodes() });
    const targetFor = (target) => {
      const element = target instanceof Element ? target.closest(selectors) : null;
      if (!(element instanceof HTMLElement)) return null;
      const loc = parseLoc(element);
      if (!loc) return null;
      const siblings = visibleNodesAt(loc);
      const index = siblings.indexOf(element);
      if (index < 0) return null;
      const nodeId = loc.line + ':' + loc.column + ':' + index;
      return { ...loc, nodeId, snapshot: readNode(element, nodeId, true, index, siblings.length) };
    };
    const inspectTargets = (targets) => {
      const nodes = [];
      for (const target of targets) {
        if (!target || !Number.isInteger(target.line) || !Number.isInteger(target.column) || typeof target.nodeId !== 'string') continue;
        const match = /^(\\d+):(\\d+):(\\d+)$/.exec(target.nodeId);
        if (!match || Number(match[1]) !== target.line || Number(match[2]) !== target.column) continue;
        const siblings = visibleNodesAt({ line: target.line, column: target.column });
        const instanceIndex = Number(match[3]);
        const element = siblings[instanceIndex];
        if (element) nodes.push(readNode(element, target.nodeId, true, instanceIndex, siblings.length));
      }
      send('inspect', { nodes });
    };
    const inspectTextRange = (command) => {
      const target = command.target;
      const expectedText = command.expectedText;
      if (!target || !Number.isInteger(target.line) || !Number.isInteger(target.column) || typeof target.nodeId !== 'string' || typeof expectedText !== 'string' || expectedText.length > 12000 || !Number.isInteger(command.start) || !Number.isInteger(command.end) || command.start < 0 || command.end <= command.start || command.end > expectedText.length) return;
      const match = /^(\\d+):(\\d+):(\\d+)$/.exec(target.nodeId);
      if (!match || Number(match[1]) !== target.line || Number(match[2]) !== target.column) return;
      const element = visibleNodesAt({ line: target.line, column: target.column })[Number(match[3])];
      if (!element || element.innerText !== expectedText) return;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const parts = [];
      let text = '';
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = text.length;
        text += node.data;
        parts.push({ node, start, end: text.length });
      }
      if (text !== expectedText || command.end > text.length) return;
      const part = parts.find((entry) => command.start >= entry.start && command.start < entry.end);
      const styleElement = part?.node.parentElement;
      if (!styleElement) return;
      const style = getComputedStyle(styleElement);
      send('text-range-style', { rangeStyle: {
        line: target.line,
        column: target.column,
        nodeId: target.nodeId,
        start: command.start,
        end: command.end,
        expectedText,
        styles: {
          fontFamily: style.fontFamily.slice(0, 400),
          fontSize: style.fontSize.slice(0, 400),
          fontStyle: style.fontStyle.slice(0, 400),
          fontWeight: style.fontWeight.slice(0, 400),
          color: style.color.slice(0, 400),
        },
      } });
    };
    const resetPreview = () => {
      for (const [element, value] of originals) {
        element.setAttribute('style', value.style);
        element.replaceChildren(...value.children.map((child) => child.cloneNode(true)));
      }
      originals.clear();
    };
    const cssName = (key) => key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
    const previewRangeStyle = (element, rangeStyle) => {
      const allowedKeys = ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'color'];
      if (!rangeStyle || !Number.isInteger(rangeStyle.start) || !Number.isInteger(rangeStyle.end) || rangeStyle.start < 0 || rangeStyle.end <= rangeStyle.start || !allowedKeys.includes(rangeStyle.key) || typeof rangeStyle.expectedText !== 'string') return;
      if (element.innerText !== rangeStyle.expectedText) return;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const parts = [];
      let text = '';
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = text.length;
        text += node.data;
        parts.push({ node, start, end: text.length });
      }
      if (text !== rangeStyle.expectedText || rangeStyle.end > text.length) return;
      const value = rangeStyle.value ?? (rangeStyle.key === 'fontWeight' ? '400' : rangeStyle.key === 'fontStyle' ? 'normal' : null);
      if (value === null) return;
      for (const part of parts) {
        const start = Math.max(rangeStyle.start, part.start);
        const end = Math.min(rangeStyle.end, part.end);
        if (start >= end || !part.node.parentNode) continue;
        const localStart = start - part.start;
        const localEnd = end - part.start;
        const fragment = document.createDocumentFragment();
        if (localStart) fragment.append(document.createTextNode(part.node.data.slice(0, localStart)));
        const span = document.createElement('span');
        span.style.setProperty(cssName(rangeStyle.key), value);
        span.textContent = part.node.data.slice(localStart, localEnd);
        fragment.append(span);
        if (localEnd < part.node.data.length) fragment.append(document.createTextNode(part.node.data.slice(localEnd)));
        part.node.replaceWith(fragment);
      }
    };
    const applyPreview = (patches) => {
      resetPreview();
      for (const patch of patches) {
        if (!patch || !Number.isInteger(patch.line) || !Number.isInteger(patch.column)) continue;
        const selector = '[data-slide-loc="' + patch.line + ':' + patch.column + '"]';
        for (const element of document.querySelectorAll(selector)) {
          if (!originals.has(element)) originals.set(element, { style: element.getAttribute('style') || '', children: Array.from(element.childNodes).map((child) => child.cloneNode(true)) });
          for (const [key, value] of Object.entries(patch.styles || {})) {
            if (typeof value !== 'string' && value !== null) continue;
            if (value === null) element.style.removeProperty(cssName(key));
            else element.style.setProperty(cssName(key), value);
          }
          if (typeof patch.text === 'string') element.textContent = patch.text;
          if (Array.isArray(patch.rangeStyles)) {
            for (const rangeStyle of patch.rangeStyles) previewRangeStyle(element, rangeStyle);
          }
        }
      }
      requestAnimationFrame(snapshot);
    };
    window.addEventListener('message', (event) => {
      if (event.source !== parentWindow) return;
      const command = event.data;
      if (!command || command.protocolVersion !== config.protocolVersion || command.nonce !== config.nonce || command.deckId !== config.deckId || command.slideId !== config.slideId || command.revision !== config.revision || command.sourceHash !== config.sourceHash) return;
      if (command.type === 'clear-preview') { resetPreview(); snapshot(); }
      if (command.type === 'preview' && Array.isArray(command.patches)) applyPreview(command.patches);
      if (command.type === 'inspect' && Array.isArray(command.targets)) inspectTargets(command.targets);
      if (command.type === 'inspect-text-range') inspectTextRange(command);
      if (command.type === 'set-design-tokens' && command.tokens && typeof command.tokens === 'object') {
        const tokens = command.tokens;
        const isColor = (value) => typeof value === 'string' && /^#[\\da-f]{6}$/i.test(value);
        const isFont = (value) => typeof value === 'string' && value.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value);
        const isFontAssetId = (value) => value === undefined || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value));
        if (!(root instanceof HTMLElement) || !isColor(tokens.background) || !isColor(tokens.text) || !isColor(tokens.accent) || !isFont(tokens.displayFont) || !isFontAssetId(tokens.displayFontAssetId) || !isFont(tokens.bodyFont) || !isFontAssetId(tokens.bodyFontAssetId) || typeof tokens.heroScale !== 'number' || !Number.isFinite(tokens.heroScale) || tokens.heroScale < 0.5 || tokens.heroScale > 2 || typeof tokens.bodyScale !== 'number' || !Number.isFinite(tokens.bodyScale) || tokens.bodyScale < 0.5 || tokens.bodyScale > 2 || typeof tokens.radius !== 'number' || !Number.isFinite(tokens.radius) || tokens.radius < 0 || tokens.radius > 48) return;
        root.style.setProperty('--deck-bg', tokens.background);
        root.style.setProperty('--deck-ink', tokens.text);
        root.style.setProperty('--deck-accent', tokens.accent);
        root.style.setProperty('--deck-heading-font', tokens.displayFont);
        root.style.setProperty('--deck-body-font', tokens.bodyFont);
        root.style.setProperty('--deck-hero-scale', String(tokens.heroScale));
        root.style.setProperty('--deck-body-scale', String(tokens.bodyScale));
        root.style.setProperty('--deck-radius', tokens.radius + 'px');
        root.style.backgroundColor = tokens.background;
        root.style.color = tokens.text;
        root.style.fontFamily = tokens.bodyFont;
      }
      if (command.type === 'set-revealed-steps' && config.runtime && (command.revealedSteps === null || (Number.isInteger(command.revealedSteps) && command.revealedSteps >= 0 && command.revealedSteps <= 500))) renderWorker(command.revealedSteps);
    });
    const emitPointer = (event, includeTarget = true) => send('pointer', { pointer: { phase: event.type.slice(7), x: event.clientX, y: event.clientY, button: event.button, pointerId: event.pointerId, pointerType: event.pointerType, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, target: includeTarget ? targetFor(event.target) : null } });
    document.addEventListener('pointerdown', (event) => { pointerId = event.pointerId; emitPointer(event); }, true);
    document.addEventListener('pointermove', (event) => { if (pointerId === event.pointerId) emitPointer(event); else if (pointerId === null && event.buttons === 0) emitPointer(event, false); }, true);
    document.addEventListener('pointerup', (event) => { if (pointerId === event.pointerId) { emitPointer(event); pointerId = null; } }, true);
    document.addEventListener('pointercancel', (event) => { if (pointerId === event.pointerId) { emitPointer(event); pointerId = null; } }, true);
    document.addEventListener('dblclick', (event) => send('pointer', { pointer: { phase: 'double-click', x: event.clientX, y: event.clientY, button: event.button, pointerId: 0, pointerType: 'mouse', shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, target: targetFor(event.target) } }), true);
    const navigationPassthrough = 'a, button, input, textarea, select, label, summary, iframe, video, audio, embed, object, [role="button"], [role="link"], [contenteditable="true"], [data-slides2-interactive], [data-slides2-chrome]';
    const navigationWheelIgnored = 'input, textarea, select, [contenteditable="true"], [data-wheel-nav-ignore]';
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const rect = root?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      send('navigation', { navigation: {
        type: 'click',
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        button: event.button,
        defaultPrevented: event.defaultPrevented,
        interactive: Boolean(target?.closest(navigationPassthrough)),
        hasSelection: Boolean(window.getSelection()?.toString()),
      } });
    });
    document.addEventListener('wheel', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.ctrlKey || target?.closest(navigationWheelIgnored)) return;
      const scale = window.visualViewport?.scale ?? 1;
      if (scale > 1.01) return;
      const normalize = (delta) => event.deltaMode === 1 ? delta * 16 : event.deltaMode === 2 ? delta * 800 : delta;
      const deltaX = normalize(event.deltaX);
      const deltaY = normalize(event.deltaY);
      if (Math.abs(deltaY) <= Math.abs(deltaX)) return;
      event.preventDefault();
      send('navigation', { navigation: {
        type: 'wheel',
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
      } });
    }, { capture: true, passive: false });
    document.addEventListener('keydown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const isTypingTarget = target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea'));
      const isControlTarget = Boolean(target?.closest('button, a, input, textarea, select, summary, [role="dialog"], [role="menu"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="listbox"], [role="option"], [role="tablist"], [data-inspector-ui], [data-design-ui]'));
      const command = (event.ctrlKey || event.metaKey) && !event.altKey;
      const commandKey = event.key.toLowerCase();
      if (command && !event.isComposing && event.keyCode !== 229 && ((!event.shiftKey && commandKey === 's') || (commandKey === 'a' && !isTypingTarget && !isControlTarget))) event.preventDefault();
      send('keyboard', { keyboard: { key: event.key, keyCode: Math.max(0, Math.min(65535, event.keyCode | 0)), shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, isTypingTarget, isControlTarget, isComposing: event.isComposing } });
    }, true);
    const observer = new MutationObserver(() => requestAnimationFrame(snapshot));
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'data-slide-loc'] });
    window.addEventListener('resize', snapshot);
    document.fonts?.ready.then(snapshot);
    if (config.runtime) {
      const style = document.createElement('style');
      style.textContent = config.runtime.styles.join('\\n');
      document.head.append(style);
      applySlides2Design(config.runtime.design);
      renderWorker(config.initialRevealedSteps);
    } else {
      send('ready');
      requestAnimationFrame(snapshot);
    }
    window.addEventListener('pagehide', stopWorker, { once: true });
  })();`;
}

export function buildSlideSrcDoc(
  artifact: SlideRenderArtifact,
  nonce: string,
  appOrigin: string,
  initialRevealedSteps: number | null = null,
): string {
  const context: SlideFrameContext = {
    deckId: artifact.deckId,
    slideId: artifact.slideId,
    revision: artifact.revision,
    sourceHash: artifact.sourceHash,
    nonce,
  };
  const appUrl = new URL(appOrigin);
  if (!isSlideRenderArtifact(artifact, appUrl.origin)) {
    throw new Error("Slide render artifact is invalid.");
  }
  if (
    initialRevealedSteps !== null &&
    (!Number.isInteger(initialRevealedSteps) ||
      initialRevealedSteps < 0 ||
      initialRevealedSteps > 500)
  ) {
    throw new Error("Initial revealed step count is invalid.");
  }
  const assetOrigins = new Set<string>();
  for (const origin of artifact.assetOrigins ?? []) {
    try {
      const parsed = new URL(origin);
      if (
        parsed.origin === origin &&
        (parsed.protocol === "https:" || parsed.origin === appUrl.origin)
      ) {
        assetOrigins.add(parsed.origin);
      }
    } catch {
      // coercion-ok: artifact validation rejects malformed origins before CSP assembly.
    }
  }
  const mediaSources = assetOrigins.size
    ? [...assetOrigins].join(" ")
    : "'none'";
  const fontOrigins = new Set(artifact.fontOrigins ?? []);
  const fontSources = fontOrigins.size ? [...fontOrigins].join(" ") : "'none'";
  const fontFaceCss = buildSlideFontFaceCss(artifact.fontAssets ?? []);
  const csp = [
    "default-src 'none'",
    `img-src ${mediaSources}`,
    `media-src ${mediaSources}`,
    `font-src ${fontSources}`,
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const script = frameBridge(
    context,
    artifact,
    initialRevealedSteps,
    appUrl.origin,
  ).replace(/<\//g, "<\\/");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=1920, height=1080, initial-scale=1"><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:transparent}#slide-root{position:relative;width:1920px;height:1080px;overflow:hidden}</style><style>${fontFaceCss}</style></head><body><main id="slide-root"${designTokenStyle(artifact.designTokens)}>${artifact.html}</main><script nonce="${nonce}">${script}</script></body></html>`;
}
