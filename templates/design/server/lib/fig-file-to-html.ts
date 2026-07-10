/**
 * Convert a decoded Figma document (NODE_CHANGES message) into one HTML
 * file per top-level frame. Each node renders as a <div> (or <span> for
 * TEXT) with an inline `style="..."` covering layout, background, border,
 * radius, shadows, blurs, text, transform, autolayout (flexbox), and
 * opacity/blend. Component instances are inlined and tagged with
 * data-component-name / data-variant-name / data-component-description /
 * data-component-doc-link / data-annotations attributes, matching the
 * figma-plugin smart-export conventions.
 */

import * as path from "node:path";

export interface Guid {
  sessionID: number;
  localID: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Paint {
  type?: string;
  color?: Color;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
  stops?: Array<{ color: Color; position: number }>;
  transform?: {
    m00: number;
    m01: number;
    m02: number;
    m10: number;
    m11: number;
    m12: number;
  };
  // hash may be a hex string (JSON-decoded) or raw bytes (kiwi-decoder).
  image?: { hash?: string | Uint8Array | number[]; name?: string };
  imageScaleMode?: string;
  rotation?: number;
  scale?: number;
}

interface Effect {
  type?: string;
  visible?: boolean;
  color?: Color;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
  blendMode?: string;
}

interface Annotation {
  label?: string;
  labelV2?: string;
  properties?: unknown[];
}

interface ComponentPropDef {
  id?: Guid;
  name?: string;
  type?: string;
}

export interface FigNode {
  guid?: Guid;
  // Library-stable identifier used by override paths (`symbolOverrides[].guidPath`)
  // and `derivedSymbolData[].guidPath`. When a node is a remix of a library
  // component, the `guid` is local to this document but `overrideKey` is the
  // GUID from the source library. Override-path matching MUST use this when
  // available so that overrides authored against the library still apply.
  overrideKey?: Guid;
  parentIndex?: { guid?: Guid; position?: string };
  type?: string;
  name?: string;
  description?: string;
  componentKey?: string;
  componentPropDefs?: ComponentPropDef[];
  componentPropAssignments?: unknown[];
  componentPropRefs?: unknown[];
  annotations?: Annotation[];
  isSymbolPublishable?: boolean;
  visible?: boolean;
  size?: { x: number; y: number };
  // Auto-layout min/max constraints. Either axis may be null when unconstrained.
  // A min-width keeps e.g. a single-digit count badge circular.
  minSize?: { value?: { x: number | null; y: number | null } };
  maxSize?: { value?: { x: number | null; y: number | null } };
  transform?: {
    m00: number;
    m01: number;
    m02: number;
    m10: number;
    m11: number;
    m12: number;
  };
  fillPaints?: Paint[];
  strokePaints?: Paint[];
  // Style references — when present, the actual paint comes from the
  // referenced shared-style node's fillPaints/strokePaints rather than the
  // stale `fillPaints`/`strokePaints` cached on this node.
  styleIdForFill?: {
    guid?: Guid;
    assetRef?: { key?: string; version?: string };
  };
  styleIdForStroke?: {
    guid?: Guid;
    assetRef?: { key?: string; version?: string };
  };
  styleIdForText?: {
    guid?: Guid;
    assetRef?: { key?: string; version?: string };
  };
  // Library style nodes carry their stable key here (matched against
  // `styleIdForFill.assetRef.key` etc. on the consuming nodes).
  key?: string;
  styleType?: string;
  strokeWeight?: number;
  strokeAlign?: string;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  effects?: Effect[];
  opacity?: number;
  blendMode?: string;
  cornerRadius?: number;
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;
  fontSize?: number;
  fontName?: { family?: string; style?: string };
  letterSpacing?: { value: number; units?: string };
  lineHeight?: { value: number; units?: string };
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textData?: { characters?: string };
  textAutoResize?: string;
  symbolData?: {
    symbolID?: Guid;
    symbolOverrides?: SymbolOverride[];
  };
  stackMode?: string;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  stackSpacing?: number;
  stackHorizontalPadding?: number;
  stackVerticalPadding?: number;
  stackPaddingLeft?: number;
  stackPaddingRight?: number;
  stackPaddingTop?: number;
  stackPaddingBottom?: number;
  stackPrimarySizing?: string;
  stackCounterSizing?: string;
  stackChildPrimaryGrow?: number;
  stackChildAlignSelf?: string;
  // "ABSOLUTE" marks a child that ignores its parent's auto-layout (Figma's
  // "ignore auto layout"): it is positioned by its own transform and removed
  // from the flex flow instead of stacking as a flex item.
  stackPositioning?: string;
  resizeToFit?: boolean;
  horizontalConstraint?: string;
  verticalConstraint?: string;
  frameMaskDisabled?: boolean;
  internalOnly?: boolean;
  // Vector geometry. Each path's `commandsBlob` is an index into the
  // document `blobs` array; the bytes there are a Figma path command
  // stream (see decodePathCommands).
  fillGeometry?: Array<{
    commandsBlob?: number;
    windingRule?: string;
    styleID?: number;
  }>;
  strokeGeometry?: Array<{
    commandsBlob?: number;
    windingRule?: string;
    styleID?: number;
  }>;
  strokeJoin?: string;
  strokeCap?: string;
  strokeDashes?: number[];
  vectorData?: {
    normalizedSize?: { x: number; y: number };
    vectorNetworkBlob?: number;
  };
  // Literal values are stale baked snapshots; resolveVariableBindings rewrites from here.
  variableConsumptionMap?: {
    entries?: Array<{
      variableField?: string;
      variableData?: { value?: VariableValue };
    }>;
  };
  // Which mode to resolve for each variable set; set may be referenced by assetRef.key or guid.
  variableModeBySetMap?: {
    entries?: Array<{
      variableSetID?: VariableSetRef;
      variableModeID?: Guid;
    }>;
  };
  // On VARIABLE_SET nodes: the modes this set defines (first is the default).
  variableSetModes?: Array<{ id?: Guid; name?: string }>;
  // On VARIABLE nodes: this variable's per-mode values and owning set.
  variableSetID?: VariableSetRef;
  variableDataValues?: {
    entries?: Array<{
      modeID?: Guid;
      variableData?: { value?: VariableValue };
    }>;
  };
}

// IS_TRUTHY(alias) expressions appear on VISIBLE bindings driven by variant props.
interface VariableValue {
  alias?: { guid?: Guid; assetRef?: { key?: string } };
  boolValue?: boolean;
  expressionValue?: {
    expressionFunction?: string;
    expressionArguments?: Array<{ value?: VariableValue }>;
  };
  [field: string]: unknown;
}

// A variable set is referenced either by its published `assetRef.key` or, for
// a set local to the document, by `guid`.
interface VariableSetRef {
  guid?: Guid;
  assetRef?: { key?: string };
}

/**
 * Names Figma assigns by default — when a layer keeps its placeholder name
 * we treat it as having no meaningful name (matches the figma-plugin's
 * smart-export `isDummyName`).
 */
/**
 * Split a Figma component master name into a base component name and a
 * variant suffix. Figma uses two conventions:
 *
 *  - Slash-separated: "ComponentName/VariantA/VariantB" — everything after
 *    the first slash is the variant name (this matches the plugin's
 *    smart-export behavior).
 *  - Variant-set children: a SYMBOL named like "Style=Action, Size=Large"
 *    is one variant inside a parent component-set FRAME. In that case the
 *    SYMBOL name IS the variant key/value list and the real component
 *    name is the parent FRAME's name (resolved separately by the caller).
 */
function isVariantSymbolName(name: string | undefined): boolean {
  if (!name) return false;
  // Variant SYMBOL naming: comma-separated `Key=Value` pairs.
  return /^[^/=]+=[^=]+(,\s*[^/=]+=[^=]+)*$/.test(name);
}

function splitComponentName(name: string | undefined): {
  base: string;
  variant: string | null;
} {
  if (!name) return { base: "", variant: null };
  if (isVariantSymbolName(name)) return { base: "", variant: name };
  const i = name.indexOf("/");
  if (i < 0) return { base: name, variant: null };
  return { base: name.slice(0, i), variant: name.slice(i + 1) };
}

/**
 * Resolve the canonical component name + variant string for a SYMBOL,
 * walking up to the parent component-set FRAME when the SYMBOL itself is
 * a variant child (e.g. "Style=Action" inside a "Right Element" FRAME).
 */
function resolveComponentIdentity(
  symbol: FigNode,
  ctx: Ctx,
): { base: string; variant: string | null } {
  const ident = splitComponentName(symbol.name);
  if (ident.base) return ident;
  // Variant SYMBOL — use the parent FRAME (component set) as the base name.
  const parentKey = guidKey(symbol.parentIndex?.guid);
  const parent = ctx.byGuid.get(parentKey);
  const parentName = parent?.name?.trim();
  if (parentName) {
    return { base: parentName, variant: ident.variant };
  }
  return { base: symbol.name ?? "", variant: null };
}

function htmlToPlain(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractDocLinks(html: string | undefined): string[] {
  if (!html) return [];
  const out: string[] = [];
  const re = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]!);
  return out;
}

export function guidKey(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "";
}

/**
 * Collect the raw Figma component-prop data on a node into a single object
 * suitable for stringifying into a `props="..."` attribute.
 *
 *  - SYMBOL nodes get their `componentPropDefs` (the prop schema)
 *  - INSTANCE nodes get the `componentPropAssignments` (overrides) plus any
 *    `componentPropRefs` (per-child wirings) and the master's defs for
 *    context.
 *  - Any node may have its own `componentPropRefs` (e.g. an inner layer
 *    bound to a parent component prop).
 */
