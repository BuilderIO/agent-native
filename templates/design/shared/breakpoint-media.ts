/**
 * Managed breakpoint media block for the Design Studio (§6.4).
 *
 * Responsive class prefixes can't express arbitrary values (exact px
 * positions from canvas drags, rgb() colors, calc() sizes, …). Those
 * overrides persist into a single managed
 * `<style data-agent-native-breakpoints>` block as plain
 * `@media (max-width: Npx)` rules — readable and editable in the Code panel,
 * and rendered identically by every breakpoint frame because each frame is
 * just the same document at a different viewport width.
 *
 * Follows the managed-block conventions of `motion-compiler.ts`:
 * - **Deterministic**: same model → byte-identical CSS. Buckets are sorted
 *   widest bound first (so narrower ranges win by source order, matching the
 *   Framer desktop-down cascade), node ids and properties alphabetically.
 * - **Targets by node id**: rules use `[data-agent-native-node-id="<id>"]`
 *   selectors — no class/id coupling.
 * - **No dependencies**, pure string transforms.
 */

import {
  breakpointUpperBoundPx,
  maxWidthOverridesForStem,
  normalizeCssPropertyName,
  utilityStemsForCssProperty,
} from "./responsive-classes.js";

// ─── Model ────────────────────────────────────────────────────────────────────

/**
 * Parsed managed block: max-width bound (px) → node id → CSS property →
 * value. Plain nested records so callers can serialize/diff cheaply.
 */
export type BreakpointMediaModel = Record<
  string,
  Record<string, Record<string, string>>
>;

/** One flattened managed rule, as returned by `getBreakpointMediaDeclarations`. */
export interface BreakpointMediaDeclaration {
  maxWidthPx: number;
  nodeId: string;
  property: string;
  value: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const CSS_VALUE_BREAKOUT_RE = /[;{}<>]|\/\*|\*\//;
const CSS_VALUE_URL_RE = /\burl\s*\(/i;
const CSS_VALUE_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const URL_FUNCTION_RE =
  /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/gi;
// The image-fill fit marker (`ImageFillControls.tsx`'s `imageFitMarker`) is
// the one recognized comment shape allowed inside a background-image
// value — every other /* ... *\/ is still rejected as a breakout risk.
const IMAGE_FIT_MARKER_RE =
  /\/\*\s*agent-native-image-fit:(?:fill|fit|crop|tile)\s*\*\//gi;

/**
 * CSS properties allowed to carry a `url(...)` reference (fill images).
 * Deliberately excludes the `background` shorthand — only the exact
 * `background-image` longhand that `imageFillToBackgroundStyles` commits is
 * trusted with a sanitized url(); shorthand `background: url(...)` values
 * (e.g. hand-edited in the Code panel) stay on the strict no-url path.
 */
const URL_CAPABLE_PROPERTIES = new Set(["background-image"]);

/**
 * Safety gate for a single `url(...)` reference inside a background-image
 * value. Allows http(s), protocol-relative, root/relative paths, and
 * `data:image/...` URIs — the shapes `imageFillToBackgroundStyles` and the
 * fill picker actually produce. Rejects `javascript:`, non-image `data:`
 * payloads (e.g. `data:text/html`), and any other unrecognized scheme.
 */
export function isSafeCssUrlReference(rawUrl: string): boolean {
  const url = rawUrl.trim();
  if (!url) return false;
  if (CSS_VALUE_CONTROL_RE.test(url)) return false;
  // A legitimate URL/data-URI never needs a literal angle bracket or quote —
  // reject outright rather than rely on the outer HTML/CSS writer to escape
  // them correctly.
  if (/[<>"']/.test(url)) return false;
  if (/^javascript\s*:/i.test(url)) return false;
  if (/^data\s*:/i.test(url)) return /^data:image\//i.test(url);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    // Any other explicit scheme (vbscript:, file:, etc.) — only the
    // web-safe ones are allowed.
    return /^https?:\/\//i.test(url);
  }
  // No scheme — protocol-relative ("//host/...") or relative/root path.
  return true;
}

/**
 * Reject caller-supplied CSS values before interpolation into the managed
 * stylesheet. Allows useful CSS functions (`calc(...)`, `var(...)`,
 * `rgb(...)`) but blocks declaration/rule breakouts and remote-resource
 * hooks — same policy as the managed motion block.
 *
 * `url(...)` is rejected unconditionally here; callers persisting a
 * sanitized fill image reference (`background-image`) should use
 * {@link isSafeBreakpointCssValueForProperty} instead, which applies the
 * scheme allowlist from {@link isSafeCssUrlReference} per-reference.
 */
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

/**
 * Same breakout/control-character policy as {@link isSafeBreakpointCssValue},
 * but for `background-image` every `url(...)` reference is checked against
 * {@link isSafeCssUrlReference} (which itself rejects control characters and
 * `<>"'`) instead of being rejected outright. A validated `url(...)` — a
 * `data:image/...` URI legitimately contains a `;` before `base64,` — is
 * excised before the generic breakout check runs, so that check only ever
 * sees the CSS *around* the url() reference.
 */
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
  // Any "url(" left over wasn't matched by the well-formed pattern above
  // (malformed/unterminated) — reject rather than pass it through.
  if (CSS_VALUE_URL_RE.test(withoutValidatedParts)) return false;

  // Strip the one recognized comment shape (the image-fill fit marker) too,
  // so a legitimate fill commit isn't rejected just for carrying it. Any
  // OTHER comment still trips the breakout check below.
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

/**
 * Value safety check for a given CSS property: routes `background-image`
 * through {@link isSafeBackgroundValue} (which allows sanitized `url(...)`
 * references) and every other property — including the `background`
 * shorthand — through the strict {@link isSafeBreakpointCssValue}.
 */
export function isSafeBreakpointCssValueForProperty(
  property: string,
  value: string,
): boolean {
  if (URL_CAPABLE_PROPERTIES.has(property)) return isSafeBackgroundValue(value);
  return isSafeBreakpointCssValue(value);
}

/** Valid (optionally vendor-prefixed) CSS property identifier. */
export function isSafeBreakpointCssProperty(property: string): boolean {
  return /^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(property);
}

// ─── HTML block extraction / injection ───────────────────────────────────────

const OPEN_RE = /<style\b(?=[^>]*\bdata-agent-native-breakpoints\b)[^>]*>/i;

/**
 * Extract the CSS body of the managed `<style data-agent-native-breakpoints>`
 * block. Returns `null` when the document has no managed block.
 */
export function extractManagedBreakpointCss(html: string): string | null {
  const openMatch = OPEN_RE.exec(html);
  if (!openMatch) return null;
  const bodyStart = openMatch.index + openMatch[0].length;
  const afterOpen = html.slice(bodyStart);
  const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
  if (!closeMatch) return null;
  return afterOpen.slice(0, closeMatch.index).trim();
}

/**
 * Inject or replace the managed block. Inserts before `</head>` when no
 * managed block exists, or at the top of the document when there is no
 * `<head>`. Passing empty CSS removes the block entirely.
 */
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
      // Removing the block: also swallow one trailing newline so repeated
      // add/remove cycles don't accumulate blank lines.
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
  return block + "\n" + html;
}

// ─── CSS body parse / serialize ──────────────────────────────────────────────

/**
 * Parse a managed CSS body into the model. Tolerant of hand edits made in
 * the Code panel: unknown at-rules and selectors are skipped, not errors.
 */
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

/**
 * Serialize the model into a deterministic CSS body: buckets widest bound
 * FIRST (narrower ranges later in source so they win the desktop-down
 * cascade), node ids and properties sorted alphabetically.
 */
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
      rules.push(
        `  [data-agent-native-node-id="${escAttr(nodeId)}"] {\n` +
          `${lines.join("\n")}\n` +
          `  }`,
      );
    }
    if (rules.length === 0) continue;
    blocks.push(
      `@media (max-width: ${maxWidthPx}px) {\n${rules.join("\n")}\n}`,
    );
  }
  return blocks.join("\n\n");
}

