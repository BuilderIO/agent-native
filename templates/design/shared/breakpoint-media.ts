import {
  breakpointUpperBoundPx,
  maxWidthOverridesForStem,
  normalizeCssPropertyName,
  utilityStemsForCssProperty,
} from "./responsive-classes.js";

export type BreakpointMediaModel = Record<
  string,
  Record<string, Record<string, string>>
>;

export interface BreakpointMediaDeclaration {
  maxWidthPx: number;
  nodeId: string;
  property: string;
  value: string;
}

const CSS_VALUE_BREAKOUT_RE = /[;{}<>]|\/\*|\*\//;
const CSS_VALUE_URL_RE = /\burl\s*\(/i;
const CSS_VALUE_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const URL_FUNCTION_RE =
  /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/gi;
const IMAGE_FIT_MARKER_RE =
  /\/\*\s*agent-native-image-fit:(?:fill|fit|crop|tile)\s*\*\//gi;

const URL_CAPABLE_PROPERTIES = new Set(["background-image"]);

export function isSafeCssUrlReference(rawUrl: string): boolean {
  const url = rawUrl.trim();
  if (!url) return false;
  if (CSS_VALUE_CONTROL_RE.test(url)) return false;
  if (/[<>"']/.test(url)) return false;
  if (/^javascript\s*:/i.test(url)) return false;
  if (/^data\s*:/i.test(url)) return /^data:image\//i.test(url);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return /^https?:\/\//i.test(url);
  }
  return true;
}

export function isSafeBreakpointCssValue(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (
    CSS_VALUE_CONTROL_RE.test(value) ||
    CSS_VALUE_BREAKOUT_RE.test(value) ||
    CSS_VALUE_URL_RE.test(value)
  ) {
    return false;
  }
  return true;
}

function isSafeBackgroundValue(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.trim().length === 0) return false;

  URL_FUNCTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let withoutValidatedParts = "";
  while ((match = URL_FUNCTION_RE.exec(value))) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    if (!isSafeCssUrlReference(raw)) return false;
    withoutValidatedParts += value.slice(lastIndex, match.index);
    lastIndex = URL_FUNCTION_RE.lastIndex;
  }
  withoutValidatedParts += value.slice(lastIndex);
  if (CSS_VALUE_URL_RE.test(withoutValidatedParts)) return false;

  const withoutFitMarker = withoutValidatedParts.replace(
    IMAGE_FIT_MARKER_RE,
    "",
  );
  if (
    CSS_VALUE_CONTROL_RE.test(withoutFitMarker) ||
    CSS_VALUE_BREAKOUT_RE.test(withoutFitMarker)
  ) {
    return false;
  }
  return true;
}

export function isSafeBreakpointCssValueForProperty(
  property: string,
  value: string,
): boolean {
  if (URL_CAPABLE_PROPERTIES.has(property)) return isSafeBackgroundValue(value);
  return isSafeBreakpointCssValue(value);
}

export function isSafeBreakpointCssProperty(property: string): boolean {
  return /^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(property);
}

const OPEN_RE = /<style\b(?=[^>]*\bdata-agent-native-breakpoints\b)[^>]*>/i;

export function extractManagedBreakpointCss(html: string): string | null {
  const openMatch = OPEN_RE.exec(html);
  if (!openMatch) return null;
  const bodyStart = openMatch.index + openMatch[0].length;
  const afterOpen = html.slice(bodyStart);
  const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
  if (!closeMatch) return null;
  return afterOpen.slice(0, closeMatch.index).trim();
}

export function injectManagedBreakpointCss(html: string, css: string): string {
  const openMatch = OPEN_RE.exec(html);
  const trimmed = css.trim();
  const block =
    trimmed.length > 0
      ? `<style data-agent-native-breakpoints>\n${trimmed}\n</style>`
      : "";

  if (openMatch) {
    const bodyStart = openMatch.index + openMatch[0].length;
    const afterOpen = html.slice(bodyStart);
    const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
    if (closeMatch) {
      const closeEnd = bodyStart + closeMatch.index + closeMatch[0].length;
      if (block === "") {
        const after = html.slice(closeEnd);
        return html.slice(0, openMatch.index) + after.replace(/^\n/, "");
      }
      return html.slice(0, openMatch.index) + block + html.slice(closeEnd);
    }
  }

  if (block === "") return html;
  const headClose = html.lastIndexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + block + "\n" + html.slice(headClose);
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(html);
  if (htmlOpen) {
    const afterOpen = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, afterOpen) + "\n" + block + html.slice(afterOpen);
  }
  return block + "\n" + html;
}