function collectRawProps(
  node: FigNode,
  componentSymbol: FigNode | null,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const sym = componentSymbol ?? (node.type === "SYMBOL" ? node : null);
  if (sym?.componentPropDefs?.length) out.defs = sym.componentPropDefs;
  if (
    node.componentPropAssignments &&
    (node.componentPropAssignments as unknown[]).length
  )
    out.assignments = node.componentPropAssignments;
  if (node.componentPropRefs && (node.componentPropRefs as unknown[]).length)
    out.refs = node.componentPropRefs;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * A resolved Figma component prop value, normalized across the (legacy)
 * `value` and (modern) `varValue` shapes. Only the fields we actually act on
 * are extracted: bool (for VISIBLE), text (for TEXT_DATA), and guid (for
 * OVERRIDDEN_SYMBOL_ID and SLOT_CONTENT_ID).
 */
interface ResolvedPropValue {
  bool?: boolean;
  text?: string;
  guid?: Guid;
}

function resolvePropAssignment(a: unknown): ResolvedPropValue | null {
  const ax = a as {
    value?: {
      boolValue?: boolean;
      textValue?: { characters?: string };
      guidValue?: Guid;
    };
    varValue?: {
      value?: {
        boolValue?: boolean;
        textValue?: { characters?: string };
        guidValue?: Guid;
        symbolIdValue?: { guid?: Guid };
        textIdValue?: { value?: string };
      };
    };
  };
  const vv = ax.varValue?.value;
  const v = ax.value;
  const out: ResolvedPropValue = {};
  if (typeof vv?.boolValue === "boolean") out.bool = vv.boolValue;
  else if (typeof v?.boolValue === "boolean") out.bool = v.boolValue;
  if (vv?.textValue?.characters !== undefined)
    out.text = vv.textValue.characters;
  else if (v?.textValue?.characters !== undefined)
    out.text = v.textValue.characters;
  else if (vv?.textIdValue?.value !== undefined)
    out.text = vv.textIdValue.value;
  if (vv?.symbolIdValue?.guid) out.guid = vv.symbolIdValue.guid;
  else if (vv?.guidValue) out.guid = vv.guidValue;
  else if (v?.guidValue) out.guid = v.guidValue;
  return Object.keys(out).length > 0 ? out : null;
}

function buildPropEnv(
  node: FigNode,
  inherited: Map<string, ResolvedPropValue>,
): Map<string, ResolvedPropValue> {
  const assignments = (node.componentPropAssignments ?? []) as Array<{
    defID?: Guid;
  }>;
  if (assignments.length === 0) return inherited;
  const next = new Map(inherited);
  for (const a of assignments) {
    const key = guidKey(a.defID);
    if (!key) continue;
    const resolved = resolvePropAssignment(a);
    if (resolved) next.set(key, resolved);
  }
  return next;
}

/**
 * Apply parent-instance prop overrides to a node. Returns either the same
 * node (no overrides), a shallow-cloned node with `textData` / `symbolData`
 * patched, or `null` to indicate the node should be hidden by a VISIBLE
 * prop ref resolving to false.
 */
function applyPropRefs(
  node: FigNode,
  env: Map<string, ResolvedPropValue>,
): FigNode | null {
  const refs = (node.componentPropRefs ?? []) as Array<{
    defID?: Guid;
    componentPropNodeField?: string;
  }>;
  if (refs.length === 0 || env.size === 0) return node;
  let patched = node;
  for (const ref of refs) {
    const v = env.get(guidKey(ref.defID));
    if (!v) continue;
    const field = ref.componentPropNodeField;
    if (field === "VISIBLE" && v.bool === false) return null;
    if (field === "TEXT_DATA" && v.text !== undefined) {
      patched = {
        ...patched,
        textData: { ...(patched.textData ?? {}), characters: v.text },
      };
    }
    if (field === "OVERRIDDEN_SYMBOL_ID" && v.guid) {
      patched = {
        ...patched,
        symbolData: { ...(patched.symbolData ?? {}), symbolID: v.guid },
      };
    }
  }
  return patched;
}

/**
 * A raw symbol override entry from `symbolData.symbolOverrides`. It is
 * effectively a partial NodeChange targeting a descendant of the master
 * symbol via `guidPath`. Any field present (other than `guidPath` and
 * `overriddenSymbolID`) is shallow-merged onto the descendant node when
 * it's emitted, so layout-affecting overrides like `size`, `textAutoResize`,
 * `stackChildAlignSelf`, `stackCounterSizing`, `textAlignVertical`, etc.
 * all flow through.
 */
interface SymbolOverride extends Partial<FigNode> {
  overriddenSymbolID?: Guid;
  guidPath?: { guids?: Guid[] };
}

type OverrideEntry = SymbolOverride;

/**
 * An active override scope contributed by an enclosing INSTANCE. `startIndex`
 * is the position in the running guid path at which this instance's master
 * tree begins; override keys in `map` are joined-guid paths RELATIVE to that
 * point (matching what Figma stores in `symbolOverrides[].guidPath`).
 *
 * Multiple layers stack: an outer instance's overrides remain valid even
 * after we descend through nested inner instances, because the descendant's
 * absolute path under the outer instance is still well-defined.
 */
interface OverrideLayer {
  startIndex: number;
  map: Map<string, OverrideEntry>;
}

function buildSymbolOverrideLayer(node: FigNode): Map<string, OverrideEntry> {
  const out = new Map<string, OverrideEntry>();
  for (const o of node.symbolData?.symbolOverrides ?? []) {
    const guids = o.guidPath?.guids ?? [];
    if (guids.length === 0) continue;
    const key = guids.map((g) => guidKey(g)).join("/");
    // Multiple override entries can share the same guidPath (e.g. one with
    // `overriddenSymbolID` for a variant swap and another with layout
    // tweaks). Merge them so neither is lost.
    const existing = out.get(key);
    if (existing) {
      out.set(key, { ...existing, ...o });
    } else {
      out.set(key, o);
    }
  }
  // `derivedSymbolData` carries pre-computed geometry / text layout for
  // descendants of this instance whose actual definition lives in a remote
  // library (so the local document has only a stub master). Each entry is
  // keyed by a guidPath into the library tree — same coordinate space as
  // `symbolOverrides[].guidPath` — so we can fold them into the same layer.
  // Only fill/stroke geometry are merged; positional fields (`transform`,
  // `size`) and `derivedTextData` are intentionally skipped because they
  // describe library-resolved layout that would overwrite the (already
  // correct) values cached on the local master node.
  for (const d of (
    node as {
      derivedSymbolData?: Array<
        Partial<FigNode> & { guidPath?: { guids?: Guid[] } }
      >;
    }
  ).derivedSymbolData ?? []) {
    const guids = d.guidPath?.guids ?? [];
    if (guids.length === 0) continue;
    if (!d.fillGeometry?.length && !d.strokeGeometry?.length) continue;
    const key = guids.map((g) => guidKey(g)).join("/");
    const patch: SymbolOverride = {};
    if (d.fillGeometry?.length) patch.fillGeometry = d.fillGeometry;
    if (d.strokeGeometry?.length) patch.strokeGeometry = d.strokeGeometry;
    const existing = out.get(key);
    out.set(key, existing ? { ...existing, ...patch } : patch);
  }
  return out;
}

/**
 * Apply any matching override entry from the active override layers to a
 * node about to be emitted. Returns `null` if the node is hidden by an
 * override; otherwise returns the (possibly patched) node.
 */
function applyOverrideLayers(
  node: FigNode,
  layers: OverrideLayer[],
  instancePath: string[],
): FigNode | null {
  if (layers.length === 0) return node;
  // The lookup key for THIS node within a layer is the chain of inner
  // INSTANCE overrideKeys we've descended into since that layer was pushed,
  // followed by this node's own overrideKey. Override paths only grow at
  // INSTANCE boundaries — descending through plain frames/groups within the
  // same master keeps the path the same length.
  const nodeKey = guidKey(node.overrideKey ?? node.guid);
  if (!nodeKey) return node;
  for (const layer of layers) {
    const prefix = instancePath.slice(layer.startIndex);
    const relKey =
      prefix.length > 0 ? `${prefix.join("/")}/${nodeKey}` : nodeKey;
    const entry = layer.map.get(relKey);
    if (!entry) continue;
    if (entry.visible === false) return null;
    // Shallow-merge every field present on the override (except the
    // routing fields and `overriddenSymbolID`, which goes into symbolData).
    // This applies layout overrides like `size`, `textAutoResize`,
    // `stackChildAlignSelf`, `stackCounterSizing`, `textAlignVertical`,
    // styling fields, etc., in addition to text/visibility.
    const merged: FigNode = { ...node };
    for (const [field, value] of Object.entries(entry)) {
      if (field === "guidPath" || field === "overriddenSymbolID") continue;
      if (value === undefined) continue;
      (merged as Record<string, unknown>)[field] = value;
    }
    if (entry.overriddenSymbolID) {
      merged.symbolData = {
        ...(merged.symbolData ?? {}),
        symbolID: entry.overriddenSymbolID,
      };
    }
    node = merged;
  }
  return node;
}

function sanitizeFilename(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/\n/g, "&#10;");
}