// ─── High-level document operations ──────────────────────────────────────────

/**
 * Set (or overwrite) one managed declaration for a node at a max-width
 * scope, returning the updated HTML. Throws on unsafe property/value — the
 * caller decides how to surface that.
 */
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

/**
 * Remove one managed declaration (reset the property back to the base /
 * wider-scope value). Prunes empty rules, buckets, and — when nothing is
 * left — the whole managed block.
 */
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

/**
 * All managed declarations for one node (every bound), flattened and sorted
 * widest bound first. Pass `null` nodeId to list every declaration.
 */
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

// ─── Override state (inspector indicator contract) ───────────────────────────

/** One breakpoint override of a property, from either persistence layer. */
export interface BreakpointPropertyOverride {
  /** Inclusive upper viewport bound the override applies below. */
  maxWidthPx: number;
  /** Where the override persists. */
  source: "class" | "media";
  /** Utility token (class source) or CSS value (media source). */
  value: string;
}

/** Result of {@link getBreakpointOverrideState}. */
export interface BreakpointOverrideState {
  /** Every override of the property, widest bound first. */
  overrides: BreakpointPropertyOverride[];
  /** True when an override exists exactly at the active scope's bound. */
  overriddenAtActive: boolean;
  /**
   * The active scope's upper bound (from `breakpointUpperBoundPx`), or null
   * when the active frame is the widest context (base editing).
   */
  activeUpperBoundPx: number | null;
}

/**
 * EditPanel contract: per-property override indicators for the active
 * breakpoint. Aggregates BOTH persistence layers — max-width-scoped
 * responsive classes on the element and managed `@media` rules for its
 * node id.
 *
 * @param args.className    The element's class attribute value.
 * @param args.html         The screen HTML (for the managed media block).
 *                          Optional — omit to check classes only.
 * @param args.nodeId       The element's `data-agent-native-node-id`.
 * @param args.property     CSS property (camelCase or kebab-case).
 * @param args.breakpointWidths  Widths of the design's breakpoint frames.
 * @param args.baseWidthPx  The primary frame's width (base context).
 * @param args.activeWidthPx    The active breakpoint frame width, or null
 *                              when editing the base.
 */
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

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Escape a string for a CSS attribute selector value (`\` and `"`). */
function escAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescAttr(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * Find the content of the CSS block that starts just after position `start`
 * (just after the opening `{`). Returns `null` on unbalanced braces.
 */
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