export function parseBreakpointMediaCss(css: string): BreakpointMediaModel {
  const model: BreakpointMediaModel = {};
  const mediaRe = /@media\s*\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)\s*\{/g;
  let mediaMatch: RegExpExecArray | null;

  while ((mediaMatch = mediaRe.exec(css)) !== null) {
    const maxWidthPx = Math.round(Number.parseFloat(mediaMatch[1]));
    if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) continue;
    const bodyStart = mediaMatch.index + mediaMatch[0].length;
    const body = extractBlock(css, bodyStart);
    if (body === null) continue;
    mediaRe.lastIndex = bodyStart + body.length + 1;

    const ruleRe =
      /\[data-agent-native-node-id="((?:\\.|[^"\\])*)"\]\s*\{([^}]*)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = ruleRe.exec(body)) !== null) {
      const nodeId = unescAttr(ruleMatch[1]);
      if (!nodeId) continue;
      const declarations = ruleMatch[2]
        .split(";")
        .map((decl) => decl.trim())
        .filter(Boolean);
      for (const declaration of declarations) {
        const colon = declaration.indexOf(":");
        if (colon <= 0) continue;
        const property = declaration.slice(0, colon).trim();
        const value = declaration.slice(colon + 1).trim();
        if (!isSafeBreakpointCssProperty(property)) continue;
        if (!isSafeBreakpointCssValueForProperty(property, value)) continue;
        const bucketKey = String(maxWidthPx);
        model[bucketKey] ??= {};
        model[bucketKey][nodeId] ??= {};
        model[bucketKey][nodeId][property] = value;
      }
    }
  }

  return model;
}

export function serializeBreakpointMediaModel(
  model: BreakpointMediaModel,
): string {
  const buckets = Object.keys(model)
    .map((key) => Number.parseInt(key, 10))
    .filter((width) => Number.isFinite(width) && width > 0)
    .sort((a, b) => b - a);

  const blocks: string[] = [];
  for (const maxWidthPx of buckets) {
    const nodes = model[String(maxWidthPx)];
    if (!nodes) continue;
    const nodeIds = Object.keys(nodes).sort((a, b) => a.localeCompare(b));
    const rules: string[] = [];
    for (const nodeId of nodeIds) {
      const declarations = nodes[nodeId];
      const properties = Object.keys(declarations).sort((a, b) =>
        a.localeCompare(b),
      );
      if (properties.length === 0) continue;
      const lines = properties.map(
        (property) => `    ${property}: ${declarations[property]};`,
      );
      const attrSelector = `[data-agent-native-node-id="${escAttr(nodeId)}"]`;
      rules.push(
        `  ${attrSelector}${attrSelector} {\n${lines.join("\n")}\n  }`,
      );
    }
    if (rules.length === 0) continue;
    blocks.push(
      `@media (max-width: ${maxWidthPx}px) {\n${rules.join("\n")}\n}`,
    );
  }
  return blocks.join("\n\n");
}

export function setBreakpointMediaDeclaration(
  html: string,
  args: {
    nodeId: string;
    maxWidthPx: number;
    property: string;
    value: string;
  },
): string {
  const property = normalizeCssPropertyName(args.property.trim());
  if (!isSafeBreakpointCssProperty(property)) {
    throw new Error(
      `Invalid breakpoint override property: "${args.property}".`,
    );
  }
  if (!isSafeBreakpointCssValueForProperty(property, args.value)) {
    throw new Error(
      `Invalid breakpoint override value for "${property}": semicolons, braces, comments, angle brackets, control characters, and unsafe url(...) references are not allowed.`,
    );
  }
  if (!Number.isFinite(args.maxWidthPx) || args.maxWidthPx <= 0) {
    throw new Error(`Invalid breakpoint bound: ${args.maxWidthPx}px.`);
  }
  const model = parseBreakpointMediaCss(
    extractManagedBreakpointCss(html) ?? "",
  );
  const bucketKey = String(Math.round(args.maxWidthPx));
  model[bucketKey] ??= {};
  model[bucketKey][args.nodeId] ??= {};
  model[bucketKey][args.nodeId][property] = args.value.trim();
  return injectManagedBreakpointCss(html, serializeBreakpointMediaModel(model));
}