function kebabCase(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function colorToCss(c: Color | undefined, alphaMul = 1): string | null {
  if (!c) return null;
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  const a = c.a * alphaMul;
  if (a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

function num(n: number | null | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function tagFor(type: string | undefined): string {
  // Everything renders as a real DOM tag rather than a synthetic component.
  // TEXT becomes <span> so it inlines nicely; everything else is <div>.
  if (type === "TEXT") return "span";
  return "div";
}

const STACK_ALIGN: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  BASELINE: "baseline",
  SPACE_BETWEEN: "space-between",
};

const TEXT_ALIGN: Record<string, string> = {
  LEFT: "left",
  CENTER: "center",
  RIGHT: "right",
  JUSTIFIED: "justify",
};

function fontWeightFromStyle(style: string | undefined): number | null {
  if (!style) return null;
  const s = style.toLowerCase();
  if (s.includes("thin")) return 100;
  if (s.includes("extralight") || s.includes("ultralight")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("regular") || s === "normal") return 400;
  if (s.includes("medium")) return 500;
  if (s.includes("semibold") || s.includes("demibold")) return 600;
  if (s.includes("extrabold") || s.includes("ultrabold")) return 800;
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("bold")) return 700;
  return null;
}

function lengthFromUnits(
  v: { value: number; units?: string } | undefined,
  fontSize?: number,
) {
  if (!v) return null;
  if (v.units === "PIXELS") return `${num(v.value)}px`;
  if (v.units === "PERCENT") {
    if (fontSize) return `${num((v.value / 100) * fontSize)}px`;
    return `${num(v.value)}%`;
  }
  if (v.units === "RAW") return num(v.value);
  return num(v.value);
}

/**
 * Normalize a Figma image hash into a hex string. The kiwi decoder emits
 * the hash as a Uint8Array / number[]; the JSON-roundtripped form is
 * already a hex string.
 */
function hashToHex(
  h: string | Uint8Array | number[] | undefined,
): string | null {
  if (!h) return null;
  if (typeof h === "string") return h;
  const arr = h instanceof Uint8Array ? Array.from(h) : (h as number[]);
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Resolve an image hash to a usable URL path. Looks up the actual filename
 * (which may be `<hash>` or `<hash>.png` depending on whether the source
 * was a zip-format or kiwi-format `.fig`) in the ctx imageMap.
 */
function imageUrl(hashHex: string, ctx: Ctx): string {
  const resolved = ctx.imageMap.get(hashHex);
  if (!resolved && ctx.missingImageUrl) return ctx.missingImageUrl;
  const filename = resolved ?? hashHex;
  if (/^(?:https?:|blob:|about:)/i.test(filename)) return filename;
  const base = ctx.imageRefBase ?? "images";
  return `${base}/${filename}`;
}

/**
 * Resolve a style reference (`styleIdForFill` / `styleIdForStroke` /
 * `styleIdForText`) to the actual style node. Style refs come in two
 * flavors: a local `guid` for in-document styles and an `assetRef.key`
 * for library styles. Library style definitions get embedded in the
 * document under the same `key`, so we look them up via `ctx.byKey`.
 */
function resolveStyleNode(
  ref: { guid?: Guid; assetRef?: { key?: string } } | undefined,
  ctx: Ctx,
): FigNode | undefined {
  if (!ref) return undefined;
  if (ref.guid) {
    const n = ctx.byGuid.get(guidKey(ref.guid));
    if (n) return n;
  }
  if (ref.assetRef?.key) {
    const n = ctx.byKey.get(ref.assetRef.key);
    if (n) return n;
  }
  return undefined;
}

/**
 * Resolve the effective fill paints for a node. When the node references a
 * shared FILL style via `styleIdForFill`, the cached `fillPaints` baked
 * into the node may be stale (the design token's actual color can have
 * changed since). Prefer the style node's `fillPaints` whenever a fill
 * style reference is present.
 *
 * Do NOT fall back to `styleIdForText` here: a text style carries
 * typography (font/size/weight/line-height) and its `fillPaints` is just
 * the swatch color used for the style's preview glyphs ("Ag") — typically
 * black regardless of where the style is actually applied. The text node's
 * own `fillPaints` is the source of truth for color.
 */
function effectiveFillPaints(node: FigNode, ctx: Ctx): Paint[] | undefined {
  const style = resolveStyleNode(node.styleIdForFill, ctx);
  if (style?.fillPaints?.length) return style.fillPaints;
  return node.fillPaints;
}

function effectiveStrokePaints(node: FigNode, ctx: Ctx): Paint[] | undefined {
  const style = resolveStyleNode(node.styleIdForStroke, ctx);
  if (style?.fillPaints?.length) return style.fillPaints;
  if (style?.strokePaints?.length) return style.strokePaints;
  return node.strokePaints;
}

function paintToBackground(p: Paint, _node: FigNode, ctx: Ctx): string | null {
  if (p.visible === false) return null;
  if (p.type === "SOLID") return colorToCss(p.color, p.opacity ?? 1);
  if (p.type?.startsWith("GRADIENT") && Array.isArray(p.stops)) {
    const stops = p.stops
      .map(
        (s) =>
          `${colorToCss(s.color, p.opacity ?? 1)} ${num(s.position * 100)}%`,
      )
      .join(", ");
    if (p.type === "GRADIENT_LINEAR") return `linear-gradient(${stops})`;
    if (p.type === "GRADIENT_RADIAL") return `radial-gradient(${stops})`;
    if (p.type === "GRADIENT_ANGULAR") return `conic-gradient(${stops})`;
    if (p.type === "GRADIENT_DIAMOND") return `radial-gradient(${stops})`;
  }
  if (p.type === "IMAGE") {
    const hex = hashToHex(p.image?.hash);
    if (hex) return `url("${imageUrl(hex, ctx)}")`;
  }
  return null;
}

function backgroundShorthand(
  node: FigNode,
  ctx: Ctx,
): {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
} {
  const fills = (effectiveFillPaints(node, ctx) ?? []).filter(
    (f) => f.visible !== false,
  );
  if (fills.length === 0) return {};
  const result: {
    backgroundColor?: string;
    backgroundImage?: string;
    backgroundSize?: string;
    backgroundPosition?: string;
    backgroundRepeat?: string;
  } = {};
  const bgImages: string[] = [];
  for (const f of fills) {
    if (f.type === "SOLID" && !result.backgroundColor) {
      const c = colorToCss(f.color, f.opacity ?? 1);
      if (c) result.backgroundColor = c;
      continue;
    }
    const v = paintToBackground(f, node, ctx);
    if (v) bgImages.push(v);
    if (f.type === "IMAGE") {
      if (f.imageScaleMode === "FILL") result.backgroundSize = "cover";
      else if (f.imageScaleMode === "FIT") result.backgroundSize = "contain";
      else if (f.imageScaleMode === "TILE") {
        result.backgroundSize = "auto";
        result.backgroundRepeat = "repeat";
      } else if (f.imageScaleMode === "STRETCH")
        result.backgroundSize = "100% 100%";
      // Figma centers image fills by default (CSS defaults to top-left, which
      // crops the wrong edges for FILL/FIT). TILE keeps the default origin so
      // the tile pattern starts at top-left.
      if (f.imageScaleMode !== "TILE") result.backgroundPosition = "center";
    }
  }
  if (bgImages.length > 0) result.backgroundImage = bgImages.join(", ");
  return result;
}

function borderShorthand(node: FigNode, ctx: Ctx): Record<string, string> {
  const strokes = (effectiveStrokePaints(node, ctx) ?? []).filter(
    (p) => p.visible !== false,
  );
  if (strokes.length === 0) return {};
  const first = strokes[0]!;
  const color = colorToCss(first.color, first.opacity ?? 1) ?? "rgb(0, 0, 0)";

  const hasPerSide =
    node.strokeTopWeight !== undefined ||
    node.strokeRightWeight !== undefined ||
    node.strokeBottomWeight !== undefined ||
    node.strokeLeftWeight !== undefined;

  const uniformW = node.strokeWeight ?? 0;

  if (!hasPerSide) {
    if (!uniformW) return {};
    if (node.strokeAlign === "OUTSIDE") {
      return { outline: `${num(uniformW)}px solid ${color}` };
    }
    if (node.strokeAlign === "INSIDE") {
      // box-shadow keeps the border inside the element without expanding its dimensions
      return { boxShadow: `inset 0 0 0 ${num(uniformW)}px ${color}` };
    }
    return { border: `${num(uniformW)}px solid ${color}` };
  }

  // Per-side stroke weights: fall back to uniformW for unspecified sides
  const topW = node.strokeTopWeight ?? uniformW;
  const rightW = node.strokeRightWeight ?? uniformW;
  const bottomW = node.strokeBottomWeight ?? uniformW;
  const leftW = node.strokeLeftWeight ?? uniformW;

  if (!topW && !rightW && !bottomW && !leftW) return {};

  const result: Record<string, string> = {};

  if (node.strokeAlign === "INSIDE") {
    // Use border-side + border-box so the border stays within Figma's stated dimensions.
    // For absolute children this is only exact when there's no top or left border
    // (the common case for Fluent UI's active bottom border).
    if (topW) result.borderTop = `${num(topW)}px solid ${color}`;
    if (rightW) result.borderRight = `${num(rightW)}px solid ${color}`;
    if (bottomW) result.borderBottom = `${num(bottomW)}px solid ${color}`;
    if (leftW) result.borderLeft = `${num(leftW)}px solid ${color}`;
    result.boxSizing = "border-box";
    return result;
  }

  if (node.strokeAlign === "OUTSIDE") {
    // outline doesn't support per-side; simulate with box-shadow (no inset)
    const shadows: string[] = [];
    if (topW) shadows.push(`0 -${num(topW)}px 0 0 ${color}`);
    if (rightW) shadows.push(`${num(rightW)}px 0 0 0 ${color}`);
    if (bottomW) shadows.push(`0 ${num(bottomW)}px 0 0 ${color}`);
    if (leftW) shadows.push(`-${num(leftW)}px 0 0 0 ${color}`);
    return shadows.length ? { boxShadow: shadows.join(", ") } : {};
  }

  // CENTER: individual border-side properties
  if (topW) result.borderTop = `${num(topW)}px solid ${color}`;
  if (rightW) result.borderRight = `${num(rightW)}px solid ${color}`;
  if (bottomW) result.borderBottom = `${num(bottomW)}px solid ${color}`;
  if (leftW) result.borderLeft = `${num(leftW)}px solid ${color}`;
  return result;
}

function radiusStyles(node: FigNode): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const corners = [
    node.rectangleTopLeftCornerRadius,
    node.rectangleTopRightCornerRadius,
    node.rectangleBottomRightCornerRadius,
    node.rectangleBottomLeftCornerRadius,
  ];
  const allEqual =
    corners.every((c) => c === corners[0]) &&
    typeof corners[0] === "number" &&
    corners[0] > 0;
  if (allEqual) {
    out.borderRadius = `${num(corners[0])}px`;
    return out;
  }
  if (corners.some((c) => typeof c === "number" && c > 0)) {
    out.borderTopLeftRadius = `${num(corners[0] ?? 0)}px`;
    out.borderTopRightRadius = `${num(corners[1] ?? 0)}px`;
    out.borderBottomRightRadius = `${num(corners[2] ?? 0)}px`;
    out.borderBottomLeftRadius = `${num(corners[3] ?? 0)}px`;
    return out;
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    out.borderRadius = `${num(node.cornerRadius)}px`;
  }
  if (node.type === "ELLIPSE") out.borderRadius = "50%";
  return out;
}

/**
 * @param shadowAsFilter Render DROP_SHADOWs as `filter: drop-shadow()` instead
 *   of `box-shadow`. `box-shadow` traces the element's box, so an overflowing
 *   child (e.g. a tooltip's caret) is left shadowless and the box shadow cuts
 *   straight across behind it. `filter: drop-shadow()` follows the element's
 *   rendered alpha — body plus caret — at the cost of the (here unused) spread.
 */
function effectStyles(
  node: FigNode,
  shadowAsFilter = false,
): Record<string, string> {
  const effects = node.effects?.filter((e) => e.visible !== false) ?? [];
  if (effects.length === 0) return {};
  const shadows: string[] = [];
  const filters: string[] = [];
  let backdropBlur: string | null = null;
  for (const e of effects) {
    if (e.type === "DROP_SHADOW") {
      const c = colorToCss(e.color) ?? "rgba(0, 0, 0, 0.25)";
      if (shadowAsFilter) {
        filters.push(
          `drop-shadow(${num(e.offset?.x ?? 0)}px ${num(e.offset?.y ?? 0)}px ${num(e.radius ?? 0)}px ${c})`,
        );
      } else {
        shadows.push(
          `${num(e.offset?.x ?? 0)}px ${num(e.offset?.y ?? 0)}px ${num(e.radius ?? 0)}px ${num(e.spread ?? 0)}px ${c}`,
        );
      }
    } else if (e.type === "INNER_SHADOW") {
      // Inner shadows have no filter equivalent; always emit as box-shadow.
      const c = colorToCss(e.color) ?? "rgba(0, 0, 0, 0.25)";
      shadows.push(
        `inset ${num(e.offset?.x ?? 0)}px ${num(e.offset?.y ?? 0)}px ${num(e.radius ?? 0)}px ${num(e.spread ?? 0)}px ${c}`,
      );
    } else if (e.type === "FOREGROUND_BLUR" || e.type === "LAYER_BLUR") {
      filters.push(`blur(${num(e.radius ?? 0)}px)`);
    } else if (e.type === "BACKGROUND_BLUR") {
      backdropBlur = `blur(${num(e.radius ?? 0)}px)`;
    }
  }
  const out: Record<string, string> = {};
  if (shadows.length) out.boxShadow = shadows.join(", ");
  if (filters.length) out.filter = filters.join(" ");
  if (backdropBlur) out.backdropFilter = backdropBlur;
  return out;
}

function transformStyle(node: FigNode): {
  transform?: string;
  transformOrigin?: string;
} {
  const t = node.transform;
  if (!t) return {};
  // Decompose: rotation = atan2(m10, m00), scale assumed 1.
  const angle = Math.atan2(t.m10, t.m00);
  const deg = (angle * 180) / Math.PI;
  if (Math.abs(deg) < 0.01) return {};
  return { transform: `rotate(${num(deg)}deg)`, transformOrigin: "top left" };
}

function autolayoutStyles(node: FigNode): Record<string, string | number> {
  if (!node.stackMode || node.stackMode === "NONE") return {};
  const out: Record<string, string | number> = {
    display: "flex",
    flexDirection: node.stackMode === "VERTICAL" ? "column" : "row",
  };
  if (node.stackPrimaryAlignItems)
    out.justifyContent =
      STACK_ALIGN[node.stackPrimaryAlignItems] ?? "flex-start";
  if (node.stackCounterAlignItems)
    out.alignItems = STACK_ALIGN[node.stackCounterAlignItems] ?? "flex-start";
  if (typeof node.stackSpacing === "number")
    out.gap = `${num(node.stackSpacing)}px`;
  // Padding: prefer per-side; fall back to horizontal/vertical.
  const pl = node.stackPaddingLeft ?? node.stackHorizontalPadding;
  const pr = node.stackPaddingRight ?? node.stackHorizontalPadding;
  const pt = node.stackPaddingTop ?? node.stackVerticalPadding;
  const pb = node.stackPaddingBottom ?? node.stackVerticalPadding;
  if ([pl, pr, pt, pb].some((v) => typeof v === "number" && v !== 0)) {
    out.padding = `${num(pt ?? 0)}px ${num(pr ?? 0)}px ${num(pb ?? 0)}px ${num(pl ?? 0)}px`;
  }
  return out;
}

function textStyles(node: FigNode, ctx?: Ctx): Record<string, string | number> {
  if (node.type !== "TEXT") return {};
  const out: Record<string, string | number> = {};
  // A TEXT node may reference a shared text style (`styleIdForText`) whose
  // font properties (family, weight, size, line-height, letter-spacing,
  // alignment) override the values cached on the node itself. The cached
  // values are often stale snapshots of the master and don't reflect the
  // current style — prefer the style node when present.
  const styleNode = ctx
    ? resolveStyleNode(node.styleIdForText, ctx)
    : undefined;
  const fontName = styleNode?.fontName ?? node.fontName;
  const fontSize =
    typeof styleNode?.fontSize === "number"
      ? styleNode.fontSize
      : node.fontSize;
  const lineHeight = styleNode?.lineHeight ?? node.lineHeight;
  const letterSpacing = styleNode?.letterSpacing ?? node.letterSpacing;
  const textAlignHorizontal =
    styleNode?.textAlignHorizontal ?? node.textAlignHorizontal;

  if (fontName?.family) {
    // Quote families with spaces so the inline style stays valid.
    const fam = fontName.family;
    out.fontFamily = /\s/.test(fam) ? `"${fam}"` : fam;
  }
  const weight = fontWeightFromStyle(fontName?.style);
  if (weight !== null) out.fontWeight = weight;
  // Track this family/weight/italic combo so the frame template can request
  // it from Google Fonts in <head>.
  if (ctx && fontName?.family) {
    const italic = !!(fontName.style && /italic|oblique/i.test(fontName.style));
    ctx.fontUsage.add(`${fontName.family}|${weight ?? 400}|${italic ? 1 : 0}`);
  }
  if (fontName?.style && /italic|oblique/i.test(fontName.style)) {
    out.fontStyle = "italic";
  }
  if (typeof fontSize === "number") out.fontSize = `${num(fontSize)}px`;
  const lh = lengthFromUnits(lineHeight, fontSize);
  if (lh !== null && lh !== undefined) out.lineHeight = lh;
  const ls = lengthFromUnits(letterSpacing, fontSize);
  if (ls !== null && ls !== undefined) out.letterSpacing = ls;
  if (textAlignHorizontal)
    out.textAlign = TEXT_ALIGN[textAlignHorizontal] ?? "left";
  // Text color comes from the first SOLID fill paint, dereferenced through
  // any `styleIdForFill` shared style (NOT `styleIdForText`, which is
  // typography-only — see `effectiveFillPaints`).
  if (ctx) {
    const solidFill = effectiveFillPaints(node, ctx)?.find(
      (f) => f.visible !== false && f.type === "SOLID",
    );
    if (solidFill) {
      const c = colorToCss(solidFill.color, solidFill.opacity ?? 1);
      if (c) out.color = c;
    }
  }
  return out;
}

function blendModeCss(mode: string | undefined): string | null {
  if (!mode || mode === "NORMAL" || mode === "PASS_THROUGH") return null;
  return mode.toLowerCase().replace(/_/g, "-");
}

function isAutolayout(parent: FigNode | null): boolean {
  return !!(parent && parent.stackMode && parent.stackMode !== "NONE");
}

/**
 * Compose an INSTANCE node with its inlined master's autolayout / padding /
 * sizing properties. The master is the source of truth for how children are
 * arranged; the instance's cached `stack*` fields can be a stale snapshot of
 * a previous variant. Per-axis sizing (`size`) stays on the instance — only
 * the layout description is taken from the master.
 */
function withMasterLayout(instance: FigNode, master: FigNode): FigNode {
  const layoutFields: (keyof FigNode)[] = [
    "stackMode",
    "stackPrimaryAlignItems",
    "stackCounterAlignItems",
    "stackSpacing",
    "stackPaddingLeft",
    "stackPaddingRight",
    "stackPaddingTop",
    "stackPaddingBottom",
    "stackHorizontalPadding",
    "stackVerticalPadding",
    "stackPrimarySizing",
    "stackCounterSizing",
  ];
  const merged: FigNode = { ...instance };
  // If the master defines its own stack direction, the instance's cached
  // stack-related fields are stale (they were captured against whatever
  // variant the instance originally pointed at). Take ALL layout fields
  // from the master wholesale — including `undefined` values — so we don't
  // leak e.g. `stackPrimarySizing="FIXED"` from a HORIZONTAL variant onto a
  // VERTICAL one whose master leaves it undefined (HUG).
  const masterDrivesLayout =
    typeof master.stackMode === "string" && master.stackMode !== "NONE";
  for (const f of layoutFields) {
    const mv = (master as Record<string, unknown>)[f as string];
    if (masterDrivesLayout) {
      (merged as Record<string, unknown>)[f as string] = mv;
    } else if (mv !== undefined) {
      (merged as Record<string, unknown>)[f as string] = mv;
    }
  }
  return merged;
}

/**
 * Derive the Figma plugin API's `layoutSizingHorizontal` / `layoutSizingVertical`
 * for a node. The kiwi document doesn't store these directly — they're
 * computed from the underlying stack/sizing/grow fields the same way
 * `figma.currentPage.selection[i].layoutSizingHorizontal` is.
 *
 * Returns "FIXED" | "HUG" | "FILL" per axis. The cached `node.size` always
 * carries a baked pixel value, so callers must consult the derived sizing
 * before deciding whether to emit an explicit `width`/`height`.
 */
function layoutSizing(
  node: FigNode,
  parent: FigNode | null,
): {
  horizontal: "FIXED" | "HUG" | "FILL";
  vertical: "FIXED" | "HUG" | "FILL";
} {
  let horizontal: "FIXED" | "HUG" | "FILL" = "FIXED";
  let vertical: "FIXED" | "HUG" | "FILL" = "FIXED";

  // 1) Self auto-layout (this node has its own stack). Kiwi default for an
  //    omitted `stackPrimarySizing`/`stackCounterSizing` is HUG, not FIXED.
  if (node.stackMode && node.stackMode !== "NONE") {
    // An omitted `stackPrimarySizing` is HUG (Figma writes it only when set,
    // and it's only ever written as FIXED). An omitted `stackCounterSizing`,
    // however, behaves as FIXED: Figma bakes the counter-axis size (a HUG
    // badge would collapse to its content height, but the design keeps its
    // fixed height). Treat only an explicit RESIZE_TO_FIT* as HUG.
    const primaryHug = (node.stackPrimarySizing ?? "RESIZE_TO_FIT") !== "FIXED";
    const counterHug = (node.stackCounterSizing ?? "FIXED") !== "FIXED";
    if (node.stackMode === "HORIZONTAL") {
      horizontal = primaryHug ? "HUG" : "FIXED";
      vertical = counterHug ? "HUG" : "FIXED";
    } else {
      vertical = primaryHug ? "HUG" : "FIXED";
      horizontal = counterHug ? "HUG" : "FIXED";
    }
  }

  // 2) Non-autolayout frames can still hug content via `resizeToFit`.
  if (!node.stackMode || node.stackMode === "NONE") {
    if (node.resizeToFit) {
      horizontal = "HUG";
      vertical = "HUG";
    }
  }

  // 3) TEXT auto-resize hugs along the indicated axis/axes.
  if (node.type === "TEXT" && node.textAutoResize) {
    if (node.textAutoResize === "WIDTH_AND_HEIGHT") {
      horizontal = "HUG";
      vertical = "HUG";
    } else if (node.textAutoResize === "HEIGHT") {
      vertical = "HUG";
    }
  }

  // 4) Auto-layout child of an auto-layout parent: grow/stretch -> FILL.
  //    A child that ignores auto-layout (stackPositioning ABSOLUTE) is not a
  //    flex item, so it keeps its FIXED pixel size from `node.size`.
  if (
    parent &&
    parent.stackMode &&
    parent.stackMode !== "NONE" &&
    node.stackPositioning !== "ABSOLUTE"
  ) {
    const grow = (node.stackChildPrimaryGrow ?? 0) > 0;
    const stretch = node.stackChildAlignSelf === "STRETCH";
    if (parent.stackMode === "HORIZONTAL") {
      if (grow) horizontal = "FILL";
      if (stretch) vertical = "FILL";
    } else {
      if (grow) vertical = "FILL";
      if (stretch) horizontal = "FILL";
    }
  }

  return { horizontal, vertical };
}

/**
 * Pin an absolutely-positioned node to the edge(s) implied by its Figma
 * constraint on one axis. MIN keeps the start offset (top/left); MAX anchors
 * to the end edge (bottom/right) so the node stays put when the container is
 * taller/wider than Figma's baked size; STRETCH pins both edges and returns
 * `true` to drop the fixed size on that axis. CENTER/SCALE fall back to the
 * baked start offset. Anchoring to the end edge needs the parent's size; when
 * it's unknown we fall back to the start offset. Returns whether the axis's
 * fixed width/height should be suppressed.
 */
function applyAxisConstraint(
  css: Record<string, unknown>,
  constraint: string | undefined,
  pos: number | null,
  nodeSize: number | null,
  parentSize: number | null,
  startProp: "left" | "top",
  endProp: "right" | "bottom",
): boolean {
  const endVal =
    pos !== null && nodeSize !== null && parentSize !== null
      ? parentSize - (pos + nodeSize)
      : null;
  if (constraint === "MAX" && endVal !== null) {
    css[endProp] = `${endVal}px`;
    return false;
  }
  if (constraint === "STRETCH" && endVal !== null) {
    if (pos !== null) css[startProp] = `${pos}px`;
    css[endProp] = `${endVal}px`;
    return true;
  }
  if (pos !== null) css[startProp] = `${pos}px`;
  return false;
}

function buildCss(
  node: FigNode,
  parent: FigNode | null,
  ctx: Ctx,
  isPositioned: boolean,
  vectorLike = false,
  hasAbsoluteChild = false,
  shadowAsFilter = false,
): Record<string, unknown> {
  const css: Record<string, unknown> = {};
  // An absolutely-positioned node is out of the parent's flex flow, so it must
  // not receive flex-child hints (flex-grow / align-self) below.
  const parentFlex = !isPositioned && isAutolayout(parent);

  // Position / size — mirrors smart-export:
  //   parent is auto-layout  -> position: relative, no left/top, dimensions
  //                             may be replaced by flex hints below.
  //   parent is not          -> position: absolute with left/top/width/height.
  // Constraints decide which edges an absolutely-positioned node is pinned to.
  // STRETCH pins both edges (and drops the fixed size on that axis).
  let suppressWidth = false;
  let suppressHeight = false;
  if (isPositioned) {
    css.position = "absolute";
    const x = node.transform ? num(node.transform.m02) : null;
    const y = node.transform ? num(node.transform.m12) : null;
    const nodeW = node.size ? num(node.size.x) : null;
    const nodeH = node.size ? num(node.size.y) : null;
    const parentW = parent?.size ? num(parent.size.x) : null;
    const parentH = parent?.size ? num(parent.size.y) : null;
    suppressWidth = applyAxisConstraint(
      css,
      node.horizontalConstraint,
      x,
      nodeW,
      parentW,
      "left",
      "right",
    );
    suppressHeight = applyAxisConstraint(
      css,
      node.verticalConstraint,
      y,
      nodeH,
      parentH,
      "top",
      "bottom",
    );
  } else if (parentFlex) {
    css.position = "relative";
  } else if (hasAbsoluteChild) {
    // Establish a positioning context so an "ignore auto layout" child
    // (position: absolute) is offset relative to this container rather than
    // the page. Top-level frames are otherwise statically positioned.
    css.position = "relative";
  }

  // Decide whether to emit width/height. The Figma plugin API exposes a
  // unified `layoutSizingHorizontal`/`layoutSizingVertical` derived from the
  // raw stack/grow/textAutoResize fields (kiwi doesn't store those derived
  // values). Only emit a pixel dimension on a FIXED axis — HUG and FILL both
  // mean "let CSS size it" via flex / intrinsic content.
  const sizing = layoutSizing(node, parent);
  const emitWidth = sizing.horizontal === "FIXED";
  const emitHeight = sizing.vertical === "FIXED";

  if (node.size) {
    const w = num(node.size.x);
    const h = num(node.size.y);
    if (w !== null && emitWidth && !suppressWidth) css.width = `${w}px`;
    if (h !== null && emitHeight && !suppressHeight) css.height = `${h}px`;
  }

  // Auto-layout min/max size constraints. Each axis is independent and may be
  // unconstrained (null). Only emit positive values — a zero constraint is a
  // no-op and a min-width keeps a hugging container (e.g. a badge) circular.
  const minX = num(node.minSize?.value?.x);
  const minY = num(node.minSize?.value?.y);
  const maxX = num(node.maxSize?.value?.x);
  const maxY = num(node.maxSize?.value?.y);
  if (minX !== null && minX > 0) css.minWidth = `${minX}px`;
  if (minY !== null && minY > 0) css.minHeight = `${minY}px`;
  if (maxX !== null && maxX > 0) css.maxWidth = `${maxX}px`;
  if (maxY !== null && maxY > 0) css.maxHeight = `${maxY}px`;

  // Auto-layout child hints (flex-grow / align-self). Skipped for children
  // that ignore auto-layout — they're positioned absolutely, not as flex items.
  if (parentFlex && node.stackPositioning !== "ABSOLUTE") {
    if ((node.stackChildPrimaryGrow ?? 0) > 0) {
      css.flex = "1 0 0";
    }
    if (node.stackChildAlignSelf) {
      const a = STACK_ALIGN[node.stackChildAlignSelf];
      if (a)
        css.alignSelf = node.stackChildAlignSelf === "STRETCH" ? "stretch" : a;
      else if (node.stackChildAlignSelf === "STRETCH")
        css.alignSelf = "stretch";
    }
  }

  // Background (TEXT uses fillPaints for color, not background; vector
  // nodes paint via <path fill> inside the <svg>).
  if (node.type !== "TEXT" && !vectorLike) {
    Object.assign(css, backgroundShorthand(node, ctx));
  }

  // Border / outline (skipped for vector nodes — strokes go on <path>).
  // Merge box-shadows from border (e.g. INSIDE strokes) and effects so neither overwrites the other.
  const borderStyle = !vectorLike ? borderShorthand(node, ctx) : {};
  const { boxShadow: borderBoxShadow, ...restBorderStyle } = borderStyle;
  Object.assign(css, restBorderStyle);
  // Radius
  Object.assign(css, radiusStyles(node));
  // Effects (shadows, blurs)
  const effectStyle = effectStyles(node, shadowAsFilter);
  const { boxShadow: effectBoxShadow, ...restEffectStyle } = effectStyle;
  Object.assign(css, restEffectStyle);
  const mergedBoxShadows = (
    [borderBoxShadow, effectBoxShadow] as Array<string | undefined>
  ).filter(Boolean);
  if (mergedBoxShadows.length > 0) css.boxShadow = mergedBoxShadows.join(", ");
  // Rotation
  Object.assign(css, transformStyle(node));
  // Text styling
  Object.assign(css, textStyles(node, ctx));
  // Autolayout (flex)
  Object.assign(css, autolayoutStyles(node));

  // Opacity / blend mode / overflow / visibility
  if (typeof node.opacity === "number" && node.opacity < 0.999)
    css.opacity = node.opacity;
  const bm = blendModeCss(node.blendMode);
  if (bm) css.mixBlendMode = bm;
  if (
    (node.type === "FRAME" || node.type === "INSTANCE") &&
    node.frameMaskDisabled !== true
  ) {
    css.overflow = "hidden";
  }
  // (Hidden nodes are dropped entirely in emitNode; no display:none needed.)

  return css;
}

/** Render a css object as a single inline `style` declaration string. */
function formatStyleString(css: Record<string, unknown>): string {
  return Object.entries(css)
    .map(([k, v]) => `${kebabCase(k)}: ${String(v)}`)
    .join("; ");
}

interface Ctx {
  byGuid: Map<string, FigNode>;
  // Library style nodes (and other keyed nodes) indexed by their stable
  // `key` so we can resolve `styleIdForFill.assetRef.key` lookups.
  byKey: Map<string, FigNode>;
  childrenOf: Map<string, FigNode[]>;
  symbolByGuid: Map<string, FigNode>;
  // Boolean visibility vars often carry no variableSetID; this index maps mode id → owning set.
  modeToSet: Map<string, string>;
  imageRefBase?: string;
  /** Raw blob bytes (for path command decoding). Indexed by blob index. */
  blobs: Buffer[];
  /** Hex hash -> on-disk filename (e.g. `<hash>` or `<hash>.png`). */
  imageMap: Map<string, string>;
  missingImageUrl?: string;
  /**
   * Set of `family|weight|italic` triples seen while emitting the current
   * frame. We use it to build a Google Fonts <link> in <head> so the custom
   * font families used in the design are actually loaded by the browser.
   */
  fontUsage: Set<string>;
  /** SYMBOLs currently being inlined (cycle guard). */
  inliningStack: Set<string>;
  renderedNodeCount: number;
  maxRenderedNodes: number;
  maxTreeDepth: number;
  maxFrameOutputBytes: number;
  maxTotalOutputBytes: number;
  totalOutputBytes: number;
}

/**
 * Figma's path-command blob format. A stream of:
 *   [op:byte] [args:float32 * N]
 * Opcodes (discovered empirically and confirmed against rounded rect /
 * vector / ellipse blobs):
 *   0 = ClosePath  (no args)
 *   1 = MoveTo     (x, y)
 *   2 = LineTo     (x, y)
 *   3 = QuadTo     (x1, y1, x, y)
 *   4 = CubicTo    (x1, y1, x2, y2, x, y)
 */
function decodePathCommands(bytes: Buffer | undefined): string {
  if (!bytes || bytes.length === 0) return "";
  const out: string[] = [];
  const fmt = (n: number) => {
    if (!Number.isFinite(n)) return "0";
    const r = Math.round(n * 1000) / 1000;
    return Object.is(r, -0) ? "0" : String(r);
  };
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i]!;
    let n = 0;
    let letter = "";
    if (op === 0) {
      letter = "Z";
      n = 0;
    } else if (op === 1) {
      letter = "M";
      n = 2;
    } else if (op === 2) {
      letter = "L";
      n = 2;
    } else if (op === 3) {
      letter = "Q";
      n = 4;
    } else if (op === 4) {
      letter = "C";
      n = 6;
    } else {
      // Unknown opcode — stop decoding gracefully so we don't run off
      // the end of the buffer.
      break;
    }
    if (i + 1 + n * 4 > bytes.length) break;
    const args: string[] = [];
    for (let j = 0; j < n; j++)
      args.push(fmt(bytes.readFloatLE(i + 1 + j * 4)));
    out.push(args.length ? `${letter}${args.join(" ")}` : letter);
    i += 1 + n * 4;
  }
  return out.join(" ");
}