export function removeBreakpointMediaDeclaration(
  html: string,
  args: { nodeId: string; maxWidthPx: number; property: string },
): string {
  const css = extractManagedBreakpointCss(html);
  if (css === null) return html;
  const model = parseBreakpointMediaCss(css);
  const bucketKey = String(Math.round(args.maxWidthPx));
  const property = normalizeCssPropertyName(args.property.trim());
  const node = model[bucketKey]?.[args.nodeId];
  if (!node || !(property in node)) return html;
  delete node[property];
  if (Object.keys(node).length === 0) {
    delete model[bucketKey][args.nodeId];
  }
  if (Object.keys(model[bucketKey]).length === 0) {
    delete model[bucketKey];
  }
  return injectManagedBreakpointCss(html, serializeBreakpointMediaModel(model));
}

export function getBreakpointMediaDeclarations(
  html: string,
  nodeId?: string | null,
): BreakpointMediaDeclaration[] {
  const css = extractManagedBreakpointCss(html);
  if (css === null) return [];
  const model = parseBreakpointMediaCss(css);
  const declarations: BreakpointMediaDeclaration[] = [];
  for (const bucketKey of Object.keys(model)) {
    const maxWidthPx = Number.parseInt(bucketKey, 10);
    for (const [ruleNodeId, props] of Object.entries(model[bucketKey])) {
      if (nodeId != null && ruleNodeId !== nodeId) continue;
      for (const [property, value] of Object.entries(props)) {
        declarations.push({ maxWidthPx, nodeId: ruleNodeId, property, value });
      }
    }
  }
  return declarations.sort(
    (a, b) =>
      b.maxWidthPx - a.maxWidthPx ||
      a.nodeId.localeCompare(b.nodeId) ||
      a.property.localeCompare(b.property),
  );
}

export interface BreakpointPropertyOverride {
  maxWidthPx: number;
  source: "class" | "media";
  value: string;
}

export interface BreakpointOverrideState {
  overrides: BreakpointPropertyOverride[];
  overriddenAtActive: boolean;
  activeUpperBoundPx: number | null;
}

export function getBreakpointOverrideState(args: {
  className: string;
  html?: string | null;
  nodeId?: string | null;
  property: string;
  breakpointWidths: readonly number[];
  baseWidthPx?: number | null;
  activeWidthPx?: number | null;
}): BreakpointOverrideState {
  const property = normalizeCssPropertyName(args.property.trim());
  const stems = utilityStemsForCssProperty(property);

  const overrides: BreakpointPropertyOverride[] = [];
  for (const stem of stems) {
    for (const override of maxWidthOverridesForStem(args.className, stem)) {
      overrides.push({
        maxWidthPx: override.boundPx,
        source: "class",
        value: override.utility,
      });
    }
  }
  if (args.html && args.nodeId) {
    for (const declaration of getBreakpointMediaDeclarations(
      args.html,
      args.nodeId,
    )) {
      if (declaration.property !== property) continue;
      overrides.push({
        maxWidthPx: declaration.maxWidthPx,
        source: "media",
        value: declaration.value,
      });
    }
  }
  overrides.sort((a, b) => b.maxWidthPx - a.maxWidthPx);

  const activeUpperBoundPx =
    args.activeWidthPx != null
      ? breakpointUpperBoundPx(
          args.breakpointWidths,
          args.activeWidthPx,
          args.baseWidthPx,
        )
      : null;

  return {
    overrides,
    overriddenAtActive:
      activeUpperBoundPx !== null &&
      overrides.some((override) => override.maxWidthPx === activeUpperBoundPx),
    activeUpperBoundPx,
  };
}

function escAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescAttr(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function extractBlock(css: string, start: number): string | null {
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return css.slice(start, i - 1);
}