/** SVG paint attribute (fill / stroke) for the first visible solid paint. */
function paintToSvgFill(
  paints: Paint[] | undefined,
): { color: string; opacity?: number } | null {
  const p = paints?.find((x) => x.visible !== false && x.type === "SOLID");
  if (!p || !p.color) return null;
  const c = p.color;
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  const opacity = c.a * (p.opacity ?? 1);
  return {
    color: `rgb(${r}, ${g}, ${b})`,
    opacity: opacity < 0.999 ? Number(opacity.toFixed(3)) : undefined,
  };
}

const VECTOR_LIKE_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "ELLIPSE",
  "BRUSH",
  "STAR",
  "REGULAR_POLYGON",
  "LINE",
  "VECTOR_PATH",
]);

function isVectorLike(node: FigNode): boolean {
  if (!node.type || !VECTOR_LIKE_TYPES.has(node.type)) return false;
  if (
    (node.fillGeometry?.length ?? 0) === 0 &&
    (node.strokeGeometry?.length ?? 0) === 0
  ) {
    return false;
  }
  // Nodes with an IMAGE fill render better as a regular <div> with
  // `background-image` (and `background-color` as a fallback) than as an
  // <svg> with a <pattern>. Skip the vector path so backgroundShorthand
  // can stack image + color fills via CSS.
  if (node.fillPaints?.some((p) => p.visible !== false && p.type === "IMAGE")) {
    return false;
  }
  return true;
}

/**
 * Render a vector-like node as an inline `<svg>`. The element itself keeps
 * the same outer attrs (layer-name, position/size style) as a regular div
 * so it slots into auto-layout / absolute positioning identically; the
 * vector geometry lives inside as `<path>` children.
 */
function emitSvgBody(
  node: FigNode,
  ctx: Ctx,
  indent: string,
  lines: string[],
): void {
  const w = node.size?.x ?? 0;
  const h = node.size?.y ?? 0;
  const fillRule =
    node.fillGeometry?.[0]?.windingRule === "ODD" ? "evenodd" : "nonzero";
  const fillPaint = paintToSvgFill(effectiveFillPaints(node, ctx));
  const strokePaint = paintToSvgFill(effectiveStrokePaints(node, ctx));
  const strokeWeight = node.strokeWeight ?? 0;

  // Fill paths
  for (const g of node.fillGeometry ?? []) {
    if (typeof g.commandsBlob !== "number") continue;
    const d = decodePathCommands(ctx.blobs[g.commandsBlob]);
    if (!d) continue;
    const attrs = [`d="${d}"`, `fill-rule="${fillRule}"`];
    if (fillPaint) {
      attrs.push(`fill="${fillPaint.color}"`);
      if (fillPaint.opacity !== undefined)
        attrs.push(`fill-opacity="${fillPaint.opacity}"`);
    } else {
      attrs.push(`fill="none"`);
    }
    lines.push(`${indent}  <path ${attrs.join(" ")} />`);
  }
  // Stroke paths
  if (strokePaint && strokeWeight > 0) {
    for (const g of node.strokeGeometry ?? node.fillGeometry ?? []) {
      if (typeof g.commandsBlob !== "number") continue;
      const d = decodePathCommands(ctx.blobs[g.commandsBlob]);
      if (!d) continue;
      const attrs = [
        `d="${d}"`,
        `fill="none"`,
        `stroke="${strokePaint.color}"`,
        `stroke-width="${num(strokeWeight)}"`,
      ];
      if (strokePaint.opacity !== undefined)
        attrs.push(`stroke-opacity="${strokePaint.opacity}"`);
      if (node.strokeJoin)
        attrs.push(`stroke-linejoin="${node.strokeJoin.toLowerCase()}"`);
      if (node.strokeCap)
        attrs.push(`stroke-linecap="${node.strokeCap.toLowerCase()}"`);
      lines.push(`${indent}  <path ${attrs.join(" ")} />`);
    }
  }
  // Best-effort viewBox so the geometry scales with the element box.
  if (w > 0 && h > 0) {
    // The path coordinates are already in the node's local pixel space, so
    // viewBox = 0 0 w h works without further transforms.
  }
}

function getChildren(node: FigNode, ctx: Ctx): FigNode[] {
  const kids = ctx.childrenOf.get(guidKey(node.guid)) ?? [];
  return kids.slice().sort((a, b) => {
    const pa = a.parentIndex?.position ?? "";
    const pb = b.parentIndex?.position ?? "";
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
}

function buildAttrs(
  node: FigNode,
  parent: FigNode | null,
  ctx: Ctx,
  isPositioned: boolean,
  componentSymbol: FigNode | null,
  vectorLike = false,
  hasAbsoluteChild = false,
  shadowAsFilter = false,
): string[] {
  const attrs: string[] = [];

  // layer-name: emit whenever the node has a name at all (matches the
  // figma-plugin's smart-export, which always carries the layer name when
  // present).
  if (node.name) attrs.push(`layer-name="${escapeHtmlAttr(node.name)}"`);

  // Component metadata: pulled from the SYMBOL master that an INSTANCE renders,
  // or from the SYMBOL itself when emitting a master directly.
  const symbolForMeta =
    componentSymbol ??
    (node.type === "SYMBOL" || node.type === "INSTANCE" ? node : null);
  if (symbolForMeta && symbolForMeta.type === "SYMBOL") {
    const { base, variant } = resolveComponentIdentity(symbolForMeta, ctx);
    if (base) attrs.push(`data-component-name="${escapeHtmlAttr(base)}"`);
    if (variant) attrs.push(`data-variant-name="${escapeHtmlAttr(variant)}"`);
    // Expose individual variant key/value pairs as parsed JSON so consumers
    // can read e.g. `Style=Action` directly without re-parsing the variant
    // string. Mirrors how the figma-plugin surfaces variant props.
    if (variant && /=/.test(variant)) {
      const variantProps: Record<string, string> = {};
      for (const pair of variant.split(/,\s*/)) {
        const [key, val] = pair.split("=");
        if (key && val !== undefined) variantProps[key.trim()] = val.trim();
      }
      if (Object.keys(variantProps).length > 0) {
        const json = JSON.stringify(variantProps).replace(/'/g, "&#39;");
        attrs.push(`data-variant-props='${json}'`);
      }
    }
    if (symbolForMeta.componentKey)
      attrs.push(
        `data-component-key="${escapeHtmlAttr(symbolForMeta.componentKey)}"`,
      );
    const desc = htmlToPlain(symbolForMeta.description);
    if (desc)
      attrs.push(`data-component-description="${escapeHtmlAttr(desc)}"`);
    const links = extractDocLinks(symbolForMeta.description);
    if (links.length > 0)
      attrs.push(`data-component-doc-link="${escapeHtmlAttr(links[0]!)}"`);
    if (links.length > 1)
      attrs.push(
        `data-component-doc-links="${escapeHtmlAttr(links.join(" | "))}"`,
      );
    const propDefNames = (symbolForMeta.componentPropDefs ?? [])
      .map((p) => p.name)
      .filter(Boolean) as string[];
    if (propDefNames.length > 0)
      attrs.push(
        `data-component-props="${escapeHtmlAttr(propDefNames.join(", "))}"`,
      );
  }

  // `props`: a stringified JSON object of the raw Figma component props on
  // this node. Includes the prop definitions on a SYMBOL/INSTANCE and the
  // assignments/refs that override them.
  const rawProps = collectRawProps(node, componentSymbol);
  if (rawProps) {
    // Use single-quoted attribute value so the inner JSON's double quotes
    // stay readable (no `&quot;` noise). Escape stray single quotes inside
    // the JSON for safety.
    const json = JSON.stringify(rawProps).replace(/'/g, "&#39;");
    attrs.push(`props='${json}'`);
  }

  // Per-node annotations (Figma's annotation feature).
  if (Array.isArray(node.annotations) && node.annotations.length > 0) {
    const labels = node.annotations
      .map((a) => htmlToPlain(a.labelV2 || a.label))
      .filter(Boolean);
    if (labels.length > 0)
      attrs.push(`data-annotations="${escapeHtmlAttr(labels.join(" | "))}"`);
  }

  const css = buildCss(
    node,
    parent,
    ctx,
    isPositioned,
    vectorLike,
    hasAbsoluteChild,
    shadowAsFilter,
  );
  if (Object.keys(css).length > 0) {
    attrs.push(`style="${escapeHtmlAttr(formatStyleString(css))}"`);
  }
  return attrs;
}

// Prefer published key (stable across documents) so consumers and the mode→set index agree.
function canonicalSetId(setNode: FigNode | undefined): string | null {
  if (!setNode) return null;
  if (setNode.key) return `key:${setNode.key}`;
  if (setNode.guid) return `guid:${guidKey(setNode.guid)}`;
  return null;
}

// Resolves through the actual set node so the result matches canonicalSetId regardless of reference form.
function refSetId(ref: VariableSetRef | undefined, ctx: Ctx): string | null {
  const setNode = ref?.assetRef?.key
    ? ctx.byKey.get(ref.assetRef.key)
    : ref?.guid
      ? ctx.byGuid.get(guidKey(ref.guid))
      : undefined;
  const canonical = canonicalSetId(setNode);
  if (canonical) return canonical;
  if (ref?.assetRef?.key) return `key:${ref.assetRef.key}`;
  if (ref?.guid) return `guid:${guidKey(ref.guid)}`;
  return null;
}

function lookupVarNode(
  alias: VariableValue["alias"],
  ctx: Ctx,
): FigNode | undefined {
  if (alias?.guid) return ctx.byGuid.get(guidKey(alias.guid));
  if (alias?.assetRef?.key) return ctx.byKey.get(alias.assetRef.key);
  return undefined;
}

// Boolean vars often carry no variableSetID; owning set is recovered via ctx.modeToSet.
// Falls back to the first declared value when no active mode applies.
function resolveVarBool(
  v: FigNode | undefined,
  varModes: Map<string, string>,
  ctx: Ctx,
  seen: Set<string>,
): boolean {
  if (!v) return false;
  const id = guidKey(v.guid);
  if (seen.has(id)) return false;
  seen.add(id);
  const entries = v.variableDataValues?.entries ?? [];
  if (entries.length === 0) return false;
  const setId = ctx.modeToSet.get(guidKey(entries[0]?.modeID));
  const wantMode = setId ? varModes.get(setId) : undefined;
  const entry =
    (wantMode && entries.find((e) => guidKey(e.modeID) === wantMode)) ||
    entries[0];
  const val = entry?.variableData?.value;
  if (!val) return false;
  if (typeof val.boolValue === "boolean") return val.boolValue;
  if (val.alias) {
    return resolveVarBool(lookupVarNode(val.alias, ctx), varModes, ctx, seen);
  }
  return false;
}

// Variant props (e.g. "Arrow position") are stored in symbolOverrides, not just variableModeBySetMap.
function collectInstanceVarModes(node: FigNode, ctx: Ctx): Map<string, string> {
  const out = new Map<string, string>();
  const apply = (
    entries:
      | Array<{ variableSetID?: VariableSetRef; variableModeID?: Guid }>
      | undefined,
  ) => {
    for (const e of entries ?? []) {
      const sid = refSetId(e.variableSetID, ctx);
      if (sid && e.variableModeID) out.set(sid, guidKey(e.variableModeID));
    }
  };
  apply(node.variableModeBySetMap?.entries);
  for (const o of node.symbolData?.symbolOverrides ?? []) {
    apply(o.variableModeBySetMap?.entries);
  }
  return out;
}

// Returns undefined when no VISIBLE binding exists (caller falls back to literal `visible`).
// Masters hide all variant layers by default; the active mode enables exactly one.
function resolveBoundVisibility(
  node: FigNode,
  varModes: Map<string, string>,
  ctx: Ctx,
): boolean | undefined {
  const entry = node.variableConsumptionMap?.entries?.find(
    (e) => e.variableField === "VISIBLE",
  );
  const val = entry?.variableData?.value;
  if (!val) return undefined;
  const expr = val.expressionValue;
  if (expr?.expressionFunction === "IS_TRUTHY") {
    const arg = expr.expressionArguments?.[0]?.value;
    if (arg?.alias) {
      return resolveVarBool(
        lookupVarNode(arg.alias, ctx),
        varModes,
        ctx,
        new Set(),
      );
    }
    return undefined;
  }
  if (val.alias) {
    return resolveVarBool(
      lookupVarNode(val.alias, ctx),
      varModes,
      ctx,
      new Set(),
    );
  }
  return undefined;
}

function emitNode(
  node: FigNode,
  parent: FigNode | null,
  ctx: Ctx,
  depth: number,
  parentIsFlex: boolean,
  lines: string[],
  propEnv: Map<string, ResolvedPropValue> = new Map(),
  /**
   * Stack of active symbol-override scopes contributed by enclosing
   * INSTANCEs. Each layer's keys are descendant guidPaths RELATIVE to where
   * that instance was entered (matching what Figma stores in
   * `symbolOverrides[].guidPath` and `derivedSymbolData[].guidPath`).
   * Lookup uses `instancePath.slice(layer.startIndex)` plus the current
   * node's overrideKey as the leaf segment.
   *
   * Outer layers stay active across nested inner instances so that deep
   * overrides like `[outerInstanceKey, innerNodeKey]` still match.
   */
  overrideLayers: OverrideLayer[] = [],
  /**
   * Stack of INSTANCE overrideKeys we've descended INTO (i.e., crossed the
   * instance->master boundary). Plain frame/group nesting does NOT grow this
   * path. Used together with `overrideLayers` to look up `symbolOverrides` /
   * `derivedSymbolData` entries that target a descendant by library guidPath.
   */
  instancePath: string[] = [],
  /** Active variable mode per set (set id → mode guid) inherited from enclosing INSTANCEs. */
  varModes: Map<string, string> = new Map(),
): void {
  if (depth > ctx.maxTreeDepth) {
    throw new Error(".fig render tree is nested too deeply.");
  }
  ctx.renderedNodeCount += 1;
  if (ctx.renderedNodeCount > ctx.maxRenderedNodes) {
    throw new Error(".fig render exceeded its expanded-node budget.");
  }
  // Match smart-export: skip invisible nodes entirely. Variable bindings override the literal flag —
  // masters hide all variant layers by default and the active mode turns one on.
  const boundVisible = resolveBoundVisibility(node, varModes, ctx);
  if (boundVisible === false) return;
  if (boundVisible === undefined && node.visible === false) return;

  // Apply enclosing-instance symbol overrides (variant swap, text override,
  // visibility flip) targeted at this node by guidPath.
  const overridden = applyOverrideLayers(node, overrideLayers, instancePath);
  if (overridden === null) return;
  node = overridden;

  // Apply parent-instance prop overrides for this node (text/symbol/swap,
  // visibility). May hide the node entirely or rewrite its textData /
  // symbolData before we resolve the inlined symbol below.
  const patched = applyPropRefs(node, propEnv);
  if (patched === null) return;
  node = patched;

  const indent = "  ".repeat(depth);

  // INSTANCE: inline the master SYMBOL's children inside this element so the
  // implementation is self-contained. Cycle guard: don't recursively inline a
  // SYMBOL that's already being inlined further up the chain.
  let inlinedSymbol: FigNode | null = null;
  if (node.type === "INSTANCE" && node.symbolData?.symbolID) {
    const symKey = guidKey(node.symbolData.symbolID);
    if (!ctx.inliningStack.has(symKey)) {
      const sym = ctx.symbolByGuid.get(symKey);
      if (sym) inlinedSymbol = sym;
    }
  }

  // When entering an INSTANCE, extend the prop env with its assignments so
  // descendants (whether the instance's own children or the inlined SYMBOL's
  // children) see the override values. Likewise build a fresh
  // symbolOverrides map (overrides scope to a single instance), and reset
  // the current path so descendant guidPaths are evaluated against the new
  // master.
  const childPropEnv =
    node.type === "INSTANCE" ? buildPropEnv(node, propEnv) : propEnv;
  // When entering an INSTANCE that will inline a master, descendants live
  // one level deeper in the instance-path. Push the new override layer with
  // startIndex pointing at that future depth so its keys (relative paths
  // inside this instance's master) are evaluated against an empty prefix at
  // the master's first level. Outer layers stay active so deeper overrides
  // from enclosing instances still apply across nested boundaries.
  const childInstancePath =
    node.type === "INSTANCE" && inlinedSymbol
      ? [...instancePath, guidKey(node.overrideKey ?? node.guid)]
      : instancePath;
  let childOverrideLayers = overrideLayers;
  if (node.type === "INSTANCE") {
    const map = buildSymbolOverrideLayer(node);
    if (map.size > 0) {
      childOverrideLayers = [
        ...overrideLayers,
        { startIndex: childInstancePath.length, map },
      ];
    }
  }
  // Layer this instance's variant prop modes over inherited ones before descending into the master.
  let childVarModes = varModes;
  if (node.type === "INSTANCE") {
    const added = collectInstanceVarModes(node, ctx);
    if (added.size > 0) {
      childVarModes = new Map(varModes);
      for (const [k, v] of added) childVarModes.set(k, v);
    }
  }

  // A node is rendered as an SVG when it has its own vector geometry, OR
  // when it's an INSTANCE of a SYMBOL whose root is itself a vector (e.g.
  // single-shape icon components). For the latter we paint the master's
  // geometry inside the instance element so the icon actually shows up
  // instead of an empty div.
  const selfVector = isVectorLike(node);
  const symbolVector = !!inlinedSymbol && isVectorLike(inlinedSymbol);
  const vectorLike = selfVector || symbolVector;
  const vectorSourceNode = selfVector
    ? node
    : symbolVector
      ? inlinedSymbol!
      : node;
  const tag = vectorLike ? "svg" : tagFor(node.type);
  // Children of a flex (autolayout) parent flow normally; otherwise absolute.
  // A child can opt out of the stack with `stackPositioning: "ABSOLUTE"`
  // (e.g. a tooltip's caret that overlaps the body): it ignores its parent's
  // auto-layout and is positioned by its own transform even inside a flex
  // parent (Figma's "ignore auto layout").
  const isPositioned = !parentIsFlex || node.stackPositioning === "ABSOLUTE";

  // For INSTANCE nodes with an inlined master, the autolayout / padding /
  // sizing properties cached on the instance reflect the *previous* master
  // and become stale after a variant swap. Use the master's values for the
  // instance's own container styling so the rendered layout matches the
  // currently-resolved variant.
  const layoutNode = inlinedSymbol
    ? withMasterLayout(node, inlinedSymbol)
    : node;
  // If any rendered child ignores auto-layout (position: absolute), this
  // container must establish a positioning context so the child is offset
  // relative to it. Check the actually-rendered children (the inlined
  // master's, for an INSTANCE).
  const childSource = inlinedSymbol ?? node;
  const hasAbsoluteChild = (
    ctx.childrenOf.get(guidKey(childSource.guid)) ?? []
  ).some((c) => c.stackPositioning === "ABSOLUTE");
  // A container whose drop shadow must wrap an overflowing absolute child
  // (e.g. a tooltip caret) needs `filter: drop-shadow()` rather than
  // `box-shadow`, which would only trace the body's box. Children render from
  // the inlined master for an INSTANCE.
  const shadowAsFilter = getChildren(inlinedSymbol ?? node, ctx).some(
    (c) => c.stackPositioning === "ABSOLUTE" && c.visible !== false,
  );
  const attrs = buildAttrs(
    layoutNode,
    parent,
    ctx,
    isPositioned,
    inlinedSymbol,
    vectorLike,
    hasAbsoluteChild,
    shadowAsFilter,
  );
  if (vectorLike) {
    // viewBox prefers the geometry source node's intrinsic size so the
    // SVG draws correctly when the instance is scaled differently from
    // the master.
    const vw = vectorSourceNode.size?.x ?? node.size?.x ?? 0;
    const vh = vectorSourceNode.size?.y ?? node.size?.y ?? 0;
    if (vw > 0 && vh > 0) {
      attrs.push(`viewBox="0 0 ${num(vw)} ${num(vh)}"`);
    }
    attrs.push(`xmlns="http://www.w3.org/2000/svg"`);
    attrs.push(`fill="none"`);
  }

  const isFlex = layoutNode.stackMode && layoutNode.stackMode !== "NONE";

  // Single HTML comment above the element with component name + description
  // + doc links, when present. (Same metadata is also on data-* attrs.)
  const symbolForMeta = inlinedSymbol ?? (node.type === "SYMBOL" ? node : null);
  if (symbolForMeta) {
    const desc = htmlToPlain(symbolForMeta.description);
    const links = extractDocLinks(symbolForMeta.description);
    if (desc || links.length > 0) {
      const parts = [
        `Component: ${(symbolForMeta.name ?? "<unnamed>").replace(/--/g, "\u2013")}`,
      ];
      // HTML comments must not contain "--" — replace any with an en-dash.
      if (desc) parts.push(desc.replace(/--/g, "\u2013"));
      if (links.length > 0) parts.push(`docs: ${links.join(", ")}`);
      lines.push(`${indent}<!-- ${parts.join(" \u2014 ")} -->`);
    }
  }

  if (vectorLike) {
    emitOpenWithChildren(tag, attrs, indent, lines);
    emitSvgBody(vectorSourceNode, ctx, indent, lines);
    lines.push(`${indent}</${tag}>`);
    return;
  }

  if (node.type === "TEXT") {
    const chars = node.textData?.characters ?? "";
    if (chars.length === 0) {
      emitOpenWithChildren(tag, attrs, indent, lines);
      lines.push(`${indent}</${tag}>`);
      return;
    }
    emitOpenWithChildren(tag, attrs, indent, lines);
    // Preserve newlines in the source by splitting into <br>-separated lines
    // (HTML otherwise collapses whitespace).
    const escaped = escapeHtmlText(chars).replace(/\n/g, "<br>");
    lines.push(`${indent}  ${escaped}`);
    lines.push(`${indent}</${tag}>`);
    return;
  }

  // Pick which children to render: the inlined SYMBOL's, or the node's own.
  let children: FigNode[];
  let symKeyForCycle: string | null = null;
  if (inlinedSymbol) {
    symKeyForCycle = guidKey(inlinedSymbol.guid);
    ctx.inliningStack.add(symKeyForCycle);
    children = getChildren(inlinedSymbol, ctx);
  } else {
    children = getChildren(node, ctx);
  }

  try {
    if (children.length === 0) {
      emitOpenWithChildren(tag, attrs, indent, lines);
      lines.push(`${indent}</${tag}>`);
      return;
    }
    emitOpenWithChildren(tag, attrs, indent, lines);
    // When inlining a SYMBOL, its child positions are relative to the SYMBOL's
    // own frame, which now coincides with this INSTANCE's frame. So they keep
    // their original transforms.
    const childParentIsFlex = inlinedSymbol
      ? !!(inlinedSymbol.stackMode && inlinedSymbol.stackMode !== "NONE")
      : !!isFlex;
    const childParentNode = inlinedSymbol ?? node;
    for (const child of children) {
      emitNode(
        child,
        childParentNode,
        ctx,
        depth + 1,
        childParentIsFlex,
        lines,
        childPropEnv,
        childOverrideLayers,
        childInstancePath,
        childVarModes,
      );
    }
    lines.push(`${indent}</${tag}>`);
  } finally {
    if (symKeyForCycle) ctx.inliningStack.delete(symKeyForCycle);
  }
}

function emitOpenWithChildren(
  tag: string,
  attrs: string[],
  indent: string,
  lines: string[],
): void {
  if (attrs.length === 0) {
    lines.push(`${indent}<${tag}>`);
    return;
  }
  // Single-line for short attribute lists; multi-line otherwise.
  const oneLine = `${indent}<${tag} ${attrs.join(" ")}>`;
  if (attrs.length <= 2 && oneLine.length <= 200) {
    lines.push(oneLine);
    return;
  }
  lines.push(`${indent}<${tag}`);
  for (const a of attrs) lines.push(`${indent}  ${a}`);
  lines.push(`${indent}>`);
}

/**
 * Build a Google Fonts CSS2 URL from the set of font family/weight/italic
 * combos collected while emitting a frame. Returns null when no fonts are
 * recorded.
 */
function buildGoogleFontsUrl(fontUsage: Set<string>): string | null {
  if (fontUsage.size === 0) return null;
  const byFamily = new Map<
    string,
    Array<{ weight: number; italic: boolean }>
  >();
  for (const entry of fontUsage) {
    const [family, weightStr, italicStr] = entry.split("|");
    if (!family) continue;
    const weight = Number(weightStr) || 400;
    const italic = italicStr === "1";
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push({ weight, italic });
  }
  const families: string[] = [];
  for (const [family, variants] of byFamily) {
    const hasItalic = variants.some((v) => v.italic);
    const weights = Array.from(new Set(variants.map((v) => v.weight))).sort(
      (a, b) => a - b,
    );
    const famParam = family.replace(/\s+/g, "+");
    if (hasItalic) {
      const tuples = variants
        .map((v) => `${v.italic ? 1 : 0},${v.weight}`)
        .sort();
      families.push(
        `family=${famParam}:ital,wght@${Array.from(new Set(tuples)).join(";")}`,
      );
    } else {
      families.push(`family=${famParam}:wght@${weights.join(";")}`);
    }
  }
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

function emitFrameTemplate(frame: FigNode, ctx: Ctx, pageName: string): string {
  // Reset per-frame font usage; emitNode populates it via textStyles.
  ctx.fontUsage.clear();
  const bodyLines: string[] = new BudgetedLines(ctx.maxFrameOutputBytes);
  emitNode(frame, null, ctx, 1, true, bodyLines, new Map(), [], []);

  const lines: string[] = [];
  lines.push("<!doctype html>");
  lines.push(
    `<!-- Auto-generated from Figma. Frame: ${frame.name ?? "<unnamed>"} (page: ${pageName}) -->`,
  );
  lines.push("<html>");
  lines.push("<head>");
  lines.push('  <meta charset="utf-8">');
  lines.push(
    `  <title>${escapeHtmlText(`${pageName} \u2014 ${frame.name ?? "frame"}`)}</title>`,
  );
  // Figma sizes are border-box (stroke INSIDE; size includes padding + border).
  // Default CSS content-box would inflate every explicit width/height/min-size
  // by the padding + border, so normalize to border-box.
  lines.push(
    "  <style>*, *::before, *::after { box-sizing: border-box; }</style>",
  );
  // Custom font families used by the frame -> request them from Google
  // Fonts. (Smart-export does the same for design hand-off so the layout
  // renders with the intended typography.)
  const fontsUrl = buildGoogleFontsUrl(ctx.fontUsage);
  if (fontsUrl) {
    lines.push('  <link rel="preconnect" href="https://fonts.googleapis.com">');
    lines.push(
      '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    );
    lines.push(`  <link rel="stylesheet" href="${escapeHtmlAttr(fontsUrl)}">`);
  }
  lines.push("</head>");
  lines.push("<body>");
  for (const l of bodyLines) lines.push(l);
  lines.push("</body>");
  lines.push("</html>");
  lines.push("");
  return lines.join("\n");
}

class BudgetedLines extends Array<string> {
  private bytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override push(...items: string[]): number {
    for (const item of items) {
      this.bytes += Buffer.byteLength(item, "utf8") + 1;
      if (this.bytes > this.maxBytes) {
        throw new Error(".fig frame exceeded its render output budget.");
      }
    }
    return super.push(...items);
  }
}

export interface RenderedFrame {
  pageName: string;
  pageDirName: string;
  frameName: string;
  /** Sanitized + de-duplicated filename including the `.html` extension. */
  fileName: string;
  /** Path relative to the render root, e.g. `page-1/login.html`. */
  relativePath: string;
  html: string;
  width?: number;
  height?: number;
}

export interface RenderHtmlResult {
  pageCount: number;
  frameCount: number;
  frames: RenderedFrame[];
}

export interface RenderHtmlOptions {
  /** Optional prefix for image url() references (default: "../images") */
  imageRefBase?: string;
  /** Pre-built `hash -> filename` map for image references. */
  imageMap?: Map<string, string>;
  /** Safe URL used when an embedded image was omitted (for example no storage provider). */
  missingImageUrl?: string;
  /*** Optional set of page (CANVAS) and/or frame GUID keys */
  selection?: Set<string>;
  maxFrames?: number;
  maxRenderedNodes?: number;
  maxTreeDepth?: number;
  maxFrameOutputBytes?: number;
  maxTotalOutputBytes?: number;
}

const DEFAULT_MAX_RENDER_FRAMES = 200;
const DEFAULT_MAX_RENDERED_NODES = 250_000;
const DEFAULT_MAX_TREE_DEPTH = 256;
const DEFAULT_MAX_FRAME_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = 24 * 1024 * 1024;

const TOP_LEVEL_RENDERABLE_TYPES = new Set(["FRAME", "SYMBOL", "INSTANCE"]);

/**
 * Collect the renderable top-level units on a page. Figma allows SECTION
 * nodes (and nested sections) to wrap frames; sections are organizational
 * containers, not standalone designs, so we recurse THROUGH them and
 * collect the frames inside. Anything that isn't a SECTION or a
 * renderable type is ignored. Children are returned in document order
 * (depth-first across sections).
 */
export function collectTopLevelFrames(
  parent: FigNode,
  childrenOf: Map<string, FigNode[]>,
): FigNode[] {
  const sortChildren = (kids: FigNode[]): FigNode[] =>
    kids.slice().sort((a, b) => {
      const pa = a.parentIndex?.position ?? "";
      const pb = b.parentIndex?.position ?? "";
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  const out: FigNode[] = [];
  const visitedSections = new Set<string>();
  const stack = sortChildren(childrenOf.get(guidKey(parent.guid)) ?? [])
    .reverse()
    .map((node) => ({ node, depth: 1 }));
  let visited = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    visited += 1;
    if (visited > DEFAULT_MAX_RENDERED_NODES) {
      throw new Error(".fig section traversal exceeded its node budget.");
    }
    if (depth > DEFAULT_MAX_TREE_DEPTH) {
      throw new Error(".fig section tree is nested too deeply.");
    }
    if (!node.type || node.visible === false) continue;
    if (node.type === "SECTION") {
      const key = guidKey(node.guid);
      if (visitedSections.has(key)) {
        throw new Error(".fig section tree contains a cycle.");
      }
      visitedSections.add(key);
      const children = sortChildren(childrenOf.get(key) ?? []);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: children[index]!, depth: depth + 1 });
      }
      continue;
    }
    if (TOP_LEVEL_RENDERABLE_TYPES.has(node.type)) out.push(node);
  }
  return out;
}
// Maps a Figma `variableField` (on a node's variableConsumptionMap entry) to
// the literal FigNode field it overrides. Only layout-affecting numeric fields
// are listed — colors/text tokens are resolved elsewhere or left as baked.
const VARIABLE_FIELD_TO_PROP: Record<string, keyof FigNode> = {
  STACK_PADDING_LEFT: "stackPaddingLeft",
  STACK_PADDING_RIGHT: "stackPaddingRight",
  STACK_PADDING_TOP: "stackPaddingTop",
  STACK_PADDING_BOTTOM: "stackPaddingBottom",
  STACK_HORIZONTAL_PADDING: "stackHorizontalPadding",
  STACK_VERTICAL_PADDING: "stackVerticalPadding",
  STACK_SPACING: "stackSpacing",
  RECTANGLE_TOP_LEFT_CORNER_RADIUS: "rectangleTopLeftCornerRadius",
  RECTANGLE_TOP_RIGHT_CORNER_RADIUS: "rectangleTopRightCornerRadius",
  RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS: "rectangleBottomLeftCornerRadius",
  RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS: "rectangleBottomRightCornerRadius",
  CORNER_RADIUS: "cornerRadius",
  BORDER_TOP_WEIGHT: "strokeTopWeight",
  BORDER_BOTTOM_WEIGHT: "strokeBottomWeight",
  BORDER_LEFT_WEIGHT: "strokeLeftWeight",
  BORDER_RIGHT_WEIGHT: "strokeRightWeight",
  STROKE_WEIGHT: "strokeWeight",
};

/**
 * Rewrites bound design-token variables into literal layout fields (padding, corner radius,
 * spacing, border weight) so the renderer doesn't need to know about variables.
 *
 * Figma bakes a literal alongside each binding, but the literal can be stale (e.g. the mode
 * changed after the node was created). We overwrite a present literal only when the active mode
 * was found explicitly on the node or an ancestor — the collection default is NOT recoverable
 * from the document, so when no explicit mode exists we leave the baked value alone. A missing
 * literal is always filled.
 *
 * Local variables with a unique published counterpart by name are redirected to the published
 * one; Figma drops stale local copies on paste and this matches what renders in isolation.
 *
 * Mutates nodes in place; unresolvable bindings leave the literal untouched.
 */
function resolveVariableBindings(
  nodes: FigNode[],
  byGuid: Map<string, FigNode>,
  byKey: Map<string, FigNode>,
): void {
  // Published variables indexed by name. A name shared by multiple published
  // variables is ambiguous (stored as null) and never used for redirection.
  const publishedByName = new Map<string, FigNode | null>();
  for (const n of nodes) {
    if (n.type !== "VARIABLE" || !n.key || !n.name) continue;
    publishedByName.set(n.name, publishedByName.has(n.name) ? null : n);
  }

  const setIdOf = (ref: VariableSetRef | undefined): string | null => {
    if (ref?.assetRef?.key) return `key:${ref.assetRef.key}`;
    if (ref?.guid) return `guid:${guidKey(ref.guid)}`;
    return null;
  };
  const lookupVar = (alias: VariableValue["alias"]): FigNode | undefined => {
    const direct = alias?.guid
      ? byGuid.get(guidKey(alias.guid))
      : alias?.assetRef?.key
        ? byKey.get(alias.assetRef.key)
        : undefined;
    // Redirect a stale local variable to its unique published counterpart.
    if (direct && !direct.key && direct.name) {
      const published = publishedByName.get(direct.name);
      if (published) return published;
    }
    return direct;
  };
  const lookupSet = (ref: VariableSetRef | undefined): FigNode | undefined => {
    if (ref?.assetRef?.key) return byKey.get(ref.assetRef.key);
    if (ref?.guid) return byGuid.get(guidKey(ref.guid));
    return undefined;
  };

  // Active mode for a variable's owning set. `explicit` is true when the mode
  // came from a `variableModeBySetMap` entry on the consumer or an ancestor;
  // false when we fell back to the set's first declared mode (a guess).
  const activeModeForSet = (
    consumer: FigNode,
    setId: string,
  ): { mode: string | null; explicit: boolean } => {
    let cur: FigNode | undefined = consumer;
    let depth = 0;
    while (cur && depth < 60) {
      for (const e of cur.variableModeBySetMap?.entries ?? []) {
        if (setIdOf(e.variableSetID) === setId) {
          return { mode: guidKey(e.variableModeID), explicit: true };
        }
      }
      cur = byGuid.get(guidKey(cur.parentIndex?.guid));
      depth++;
    }
    return { mode: null, explicit: false };
  };

  // Resolve the alias chain to a number, tracking whether every mode choice
  // was made with confidence (explicit override, or an unambiguous single-mode
  // set) so a present literal can be safely overwritten.
  const resolve = (
    value: VariableValue | undefined,
    consumer: FigNode,
    seen: Set<string>,
  ): { value: number | null; confident: boolean } => {
    if (value == null) return { value: null, confident: true };
    if (value.alias) {
      const v = lookupVar(value.alias);
      if (!v) return { value: null, confident: true };
      const id = guidKey(v.guid);
      if (seen.has(id)) return { value: null, confident: true };
      seen.add(id);
      const setId = setIdOf(v.variableSetID);
      const entries = v.variableDataValues?.entries ?? [];
      const singleMode = entries.length <= 1;
      const { mode, explicit } = setId
        ? activeModeForSet(consumer, setId)
        : { mode: null, explicit: false };
      const fallbackMode = guidKey(
        lookupSet(v.variableSetID)?.variableSetModes?.[0]?.id,
      );
      const wantMode = mode ?? fallbackMode;
      const entry =
        entries.find((e) => guidKey(e.modeID) === wantMode) ?? entries[0];
      const next = resolve(entry?.variableData?.value, consumer, seen);
      return {
        value: next.value,
        confident: next.confident && (explicit || singleMode),
      };
    }
    for (const k of Object.keys(value)) {
      if (typeof value[k] === "number") {
        return { value: value[k] as number, confident: true };
      }
    }
    return { value: null, confident: true };
  };

  for (const node of nodes) {
    const entries = node.variableConsumptionMap?.entries;
    if (!entries?.length) continue;
    for (const entry of entries) {
      const field = entry.variableField;
      if (!field) continue;
      const prop = VARIABLE_FIELD_TO_PROP[field];
      if (!prop) continue;
      const { value, confident } = resolve(
        entry.variableData?.value,
        node,
        new Set(),
      );
      if (value === null) continue;
      const hasLiteral = (node as Record<string, unknown>)[prop] !== undefined;
      if (!hasLiteral || confident) {
        (node as Record<string, unknown>)[prop] = value;
      }
    }
  }
}

export function renderHtmlTemplates(
  document: unknown,
  options: RenderHtmlOptions = {},
): RenderHtmlResult {
  const doc = document as {
    nodeChanges?: FigNode[];
    blobs?: Array<{ bytes?: string | Buffer | Uint8Array }>;
  };
  const nodes = doc.nodeChanges ?? [];

  // Decode blob bytes once. The kiwi document JSON-serializes blob bytes as
  // hex strings; Buffer / Uint8Array values may also appear depending on how
  // the caller decoded the document.
  const blobs: Buffer[] = (doc.blobs ?? []).map((b) => {
    const v = b?.bytes;
    if (!v) return Buffer.alloc(0);
    if (Buffer.isBuffer(v)) return v;
    if (v instanceof Uint8Array) return Buffer.from(v);
    if (typeof v === "string") return Buffer.from(v, "hex");
    return Buffer.alloc(0);
  });

  const byGuid = new Map<string, FigNode>();
  const byKey = new Map<string, FigNode>();
  const childrenOf = new Map<string, FigNode[]>();
  const symbolByGuid = new Map<string, FigNode>();
  const modeToSet = new Map<string, string>();
  for (const n of nodes) {
    byGuid.set(guidKey(n.guid), n);
    if (n.key) byKey.set(n.key, n);
    if (n.type === "SYMBOL") {
      symbolByGuid.set(guidKey(n.guid), n);
    }
    if (n.type === "VARIABLE_SET") {
      const sid = canonicalSetId(n);
      if (sid) {
        for (const m of n.variableSetModes ?? []) {
          if (m.id) modeToSet.set(guidKey(m.id), sid);
        }
      }
    }
    const pk = guidKey(n.parentIndex?.guid);
    if (!pk) continue;
    let arr = childrenOf.get(pk);
    if (!arr) {
      arr = [];
      childrenOf.set(pk, arr);
    }
    arr.push(n);
  }

  // Bake variable-bound layout values (padding/radius/spacing/border) into the
  // literal fields the renderer reads, before any rendering or master/instance
  // composition consults them.
  resolveVariableBindings(nodes, byGuid, byKey);

  const ctx: Ctx = {
    byGuid,
    byKey,
    childrenOf,
    symbolByGuid,
    modeToSet,
    imageRefBase: options.imageRefBase,
    blobs,
    imageMap: options.imageMap ?? new Map<string, string>(),
    missingImageUrl: options.missingImageUrl,
    fontUsage: new Set(),
    inliningStack: new Set(),
    renderedNodeCount: 0,
    maxRenderedNodes: options.maxRenderedNodes ?? DEFAULT_MAX_RENDERED_NODES,
    maxTreeDepth: options.maxTreeDepth ?? DEFAULT_MAX_TREE_DEPTH,
    maxFrameOutputBytes:
      options.maxFrameOutputBytes ?? DEFAULT_MAX_FRAME_OUTPUT_BYTES,
    maxTotalOutputBytes:
      options.maxTotalOutputBytes ?? DEFAULT_MAX_TOTAL_OUTPUT_BYTES,
    totalOutputBytes: 0,
  };

  const documentNode = nodes.find((n) => n.type === "DOCUMENT");
  if (!documentNode) return { pageCount: 0, frameCount: 0, frames: [] };

  const allPages = (childrenOf.get(guidKey(documentNode.guid)) ?? []).filter(
    (n) => n.type === "CANVAS" && !n.internalOnly,
  );

  const selection =
    options.selection && options.selection.size > 0 ? options.selection : null;

  const pages = selection
    ? allPages.filter((page) => {
        if (selection.has(guidKey(page.guid))) return true;
        const children = childrenOf.get(guidKey(page.guid)) ?? [];
        return children.some((c) => selection.has(guidKey(c.guid)));
      })
    : allPages;

  const frames: RenderedFrame[] = [];
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]!;
    const pageDirName = sanitizeFilename(page.name, `page-${pageIdx + 1}`);
    const pageSelected = selection?.has(guidKey(page.guid)) ?? false;
    const pageFrames = collectTopLevelFrames(page, ctx.childrenOf).filter(
      (c) => {
        if (!selection || pageSelected) return true;
        return selection.has(guidKey(c.guid));
      },
    );
    if (
      frames.length + pageFrames.length >
      (options.maxFrames ?? DEFAULT_MAX_RENDER_FRAMES)
    ) {
      throw new Error(".fig document has too many top-level frames.");
    }

    const seen = new Map<string, number>();
    for (let frameIdx = 0; frameIdx < pageFrames.length; frameIdx++) {
      const frame = pageFrames[frameIdx]!;
      const baseFile = sanitizeFilename(frame.name, `frame-${frameIdx + 1}`);
      const dupeIdx = seen.get(baseFile) ?? 0;
      seen.set(baseFile, dupeIdx + 1);
      const fileName =
        dupeIdx === 0 ? `${baseFile}.html` : `${baseFile}-${dupeIdx + 1}.html`;
      const pageName = page.name ?? `page-${pageIdx + 1}`;
      const html = emitFrameTemplate(frame, ctx, pageName);
      ctx.totalOutputBytes += Buffer.byteLength(html, "utf8");
      if (ctx.totalOutputBytes > ctx.maxTotalOutputBytes) {
        throw new Error(".fig render exceeded its total output budget.");
      }
      frames.push({
        pageName,
        pageDirName,
        frameName: frame.name ?? `frame-${frameIdx + 1}`,
        fileName,
        relativePath: path.posix.join(pageDirName, fileName),
        html,
        width: frame.size?.x,
        height: frame.size?.y,
      });
    }
  }

  return {
    pageCount: pages.length,
    frameCount: frames.length,
    frames,
  };
}
