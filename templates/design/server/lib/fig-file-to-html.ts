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

import {
  cssBlendMode,
  figmaDrawnText,
  gradientAngleDegreesFromHandles,
  gradientGeometryFromTransform,
  remapLinearStopPosition,
  textDecorationCss,
  textTransformCss,
} from "./figma-node-to-html.js";

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
  /** UNION / SUBTRACT / INTERSECT / EXCLUDE on a BOOLEAN_OPERATION. */
  booleanOperation?: string;
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;
  /** Kiwi's spelling of REST's `isMask`: this node clips its later siblings. */
  mask?: boolean;
  /** STAR point count / REGULAR_POLYGON side count. */
  count?: number;
  /** STAR inner-radius ratio; Figma's default is the golden ratio, ~0.382. */
  starInnerScale?: number;
  /** ELLIPSE sweep. A full turn with no inner radius is a plain ellipse. */
  arcData?: {
    startingAngle?: number;
    endingAngle?: number;
    innerRadius?: number;
  };
  fontSize?: number;
  fontName?: { family?: string; style?: string };
  letterSpacing?: { value: number; units?: string };
  lineHeight?: { value: number; units?: string };
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textData?: {
    characters?: string;
    // One entry per line Figma laid out — its own count, which is not the same
    // as counting break characters in `characters`.
    lines?: unknown[];
    // Per-character style index (one entry per UTF-16 code unit); the index
    // keys into `styleOverrideTable`. Absent/0 means the node's base style.
    characterStyleIDs?: number[];
    styleOverrideTable?: Array<{
      styleID?: number;
      fillPaints?: Paint[];
      fontSize?: number;
    }>;
  };
  textAutoResize?: string;
  /** ORIGINAL / UPPER / LOWER / TITLE — Figma's own casing, applied at render. */
  textCase?: string;
  /** NONE / UNDERLINE / STRIKETHROUGH. */
  textDecoration?: string;
  symbolData?: {
    symbolID?: Guid;
    symbolOverrides?: SymbolOverride[];
  };
  stackMode?: string;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  /** "WRAP" lets the stack run onto more than one line. */
  stackWrap?: string;
  /** The gap BETWEEN wrapped lines, which is a separate field from stackSpacing. */
  stackCounterSpacing?: number;
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
  /** Figma's dash/gap lengths, in px. Empty or absent means a solid stroke. */
  dashPattern?: number[];
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
  // Collect every layer that targets this node, outermost first.
  const matches: OverrideEntry[] = [];
  for (const layer of layers) {
    const prefix = instancePath.slice(layer.startIndex);
    const relKey =
      prefix.length > 0 ? `${prefix.join("/")}/${nodeKey}` : nodeKey;
    const entry = layer.map.get(relKey);
    if (entry) matches.push(entry);
  }
  if (matches.length === 0) return node;

  // Figma resolves a descendant against the OUTERMOST instance that overrides
  // it: that entry is the edit someone made on the instance they actually
  // placed, while a nested instance's entry belongs to the component it came
  // from. Merging outer-to-inner lets the component's own value win and
  // silently undo the edit — Untitled UI's header rendered "Resources /
  // Resources" because the outer instance said "Products" and the inner
  // `Buttons/Button` said "Resources" one layer later.
  //
  // So merge INNER-first and let outer values land last. A field the outer
  // entry never mentions still falls through to the inner one, which is what
  // keeps layout overrides like `size` working across nesting.
  const merged: FigNode = { ...node };
  for (let i = matches.length - 1; i >= 0; i--) {
    const entry = matches[i]!;
    // Shallow-merge every field present on the override (except the routing
    // fields and `overriddenSymbolID`, which goes into symbolData). This
    // applies layout overrides like `size`, `textAutoResize`,
    // `stackChildAlignSelf`, `stackCounterSizing`, `textAlignVertical`,
    // styling fields, etc., in addition to text/visibility.
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
  }
  if (merged.visible === false) return null;
  return merged;
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

interface TextRun {
  text: string;
  /** CSS color when a per-character override differs from the base fill. */
  color?: string;
}

/**
 * The text Figma draws. `textData.lines` is the kiwi twin of REST `lineTypes`:
 * one entry per line Figma actually laid out, and the only reliable statement
 * of how many of the stored break characters are real. It differs from the
 * break count on 17 of the 18 break-bearing nodes in one real file.
 */
function textCharacters(node: FigNode): string {
  return figmaDrawnText(
    node.textData?.characters ?? "",
    node.textData?.lines?.length,
  );
}

/**
 * Split TEXT into color runs from `characterStyleIDs` + `styleOverrideTable`
 * (how one node holds two colors). Overridden runs carry an explicit color;
 * base-fill runs inherit the element's `color`. One plain run when unstyled.
 */
function textStyleRuns(node: FigNode): TextRun[] {
  const chars = textCharacters(node);
  const ids = node.textData?.characterStyleIDs;
  const table = node.textData?.styleOverrideTable;
  if (!chars) return [];
  if (!ids || ids.length === 0 || !table || table.length === 0) {
    return [{ text: chars }];
  }
  const colorByStyle = new Map<number, string | undefined>();
  for (const entry of table) {
    if (entry?.styleID == null) continue;
    // Topmost visible solid in the override's fill list.
    let solid: Paint | undefined;
    for (const p of entry.fillPaints ?? []) {
      if (p.visible !== false && p.type === "SOLID") solid = p;
    }
    colorByStyle.set(
      entry.styleID,
      solid
        ? (colorToCss(solid.color, solid.opacity ?? 1) ?? undefined)
        : undefined,
    );
  }
  const runs: TextRun[] = [];
  let curText = "";
  let curColor: string | undefined;
  let started = false;
  for (let i = 0; i < chars.length; i++) {
    const color = colorByStyle.get(ids[i] ?? 0);
    if (!started) {
      curColor = color;
      started = true;
    } else if (color !== curColor) {
      runs.push({ text: curText, color: curColor });
      curText = "";
      curColor = color;
    }
    curText += chars[i];
  }
  if (curText) runs.push({ text: curText, color: curColor });
  return runs;
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
  // Kiwi spells Figma's "Space between" as SPACE_EVENLY; the REST API spells
  // the same setting SPACE_BETWEEN. Both appear in real files, and an
  // unmapped value fell through to `flex-start` — 17 rows on the Positivus
  // page and 98 on the Untitled UI kit packed to the left instead of
  // distributing.
  SPACE_EVENLY: "space-between",
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
  // Figma writes these with spaces — "Semi Bold", "Extra Bold", "Ultra Light" —
  // so matching only the joined spellings let "Semi Bold" fall past the 600
  // test to the plain `bold` one and render 700. On Untitled UI that is the
  // most common style on the page: 427 of 1046 text nodes came out too heavy.
  const s = style.toLowerCase().replace(/[^a-z]/g, "");
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
 * Figma writes an AUTO line height as `{ value: 100, units: "PERCENT" }`, and
 * that 100 is NOT a percentage of the font size — the REST API reports the same
 * nodes as `lineHeightUnit: "INTRINSIC_%"` with `lineHeightPercentFontSize:
 * null`, resolving 60px Space Grotesk to 76.56px rather than 60px. Treating it
 * as `100% * fontSize` made every auto-height text box ~28% short, so cards
 * shrank and the error accumulated down the page — 17px per row on the
 * Positivus landing page. `normal` is the CSS spelling of the same rule: use
 * the font's own metrics.
 *
 * The 100 sentinel is ambiguous with a line height a designer explicitly typed
 * as 100%, which Figma encodes identically. Nothing in the kiwi payload
 * separates them, and AUTO is overwhelmingly the common case.
 *
 * Any other percentage IS relative to the font size (REST: `FONT_SIZE_%`),
 * which is exactly what a CSS percentage line-height means, so it falls
 * through to the shared helper.
 */
function lineHeightCss(
  v: { value: number; units?: string } | undefined,
  fontSize?: number,
): string | number | null {
  if (v && v.units === "PERCENT" && v.value === 100) return "normal";
  return lengthFromUnits(v, fontSize);
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
  if (/^(?:https?:|blob:|about:|data:|file:)/i.test(filename)) return filename;
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

/**
 * Build the defs and the CSS property that reproduce a Figma mask node, in the
 * PARENT's coordinate space.
 *
 * Figma masks the siblings painted after the mask node, and the mask node
 * itself is never drawn — only its alpha is used. Ignoring that paints the
 * masked content at full size, which is how a 1153x703 rounded rectangle ended
 * up covering the Positivus contact form as a solid black box: the black
 * rectangle is real, and in Figma it is only visible through a starburst.
 *
 * Two shapes of mask, because Figma has two:
 *
 *  - A mask that PAINTS A FILL becomes a `<clipPath>`. Hard-edged geometry we
 *    already decode, and referencing an inline `<clipPath>` from an HTML
 *    element has long, uniform support.
 *  - A mask that only STROKES has no fill area at all. Filling its outline
 *    instead turns a fan of hairlines into a solid blob — the Positivus
 *    sunburst went from thin rays to a filled star that way. Those become an
 *    SVG `<mask>` with `fill="none"` and the stroke painted white, which is
 *    the one construct that can express a stroked alpha.
 *
 * Returns null when the mask has no geometry we can express, so the caller can
 * leave the run unmasked and say so.
 */
function maskMarkup(
  maskNode: FigNode,
  parent: FigNode | null,
  ctx: Ctx,
  id: string,
): { defs: string; css: string } | null {
  const t = maskNode.transform;
  // The mask's geometry is in its own local space; the run it clips lives in
  // the parent's. The node's relativeTransform is exactly that change of basis.
  const matrix = t
    ? `matrix(${num(t.m00)} ${num(t.m10)} ${num(t.m01)} ${num(t.m11)} ${num(t.m02)} ${num(t.m12)})`
    : "";
  const placement = matrix ? ` transform="${matrix}"` : "";
  // A vector NETWORK's coordinates are in `normalizedSize` space, not the
  // node's box — the same scale the vector renderer applies before drawing
  // one. Flattened `fillGeometry` is already in the node's box and takes no
  // scale. Without it a 553-unit blob was clipping a 98px avatar, so the mask
  // clipped nothing and a card's photo spilled across the whole card.
  const normalized = maskNode.vectorData?.normalizedSize;
  const scaleX = normalized?.x
    ? (maskNode.size?.x || normalized.x) / normalized.x
    : 1;
  const scaleY = normalized?.y
    ? (maskNode.size?.y || normalized.y) / normalized.y
    : 1;
  const networkPlacement =
    Math.abs(scaleX - 1) > 1e-6 || Math.abs(scaleY - 1) > 1e-6
      ? ` transform="${matrix ? `${matrix} ` : ""}scale(${num(scaleX)} ${num(scaleY)})"`
      : placement;
  const svgOpen = `<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">`;

  const shapes: string[] = [];
  for (const g of maskNode.fillGeometry ?? []) {
    if (typeof g.commandsBlob !== "number") continue;
    const d = decodePathCommands(ctx.blobs[g.commandsBlob]);
    if (!d) continue;
    const rule = g.windingRule === "ODD" ? ' clip-rule="evenodd"' : "";
    shapes.push(`<path d="${escapeHtmlAttr(d)}"${rule}${placement} />`);
  }

  if (!shapes.length) {
    // A mask drawn as an editable vector carries no flattened `fillGeometry`;
    // its shape only exists in the vector network.
    const networkBlob = maskNode.vectorData?.vectorNetworkBlob;
    const d =
      typeof networkBlob === "number"
        ? decodeVectorNetwork(ctx.blobs[networkBlob]).d
        : "";
    const strokeOnly =
      !(maskNode.fillPaints ?? []).some((p) => p.visible !== false) &&
      (maskNode.strokePaints ?? []).some((p) => p.visible !== false);
    const parentWidth = parent?.size?.x;
    const parentHeight = parent?.size?.y;
    if (d && strokeOnly && parentWidth && parentHeight) {
      // A standalone SVG document as a `mask-image` data URI, NOT `mask:
      // url(#id)` against an inline `<mask>`: Chrome ignores the fragment form
      // on an HTML element, which drops the declaration and paints the masked
      // run unmasked — measurably worse than no mask handling at all.
      const weight = maskNode.strokeWeight ?? 1;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${num(parentWidth)}" height="${num(parentHeight)}" ` +
        `viewBox="0 0 ${num(parentWidth)} ${num(parentHeight)}">` +
        // guard:allow-raw-color — in a mask image white IS the alpha channel ("keep this pixel"), not a themeable colour; a token would make the mask follow the viewer's theme and hide the content it reveals.
        `<path d="${d}"${networkPlacement} fill="none" stroke="#fff" stroke-width="${num(weight)}" /></svg>`;
      const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      return {
        defs: "",
        css:
          `mask-image:${url};mask-size:100% 100%;mask-repeat:no-repeat;` +
          `-webkit-mask-image:${url};-webkit-mask-size:100% 100%;-webkit-mask-repeat:no-repeat`,
      };
    }
    if (d) shapes.push(`<path d="${escapeHtmlAttr(d)}"${networkPlacement} />`);
  }

  if (!shapes.length) {
    // Rectangles and frames mask without carrying any path geometry.
    const w = maskNode.size?.x;
    const h = maskNode.size?.y;
    if (!w || !h) return null;
    const r = maskNode.cornerRadius;
    const rx = typeof r === "number" && r > 0 ? ` rx="${num(r)}"` : "";
    shapes.push(
      `<rect x="0" y="0" width="${num(w)}" height="${num(h)}"${rx}${placement} />`,
    );
  }
  return {
    defs:
      `${svgOpen}<clipPath id="${escapeHtmlAttr(id)}" clipPathUnits="userSpaceOnUse">` +
      `${shapes.join("")}</clipPath></svg>`,
    css: `clip-path:url(#${id})`,
  };
}

/**
 * A mask shape only clips cleanly when it is fully opaque. Anything that makes
 * its alpha vary across the shape produces a soft edge in Figma that a
 * `clip-path` cannot reproduce.
 */
function maskHasSoftAlpha(maskNode: FigNode): boolean {
  if (typeof maskNode.opacity === "number" && maskNode.opacity < 1) return true;
  return (maskNode.fillPaints ?? []).some(
    (paint) =>
      paint.visible !== false &&
      (paint.type !== "SOLID" || (paint.opacity ?? 1) < 1),
  );
}

/**
 * True when an ELLIPSE sweeps a full turn with no inner radius — i.e. a plain
 * ellipse that `border-radius: 50%` reproduces exactly. Figma writes the sweep
 * in radians, and a full circle comes through as 6.2831854820251465 rather
 * than exactly 2*PI, so the comparison has to carry a tolerance.
 */
function isFullTurnArc(arc: FigNode["arcData"]): boolean {
  if (!arc) return true;
  if ((arc.innerRadius ?? 0) > 1e-6) return false;
  const sweep = Math.abs((arc.endingAngle ?? 0) - (arc.startingAngle ?? 0));
  return sweep >= Math.PI * 2 - 1e-3;
}

/**
 * Build the outline of a STAR or REGULAR_POLYGON from its parameters.
 *
 * A clipboard payload gives these shapes no flattened `fillGeometry` and no
 * vector network — just `count` and `starInnerScale` — so without this they
 * have no drawable geometry at all and get dropped. Positivus' CTA
 * illustration lost its ten-point starburst that way. Figma fits the shape to
 * the node's box, so the radii are the half-extents and the first point is at
 * twelve o'clock.
 */
/**
 * A rectangle's outline, corners included.
 *
 * Figma's vector network stores a rectangle-derived VECTOR as its four corner
 * points and drops the rounding, which is carried on the node instead — so a
 * decoded network draws a speech bubble with square corners where Figma draws
 * radius 45. Size plus the four radii describe the shape exactly.
 */
function roundedRectanglePath(node: FigNode): string | null {
  const w = node.size?.x;
  const h = node.size?.y;
  if (!w || !h) return null;
  const corner = (value: number | undefined) =>
    Math.max(0, value ?? node.cornerRadius ?? 0);
  let tl = corner(node.rectangleTopLeftCornerRadius);
  let tr = corner(node.rectangleTopRightCornerRadius);
  let br = corner(node.rectangleBottomRightCornerRadius);
  let bl = corner(node.rectangleBottomLeftCornerRadius);
  // Figma scales every radius down together when neighbours would overlap.
  const fit = Math.min(
    1,
    w / (tl + tr),
    w / (bl + br),
    h / (tl + bl),
    h / (tr + br),
  );
  if (Number.isFinite(fit) && fit < 1) {
    tl *= fit;
    tr *= fit;
    br *= fit;
    bl *= fit;
  }
  const arc = (r: number, x: number, y: number) =>
    r > 0
      ? `A${num(r)} ${num(r)} 0 0 1 ${num(x)} ${num(y)}`
      : `L${num(x)} ${num(y)}`;
  return (
    `M${num(tl)} 0 L${num(w - tr)} 0 ${arc(tr, w, tr)} ` +
    `L${num(w)} ${num(h - br)} ${arc(br, w - br, h)} ` +
    `L${num(bl)} ${num(h)} ${arc(bl, 0, h - bl)} ` +
    `L0 ${num(tl)} ${arc(tl, tl, 0)} Z`
  );
}

/**
 * The rounded rectangle a node still describes itself as, when its own
 * geometry would lose the rounding. Only when a radius is actually set: a
 * square-cornered rectangle's decoded network is already right.
 */
function roundedRectangleOverride(node: FigNode): string | null {
  if (node.rectangleTopLeftCornerRadius === undefined) return null;
  const radii = [
    node.rectangleTopLeftCornerRadius,
    node.rectangleTopRightCornerRadius,
    node.rectangleBottomRightCornerRadius,
    node.rectangleBottomLeftCornerRadius,
  ];
  if (!radii.some((radius) => (radius ?? 0) > 0)) return null;
  return roundedRectanglePath(node);
}

function parametricShapePath(node: FigNode): string | null {
  const w = node.size?.x;
  const h = node.size?.y;
  // A Figma LINE is always the straight segment (0,0) -> (size.x, 0) in its
  // own space, so its shape is fully known without any geometry at all. The
  // clipboard ships neither flattened geometry nor a vector network for one,
  // and every rule on the page was being dropped as "no decodable geometry" —
  // ten of them on the Positivus page, including the divider under each
  // process step. Its zero height is also why the `!w || !h` guard below has
  // to come after this.
  if (node.type === "LINE") {
    const length = w ?? h;
    if (!length) return null;
    return h === 0 || h === undefined
      ? `M0 0 L${num(length)} 0`
      : `M0 0 L0 ${num(h)}`;
  }
  if (!w || !h) return null;
  const cx = w / 2;
  const cy = h / 2;
  const points: string[] = [];
  const at = (angle: number, rx: number, ry: number) =>
    `${num(cx + rx * Math.cos(angle))} ${num(cy + ry * Math.sin(angle))}`;

  if (node.type === "REGULAR_POLYGON") {
    const sides = node.count ?? 3;
    if (sides < 3 || sides > 1000) return null;
    for (let i = 0; i < sides; i++) {
      points.push(at(-Math.PI / 2 + (i * 2 * Math.PI) / sides, cx, cy));
    }
  } else if (node.type === "STAR") {
    const tips = node.count ?? 5;
    if (tips < 3 || tips > 1000) return null;
    const inner = node.starInnerScale ?? 0.382;
    for (let i = 0; i < tips * 2; i++) {
      const outer = i % 2 === 0;
      points.push(
        at(
          -Math.PI / 2 + (i * Math.PI) / tips,
          outer ? cx : cx * inner,
          outer ? cy : cy * inner,
        ),
      );
    }
  } else {
    return null;
  }
  return `M${points.join(" L")} Z`;
}

/** Record one fidelity note against a node the renderer could not reproduce exactly. */
function recordApproximation(node: FigNode, ctx: Ctx, note: string): void {
  ctx.approximatedNodes.push({
    nodeId: guidKey(node.guid),
    nodeName: node.name,
    nodeType: node.type,
    notes: [note],
  });
}

function paintToBackground(p: Paint, node: FigNode, ctx: Ctx): string | null {
  if (p.visible === false) return null;
  if (p.type === "SOLID") {
    const color = colorToCss(p.color, p.opacity ?? 1);
    return color ? `linear-gradient(${color}, ${color})` : null;
  }
  if (p.type?.startsWith("GRADIENT") && Array.isArray(p.stops)) {
    const box = node.size ? { width: node.size.x, height: node.size.y } : null;
    const kind = p.type.slice("GRADIENT_".length) as
      | "LINEAR"
      | "RADIAL"
      | "ANGULAR"
      | "DIAMOND";
    const geometry =
      p.transform && box
        ? gradientGeometryFromTransform(kind, p.transform, box)
        : null;
    const stopPosition =
      geometry && kind === "LINEAR" && box
        ? remapLinearStopPosition(
            geometry.handles,
            box,
            gradientAngleDegreesFromHandles(geometry.handles, box),
          )
        : (position: number) => position;
    const stops = p.stops
      .map(
        (s) =>
          `${colorToCss(s.color, p.opacity ?? 1)} ${num(stopPosition(s.position) * 100)}%`,
      )
      .join(", ");
    if (p.type === "GRADIENT_LINEAR") {
      if (geometry && box) {
        const angle = gradientAngleDegreesFromHandles(geometry.handles, box);
        return `linear-gradient(${num(angle)}deg, ${stops})`;
      }
      return `linear-gradient(${stops})`;
    }
    if (p.type === "GRADIENT_RADIAL") {
      if (geometry) {
        return `radial-gradient(ellipse ${num(geometry.rx)}px ${num(geometry.ry)}px at ${num(geometry.center.x)}px ${num(geometry.center.y)}px, ${stops})`;
      }
      return `radial-gradient(${stops})`;
    }
    if (p.type === "GRADIENT_ANGULAR") {
      // Figma sweeps an angular gradient in the node's NORMALIZED space — the
      // box treated as a unit square, then stretched — while CSS
      // `conic-gradient()` sweeps at a true uniform angular rate in real
      // pixels. The two agree only on the axes, so on a non-square box the
      // mid-sweep colours land early. The REST walker draws the sweep into a
      // square and scales that square, which needs an overlay element rather
      // than a background layer; here it is reported instead of silently off.
      if (box && Math.abs(box.width - box.height) > 0.5) {
        recordApproximation(
          node,
          ctx,
          "GRADIENT_ANGULAR on a non-square box swept in pixel space; Figma sweeps it in the node's normalized space, so mid-sweep colours land early",
        );
      }
      if (geometry) {
        return `conic-gradient(from ${num(geometry.fromDeg)}deg at ${num(geometry.center.x)}px ${num(geometry.center.y)}px, ${stops})`;
      }
      return `conic-gradient(${stops})`;
    }
    if (p.type === "GRADIENT_DIAMOND") {
      recordApproximation(
        node,
        ctx,
        "GRADIENT_DIAMOND approximated as an ellipse; its falloff is an L1 distance, so Figma draws a four-pointed star. The REST walker reproduces it exactly with four quadrant-tiled linear gradients",
      );
      return `radial-gradient(${stops})`;
    }
  }
  if (p.type === "IMAGE") {
    const hex = hashToHex(p.image?.hash);
    if (hex) {
      const u = imageUrl(hex, ctx);
      return `url('${u.replace(/'/g, "%27")}')`;
    }
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
  backgroundBlendMode?: string;
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
    backgroundBlendMode?: string;
  } = {};
  // Optimization: when there is exactly one fill and it's a plain SOLID at the
  // bottom, emit it as `background-color` (cheaper CSS, same visual) and skip
  // adding it to the bgImages layer list so we don't double-render it.
  const isSingleSolidOnly = fills.length === 1 && fills[0]?.type === "SOLID";
  if (isSingleSolidOnly) {
    const color = colorToCss(fills[0]!.color, fills[0]!.opacity ?? 1);
    if (color) result.backgroundColor = color;
    return result;
  }
  const bgImages: string[] = [];
  const bgSizes: string[] = [];
  const bgPositions: string[] = [];
  const bgRepeats: string[] = [];
  const bgBlends: string[] = [];
  for (const f of fills) {
    // A diamond needs FOUR tiles plus a clamp, not one layer.
    const diamond =
      f.type === "GRADIENT_DIAMOND"
        ? diamondBackgroundLayers(f, node, ctx)
        : null;
    if (diamond) {
      // The stack is assembled bottom-first and reversed at the end, so this
      // fill's own layers go in bottom-first too — otherwise the clamp layer
      // ends up ON TOP and paints over the four tiles it exists to sit under.
      for (const layer of [...diamond].reverse()) {
        bgImages.push(layer.image);
        bgBlends.push(blendModeCss(f.blendMode) ?? "normal");
        bgSizes.push(layer.size);
        bgPositions.push(layer.position);
        bgRepeats.push(layer.repeat);
      }
      continue;
    }
    const image = paintToBackground(f, node, ctx);
    if (!image) continue;
    // A CSS background LAYER has no opacity of its own. `colorToCss` folds a
    // solid's or a gradient's opacity into its alpha, but an image URL has
    // nowhere to carry one, so a half-transparent photo would paint solid and
    // hide whatever it is stacked over. Rare — zero of the four real designs
    // measured, one synthetic fixture — but silent is what made it worth
    // saying rather than fixing with an overlay element nothing needs yet.
    if (f.type === "IMAGE" && (f.opacity ?? 1) < 1) {
      recordApproximation(
        node,
        ctx,
        `IMAGE fill opacity ${f.opacity} dropped: a CSS background layer carries no opacity, so this image paints solid over the fills beneath it`,
      );
    }
    bgImages.push(image);
    bgBlends.push(blendModeCss(f.blendMode) ?? "normal");
    if (f.type !== "IMAGE") {
      bgSizes.push("auto");
      bgPositions.push("0% 0%");
      bgRepeats.push("repeat");
      continue;
    }
    const mode = f.imageScaleMode ?? "FILL";
    if (mode === "FILL") bgSizes.push("cover");
    else if (mode === "FIT") bgSizes.push("contain");
    else if (mode === "STRETCH") bgSizes.push("100% 100%");
    else bgSizes.push("auto");
    bgPositions.push(mode === "TILE" ? "0% 0%" : "center");
    bgRepeats.push(mode === "TILE" ? "repeat" : "no-repeat");
  }
  bgImages.reverse();
  bgSizes.reverse();
  bgPositions.reverse();
  bgRepeats.reverse();
  bgBlends.reverse();
  if (bgImages.length > 0) {
    result.backgroundImage = bgImages.join(", ");
    result.backgroundSize = bgSizes.join(", ");
    result.backgroundPosition = bgPositions.join(", ");
    result.backgroundRepeat = bgRepeats.join(", ");
    if (bgBlends.some((blend) => blend !== "normal")) {
      result.backgroundBlendMode = bgBlends.join(", ");
    }
  }
  return result;
}

/**
 * A Figma diamond gradient as the four-pointed shape it actually is.
 *
 * Its falloff is an L1 distance, which is LINEAR inside each quadrant — so
 * four quadrant-tiled linear gradients reproduce it exactly, where an ellipse
 * only resembles it. The same construction the REST walker uses.
 *
 * Returns the background layers top-first, or null when the paint carries no
 * usable geometry.
 */
function diamondBackgroundLayers(
  p: Paint,
  node: FigNode,
  ctx: Ctx,
): BackgroundLayer[] | null {
  const box = node.size ? { width: node.size.x, height: node.size.y } : null;
  if (!box || !p.transform || !p.stops?.length) return null;
  const geometry = gradientGeometryFromTransform("DIAMOND", p.transform, box);
  if (!geometry || !(geometry.rx > 0) || !(geometry.ry > 0)) return null;
  const { rx, ry, center } = geometry;
  // Each tile spans one quadrant, so a stop at 1 sits on the tile's far edge.
  const stops = p.stops
    .map(
      (stop) =>
        `${colorToCss(stop.color, p.opacity ?? 1)} ${num((stop.position / 2) * 100)}%`,
    )
    .join(", ");
  const angle = (Math.atan2(ry, rx) * 180) / Math.PI;
  const size = `${num(rx)}px ${num(ry)}px`;
  const layers: BackgroundLayer[] = [
    { angle: 360 - angle, left: center.x - rx, top: center.y - ry },
    { angle, left: center.x, top: center.y - ry },
    { angle: 180 - angle, left: center.x, top: center.y },
    { angle: 180 + angle, left: center.x - rx, top: center.y },
  ].map((quadrant) => ({
    image: `linear-gradient(${num(quadrant.angle)}deg, ${stops})`,
    size,
    position: `${num(quadrant.left)}px ${num(quadrant.top)}px`,
    repeat: "no-repeat",
  }));
  // The tiles only cover the diamond's bounding box; Figma clamps to the final
  // stop everywhere beyond it, so a flat layer of that colour sits underneath.
  const last = p.stops[p.stops.length - 1];
  const clamp = last
    ? (colorToCss(last.color, p.opacity ?? 1) ?? "transparent")
    : "transparent";
  layers.push({
    image: `linear-gradient(${clamp}, ${clamp})`,
    size: "100% 100%",
    position: "center",
    repeat: "no-repeat",
  });
  recordApproximation(
    node,
    ctx,
    "GRADIENT_DIAMOND drawn as four quadrant-tiled linear gradients — the same shape Figma draws, since its falloff is linear within each quadrant",
  );
  return layers;
}

/** One resolved background layer. */
interface BackgroundLayer {
  image: string;
  size: string;
  position: string;
  repeat: string;
}

function borderShorthand(node: FigNode, ctx: Ctx): Record<string, string> {
  const strokes = (effectiveStrokePaints(node, ctx) ?? []).filter(
    (p) => p.visible !== false,
  );
  if (strokes.length === 0) return {};
  const first = strokes[0]!;
  const color = colorToCss(first.color, first.opacity ?? 1);
  if (!color) return {};

  const hasPerSide =
    node.strokeTopWeight !== undefined ||
    node.strokeRightWeight !== undefined ||
    node.strokeBottomWeight !== undefined ||
    node.strokeLeftWeight !== undefined;

  const uniformW = node.strokeWeight ?? 0;

  // A dash pattern only reaches CSS through `border-style`/`outline-style`.
  const dashed = dashArrayAttr(node) !== null;
  const style = dashed ? "dashed" : "solid";

  if (!hasPerSide) {
    if (!uniformW) return {};
    if (node.strokeAlign === "OUTSIDE") {
      return { outline: `${num(uniformW)}px ${style} ${color}` };
    }
    if (node.strokeAlign === "INSIDE") {
      // A box-shadow keeps the border inside the element without expanding its
      // dimensions — but it cannot be dashed. A leaf has no content whose box
      // an inset border could shift, and `box-sizing: border-box` keeps the
      // outer size, so a dashed leaf takes a real border instead.
      if (dashed && getChildren(node, ctx).length === 0) {
        return { border: `${num(uniformW)}px dashed ${color}` };
      }
      if (dashed) {
        recordApproximation(
          node,
          ctx,
          "dashed INSIDE stroke on a node with children drawn solid; an inset box-shadow cannot be dashed, and a real border would shrink the content box Figma leaves alone",
        );
      }
      return { boxShadow: `inset 0 0 0 ${num(uniformW)}px ${color}` };
    }
    return { border: `${num(uniformW)}px ${style} ${color}` };
  }
  if (dashed) {
    recordApproximation(
      node,
      ctx,
      "dashed stroke with per-side weights drawn solid",
    );
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
      filters.push(`blur(${num((e.radius ?? 0) / 2)}px)`);
    } else if (e.type === "BACKGROUND_BLUR") {
      backdropBlur = `blur(${num((e.radius ?? 0) / 2)}px)`;
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
  const determinant = t.m00 * t.m11 - t.m01 * t.m10;
  const hasNonTrivialScale = Math.abs(Math.abs(determinant) - 1) > 0.01;
  const angle = Math.atan2(t.m10, t.m00);
  const isPureRotation =
    Math.abs(t.m00 - Math.cos(angle)) < 0.01 &&
    Math.abs(t.m01 + Math.sin(angle)) < 0.01 &&
    Math.abs(t.m10 - Math.sin(angle)) < 0.01 &&
    Math.abs(t.m11 - Math.cos(angle)) < 0.01;
  // Anything that is not a pure rotation has to go through the matrix. The
  // previous guard asked only about scale and skew, and `hasNonTrivialScale`
  // compares |determinant|, which erases the SIGN — so a mirror (m00 = -1,
  // m11 = 1: determinant -1, no off-diagonal terms) satisfied neither branch
  // and fell through to `rotate(180deg)`. A 180 degree rotation about the
  // top-left corner moves a box up and left by its own size, which is how
  // Positivus' flipped CTA illustration ended up 394px above its frame.
  if (hasNonTrivialScale || !isPureRotation) {
    return {
      transform: `matrix(${num(t.m00)}, ${num(t.m10)}, ${num(t.m01)}, ${num(t.m11)}, 0, 0)`,
      transformOrigin: "0 0",
    };
  }
  const deg = (angle * 180) / Math.PI;
  if (Math.abs(deg) < 0.01) return {};
  return { transform: `rotate(${num(deg)}deg)`, transformOrigin: "top left" };
}

/**
 * Figma CLAMPS a negative `stackSpacing` so the children still fill a
 * fixed-size container: the CTA row on the Positivus landing page asks for
 * -715px between a 1240px card and a 494px illustration inside a 1240px
 * content box, and Figma lays the illustration out at x=846 (flush with the
 * card's right edge), not at 625 as a literal -715 would put it —
 * 1240 + 494 - 494 = 1240 exactly fills the box.
 *
 * That clamp distributes the slack evenly between the children, which is
 * precisely `justify-content: space-between`. When the requested spacing
 * genuinely overflows the container there is no slack to distribute, Figma
 * uses the literal value, and the negative margins in `buildCss` carry it.
 */
function overlapSpacing(node: FigNode, ctx: Ctx): number | null {
  const spacing = node.stackSpacing;
  if (typeof spacing !== "number" || spacing >= 0) return null;
  const horizontal = node.stackMode === "HORIZONTAL";
  // Only a fixed primary axis has a container to fill; a hugging one resizes
  // around whatever the overlap produces, so the literal value stands.
  if ((node.stackPrimarySizing ?? "RESIZE_TO_FIT") !== "FIXED") return spacing;
  const total = horizontal ? node.size?.x : node.size?.y;
  if (!total) return spacing;
  // Start side is `stackHorizontalPadding`/`stackVerticalPadding`; the end side
  // is its own field and is absent when zero. See `autolayoutStyles`.
  const padStart = horizontal
    ? (node.stackHorizontalPadding ?? 0)
    : (node.stackVerticalPadding ?? 0);
  const padEnd = horizontal
    ? (node.stackPaddingRight ?? 0)
    : (node.stackPaddingBottom ?? 0);
  const available = total - padStart - padEnd;
  const children = getChildren(node, ctx).filter(
    (child) => child.visible !== false && child.stackPositioning !== "ABSOLUTE",
  );
  if (children.length < 2) return spacing;
  let sum = 0;
  for (const child of children) {
    const size = horizontal ? child.size?.x : child.size?.y;
    // An unknown child size makes the clamp meaningless; do not guess at it.
    if (typeof size !== "number") return spacing;
    sum += size;
  }
  const fill = (available - sum) / (children.length - 1);
  return Math.max(spacing, fill);
}

function autolayoutStyles(
  node: FigNode,
  ctx: Ctx,
): Record<string, string | number> {
  if (!node.stackMode || node.stackMode === "NONE") return {};
  const out: Record<string, string | number> = {
    display: "flex",
    flexDirection: node.stackMode === "VERTICAL" ? "column" : "row",
  };
  if (node.stackPrimaryAlignItems)
    out.justifyContent =
      STACK_ALIGN[node.stackPrimaryAlignItems] ?? "flex-start";
  // Always emitted, because the two defaults disagree: Figma's counter
  // alignment defaults to MIN, CSS's `align-items` to `stretch`. Leaving it
  // unset let every child of an unaligned stack grow to the full width — a
  // 195px "Read more" button came out 695px, and its whole section with it.
  out.alignItems =
    STACK_ALIGN[node.stackCounterAlignItems ?? "MIN"] ?? "flex-start";
  // A negative `stackSpacing` overlaps the children. CSS rejects a negative
  // `gap` outright, which drops the declaration and silently falls back to 0,
  // overflowing the stack; the overlap is applied as a negative margin on the
  // children instead (see `buildCss`).
  //
  // Under SPACE_BETWEEN, Figma ignores the spacing entirely — the field is
  // disabled and the gap comes from the free space — but it still stores the
  // last value set. CSS treats `gap` as a MINIMUM that space-between then
  // distributes on top of, so emitting both spaces the row by the stale
  // number: Positivus' logo row came out at 206px instead of its real 96px on
  // the REST path, pushing the last logo 550px out of the frame.
  const primaryDistributes =
    node.stackPrimaryAlignItems === "SPACE_EVENLY" ||
    node.stackPrimaryAlignItems === "SPACE_BETWEEN";
  // A wrapping stack runs onto more than one line, and Figma keeps the gap
  // BETWEEN those lines in its own field. Without the wrap the row simply
  // stayed one line: a 380x54 two-line tag row came out 380x23, with the tags
  // that should have wrapped sitting 360px off the right edge instead.
  const wraps = node.stackWrap === "WRAP";
  if (wraps) out.flexWrap = "wrap";
  const spacing =
    typeof node.stackSpacing === "number" &&
    node.stackSpacing > 0 &&
    !primaryDistributes
      ? node.stackSpacing
      : null;
  const lineSpacing =
    wraps &&
    typeof node.stackCounterSpacing === "number" &&
    node.stackCounterSpacing > 0
      ? node.stackCounterSpacing
      : null;
  if (lineSpacing !== null)
    out.gap = `${num(lineSpacing)}px ${num(spacing ?? 0)}px`;
  else if (spacing !== null) out.gap = `${num(spacing)}px`;
  // `stackHorizontalPadding` and `stackVerticalPadding` are the LEFT and TOP
  // fields, not symmetric shorthands — the end sides live in
  // `stackPaddingRight` / `stackPaddingBottom`, which kiwi omits when they are
  // 0. Mirroring the start side into a missing end side invented padding on
  // every top-only or left-only frame: Untitled UI's hero section came out
  // 1036px tall against Figma's 940, and every section below it sat 96px low.
  //
  // Measured across four captured payloads: `stackPaddingLeft` and
  // `stackPaddingTop` never appear at all, and of 1655 nodes carrying a
  // vertical padding 1603 also carry an explicit bottom — so kiwi does NOT
  // drop the end side when it happens to match. Absent means zero.
  const pl = node.stackHorizontalPadding;
  const pr = node.stackPaddingRight;
  const pt = node.stackVerticalPadding;
  const pb = node.stackPaddingBottom;
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
    const fam = fontName.family;
    const quoted = /\s/.test(fam) ? `"${fam}"` : fam;
    // Append a metric-compatible fallback stack by classifying the family.
    // This prevents UA serif from appearing when a Google/system font is missing.
    const famLower = fam.toLowerCase();
    let fallback: string;
    if (
      /mono|courier|code|consol|menlo|fira code|source code/i.test(famLower)
    ) {
      fallback =
        "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
    } else if (
      /serif|georgia|garamond|didot|baskerville|palatino|times/i.test(famLower)
    ) {
      fallback = "'Times New Roman', Georgia, Garamond, serif";
    } else {
      fallback =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
    }
    out.fontFamily = `${quoted}, ${fallback}`;
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
  const lh = lineHeightCss(lineHeight, fontSize);
  if (lh !== null && lh !== undefined) out.lineHeight = lh;
  const ls = lengthFromUnits(letterSpacing, fontSize);
  if (ls !== null && ls !== undefined) out.letterSpacing = ls;
  if (textAlignHorizontal)
    out.textAlign = TEXT_ALIGN[textAlignHorizontal] ?? "left";
  // Figma's own casing and decoration, which this walker was dropping: the
  // typography fixture's underline, strikethrough and uppercase label all
  // rendered as plain lower-case text. Same mappings the REST walker uses.
  const textCase = styleNode?.textCase ?? node.textCase;
  const textDecoration = styleNode?.textDecoration ?? node.textDecoration;
  const transform = textTransformCss(textCase as never);
  if (transform) out.textTransform = transform;
  const decoration = textDecorationCss(textDecoration as never);
  if (decoration) out.textDecoration = decoration;
  const fills = (
    ctx ? effectiveFillPaints(node, ctx) : node.fillPaints
  )?.filter((fill) => fill.visible !== false);
  if (!fills?.length) {
    out.visibility = "hidden";
    return out;
  }
  const firstFill = fills[0]!;
  if (firstFill.type === "SOLID") {
    const color = colorToCss(firstFill.color, firstFill.opacity ?? 1);
    if (color) out.color = color;
  } else if (
    ctx &&
    (firstFill.type?.startsWith("GRADIENT_") || firstFill.type === "IMAGE")
  ) {
    const background = paintToBackground(firstFill, node, ctx);
    if (background) {
      out.background = background;
      out.WebkitBackgroundClip = "text";
      out.backgroundClip = "text";
      out.color = "transparent";
    }
  }
  return out;
}

function blendModeCss(mode: string | undefined): string | null {
  if (!mode) return null;
  const result = cssBlendMode(mode);
  return result?.cssMode ?? null;
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

  // 2) Non-autolayout frames (e.g. Figma groups) position their children
  //    absolutely in this renderer, and CSS `width/height: auto` cannot hug
  //    out-of-flow children — a hugged group would collapse to 0×0 and clip
  //    everything inside it. The baked `node.size` already equals the group's
  //    content bounds, so keep it FIXED rather than honoring `resizeToFit`.

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
    // A FILL child inside a parent that HUGS the same axis has nothing to
    // fill, and Figma falls back to the child's own size. CSS instead resolves
    // the circle — parent sizes to child, child stretches to parent — down to
    // the content. A dashboard's table cells are a FIXED 121 wide and stretch
    // inside a hugging column: the column came out 103, its text's width, and
    // took all eight cells with it. `layoutSizing(parent, null)` is the
    // parent's OWN sizing, which is exactly the question being asked.
    const parentSelf = layoutSizing(parent, null);
    // The node's OWN hug wins over the parent's stretch. Figma treats "hug
    // contents" and "fill container" as mutually exclusive on an axis, so a
    // node carrying both has a stale `stackChildAlignSelf` from an earlier
    // state — and honouring the stale one pins a frame that should grow. A
    // dashboard's main column hugs its 1066px of content inside a 960px
    // frame; stretching it cut 106px off the bottom.
    if (parent.stackMode === "HORIZONTAL") {
      if (grow && parentSelf.horizontal !== "HUG" && horizontal !== "HUG")
        horizontal = "FILL";
      if (stretch && parentSelf.vertical !== "HUG" && vertical !== "HUG")
        vertical = "FILL";
    } else {
      if (grow && parentSelf.vertical !== "HUG" && vertical !== "HUG")
        vertical = "FILL";
      if (stretch && parentSelf.horizontal !== "HUG" && horizontal !== "HUG")
        horizontal = "FILL";
    }
  }

  return { horizontal, vertical };
}

/**
 * Re-lay a master's children for an INSTANCE that was resized.
 *
 * An instance can be a different size from the component it came from, and
 * Figma re-lays the master's children according to each one's constraint. We
 * inlined them at the MASTER's geometry instead, so a resized instance drew its
 * contents at the wrong size: DashStack's dashboard has a 1440-wide instance of
 * a 1202-wide component, and the full-bleed background rectangle inside it
 * (`horizontalConstraint: SCALE`) painted only the first 1202px, leaving 238px
 * of bare white down the right edge of every screen.
 *
 * Fixing it here, once, at the inline boundary means every downstream consumer
 * — CSS, masks, auto-layout, the export walk — sees geometry that is already
 * correct, instead of each of them having to know about the resize.
 *
 * Children are shared: the same master is inlined by every instance of it, so
 * they are cloned rather than mutated.
 */
function resizeInlinedSymbolChildren(
  children: FigNode[],
  symbol: FigNode,
  instance: FigNode,
  ctx: Ctx,
): FigNode[] {
  const mw = symbol.size?.x;
  const mh = symbol.size?.y;
  const iw = instance.size?.x;
  const ih = instance.size?.y;
  if (!mw || !mh || !iw || !ih) return children;
  const dx = iw - mw;
  const dy = ih - mh;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return children;
  const sx = mw ? iw / mw : 1;
  const sy = mh ? ih / mh : 1;

  return children.map((child) => {
    const t = child.transform;
    const size = child.size;
    if (!t || !size) return child;
    // Figma's default when a node carries no constraint is MIN — pinned to the
    // start edge at its own size — which is what leaving it alone produces.
    const axis = (
      constraint: string | undefined,
      pos: number,
      extent: number,
      delta: number,
      scale: number,
    ): { pos: number; extent: number; scaled: boolean } => {
      switch (constraint) {
        case "SCALE":
          return { pos: pos * scale, extent: extent * scale, scaled: true };
        case "STRETCH":
          return { pos, extent: extent + delta, scaled: false };
        case "MAX":
          return { pos: pos + delta, extent, scaled: false };
        case "CENTER":
          return { pos: pos + delta / 2, extent, scaled: false };
        default:
          return { pos, extent, scaled: false };
      }
    };
    const h = axis(child.horizontalConstraint, t.m02, size.x, dx, sx);
    const v = axis(child.verticalConstraint, t.m12, size.y, dy, sy);
    if (
      (h.scaled || v.scaled) &&
      (ctx.childrenOf.get(guidKey(child.guid))?.length ?? 0) > 0
    ) {
      // SCALE scales the whole subtree in Figma. Scaling only this box leaves
      // its descendants at the master's geometry inside a resized parent, so
      // say so rather than let the difference pass as exact.
      recordApproximation(
        child,
        ctx,
        `SCALE constraint on a container in a resized instance; its descendants keep the component's geometry`,
      );
    }
    return {
      ...child,
      transform: { ...t, m02: h.pos, m12: v.pos },
      size: { x: h.extent, y: v.extent },
    };
  });
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

function positionRelativeToParent(
  node: FigNode,
  parent: FigNode | null,
  ctx: Ctx,
): { x: number | null; y: number | null } {
  const transform = node.transform;
  if (!transform) return { x: null, y: null };
  // Figma/Kiwi node transforms are already expressed relative to the parent
  // (the node's `relativeTransform`), so the translation is the parent-local
  // offset at every depth — including direct children of a top-level frame,
  // whose own canvas position is dropped when the frame becomes a screen root.
  // Subtracting the parent's canvas translation here double-counts the frame
  // offset and flings direct children off-canvas.
  return { x: num(transform.m02), y: num(transform.m12) };
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
    const { x, y } = positionRelativeToParent(node, parent, ctx);
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
  // HUG means "size to content", so it only holds when there IS content.
  // Figma keeps a childless auto-layout frame at the size it resolved rather
  // than collapsing it, and the baked `node.size` is that size; letting CSS
  // hug nothing collapses the box to 0x0 and deletes it from the render.
  const hugsNothing =
    node.type !== "TEXT" && getChildren(node, ctx).length === 0;
  const emitWidth =
    sizing.horizontal === "FIXED" ||
    (sizing.horizontal === "HUG" && hugsNothing);
  const emitHeight =
    sizing.vertical === "FIXED" || (sizing.vertical === "HUG" && hugsNothing);

  if (node.size) {
    const w = num(node.size.x);
    const h = num(node.size.y);
    if (w !== null && emitWidth && !suppressWidth) css.width = `${w}px`;
    if (h !== null && emitHeight && !suppressHeight) css.height = `${h}px`;
  }

  // A hugging TEXT box takes the size Figma resolved for it, the same way the
  // REST walker does. Figma rounds these to whole pixels and lays the siblings
  // out against the rounded number, and where our advances differ by a hair a
  // line wraps on one side and not the other — a 40px two-line label came out
  // A hugging TEXT box takes the size Figma resolved for it as a MINIMUM, the
  // same way the REST walker does: Figma rounds these to whole pixels and lays
  // the siblings out against the rounded number, and where our advances differ
  // by a hair a line wraps on one side and not the other. A 40px two-line label
  // came out 20px and pulled everything under it up — 90 of the 93 nodes this
  // walker had off by more than 1.5px on one page.
  //
  // A minimum, never a fixed size — this is where the two walkers genuinely
  // differ. REST reads `absoluteBoundingBox`, Figma's RESOLVED layout box,
  // which is always current. Kiwi `size` is the STORED size, and for a
  // descendant of an instance this walker could not fully resolve it is the
  // master's, not the instance's. Pinning that is a hard error: it dropped
  // Positivus' service headings 30px (4.25% -> 4.53%). As a minimum the same
  // stale number degrades instead of dictating, and both paths improve.
  if (node.type === "TEXT" && node.size) {
    const hugsWidth = sizing.horizontal === "HUG";
    const hugsHeight = sizing.vertical === "HUG";
    const w = num(node.size.x);
    const h = num(node.size.y);
    if (hugsWidth && w !== null && !suppressWidth && !css.width) {
      css.minWidth = `${w}px`;
    }
    // Only where the text can WRAP. A minimum here guards against our line
    // count differing from Figma's; text hugging both axes cannot wrap, so it
    // has nothing to guard — and giving it one lets a stale stored size push
    // its siblings, which is exactly what dropped Positivus' headings 30px.
    // Text hugging BOTH axes cannot wrap, so its line count is fixed by the
    // break characters and its height is Figma's `round(lines * lineHeight)`
    // exactly — taken outright, not as a minimum, because the browser's own
    // line box rounds the other way and every such label came out 1px tall
    // over. On the auto-layout fixture that 1px moved all 29 nodes.
    //
    // Wrapping text keeps a MINIMUM: there our line count genuinely can differ
    // from Figma's, and a stale stored size must degrade rather than dictate.
    if (hugsHeight && h !== null && !suppressHeight && !css.height) {
      if (hugsWidth) css.height = `${h}px`;
      else css.minHeight = `${h}px`;
    }
  }

  // Line vectors (horizontal/vertical strokes) have a 0-size axis. A 0-size
  // <svg> viewport is dropped by the browser even with `overflow: visible`, so
  // give the degenerate axis a minimal non-zero size; the stroke, arrowheads,
  // and caps still paint at native coords because the SVG has no viewBox here.
  if (vectorLike) {
    const minAxis = Math.max(1, num(node.strokeWeight) ?? 1);
    if (css.width === "0px") css.width = `${minAxis}px`;
    if (css.height === "0px") css.height = `${minAxis}px`;
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
      // A growing child whose parent HUGS the same axis has nothing to grow
      // into, and Figma falls back to the child's own size. `flex: 1 0 0` in an
      // auto-sized flex container collapses it to zero instead, which silently
      // deletes the child and pulls every later sibling up by its size.
      const parentPrimaryHug =
        (parent?.stackPrimarySizing ?? "RESIZE_TO_FIT") !== "FIXED";
      const ownMain =
        parent?.stackMode === "HORIZONTAL" ? node.size?.x : node.size?.y;
      if (parentPrimaryHug && typeof ownMain === "number" && ownMain > 0) {
        css.flex = "0 0 auto";
        if (parent?.stackMode === "HORIZONTAL") css.width = `${ownMain}px`;
        else css.height = `${ownMain}px`;
      } else {
        css.flex = "1 0 0";
      }
    } else {
      // Figma never shrinks an auto-layout child that is not growing: it keeps
      // its own size and the parent overflows. CSS flex items shrink by
      // default, so an overflowing row quietly redistributed the deficit and
      // made every child the wrong width — Positivus' CTA card came out 897px
      // instead of 1240px. Only a growing child is elastic.
      css.flexShrink = "0";
    }
    // CSS rejects a negative gap, so a parent that overlaps its children
    // expresses it here instead; see the parent's `stackSpacing` handling.
    // The sibling lookup is guarded on a negative spacing because it is rare,
    // and doing it unconditionally would sort the parent's children once per
    // child on trees with tens of thousands of nodes.
    const overlap = parent ? overlapSpacing(parent, ctx) : null;
    if (overlap !== null && overlap < 0 && parent) {
      const siblings = getChildren(parent, ctx);
      const isFirst =
        siblings.length === 0 ||
        guidKey(siblings[0]!.guid) === guidKey(node.guid);
      if (!isFirst) {
        css[parent.stackMode === "VERTICAL" ? "marginTop" : "marginLeft"] =
          `${num(overlap)}px`;
      }
    }
    if (node.stackChildAlignSelf) {
      const a = STACK_ALIGN[node.stackChildAlignSelf];
      // STRETCH is dropped on an axis this node HUGS. Figma treats "hug
      // contents" and "fill container" as mutually exclusive, so a node
      // carrying both has a stale `stackChildAlignSelf` from an earlier state
      // — and `align-self: stretch` pins the box where Figma lets it grow. A
      // dashboard's main column hugs 1066px of content inside a 960px frame,
      // and stretching it cut 106px off the bottom. The derived sizing above
      // already knows which axis that is.
      const stretchAxisHugs =
        parent?.stackMode === "HORIZONTAL"
          ? sizing.vertical === "HUG"
          : sizing.horizontal === "HUG";
      if (node.stackChildAlignSelf === "STRETCH") {
        if (!stretchAxisHugs) css.alignSelf = "stretch";
      } else if (a) {
        css.alignSelf = a;
      }
    }
  }

  // A vector with no decodable geometry must not paint its bounding box as a
  // solid fill (that renders the shape as a block); render nothing instead.
  //
  // A FULL ellipse is the exception: `border-radius: 50%` reproduces it
  // exactly, fill and stroke included, so suppressing it just deletes the
  // shape. Positivus' CTA illustration is three stroke-only ellipses and they
  // vanished entirely. An arc or donut (`arcData` narrower than a full turn,
  // or a non-zero inner radius) is NOT expressible that way and stays
  // suppressed — but reported, so the hole is visible rather than silent.
  const isFullEllipse = node.type === "ELLIPSE" && isFullTurnArc(node.arcData);
  const geometrylessVector =
    !!node.type &&
    VECTOR_LIKE_TYPES.has(node.type) &&
    !vectorLike &&
    !isFullEllipse &&
    !node.fillPaints?.some((p) => p.visible !== false && p.type === "IMAGE");
  if (geometrylessVector) {
    recordApproximation(
      node,
      ctx,
      node.type === "BOOLEAN_OPERATION"
        ? "BOOLEAN_OPERATION has no decodable geometry; omitted rather than painted as its bounding box. Figma flattens a boolean outline only for REST and the .fig container — a clipboard paste carries just the operands — so import the frame with a Figma token, or upload the .fig, to get the real shape."
        : `${node.type} has no decodable geometry; omitted rather than painted as its bounding box`,
    );
  }

  // Background (TEXT uses fillPaints for color, not background; vector
  // nodes paint via <path fill> inside the <svg>).
  if (node.type !== "TEXT" && !vectorLike && !geometrylessVector) {
    Object.assign(css, backgroundShorthand(node, ctx));
  }

  // Border / outline (skipped for vector nodes — strokes go on <path>).
  // Merge box-shadows from border (e.g. INSIDE strokes) and effects so neither overwrites the other.
  const borderStyle =
    !vectorLike && !geometrylessVector ? borderShorthand(node, ctx) : {};
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
  // A CSS transform does not change an element's LAYOUT size, but Figma lays a
  // rotated auto-layout child out by its rotated footprint. A vertical rule is
  // the common case: Figma stores it as a 186x0 line turned 90 degrees, so it
  // takes no width in the row — ours took the full 186px and shoved every
  // later sibling across. Flex children pivot about their centre so the
  // margins below keep the visual in place; an absolutely positioned node
  // keeps `top left`, which is what pairs with its transform's translation.
  if (parentFlex && node.stackPositioning !== "ABSOLUTE" && css.transform) {
    const t = node.transform;
    const w = num(node.size?.x) ?? 0;
    const h = num(node.size?.y) ?? 0;
    if (t && w >= 0 && h >= 0) {
      const spanX = Math.abs(t.m00) * w + Math.abs(t.m01) * h;
      const spanY = Math.abs(t.m10) * w + Math.abs(t.m11) * h;
      const marginX = (spanX - w) / 2;
      const marginY = (spanY - h) / 2;
      if (Math.abs(marginX) > 0.01 || Math.abs(marginY) > 0.01) {
        css.transformOrigin = "center";
        if (Math.abs(marginX) > 0.01) {
          css.marginLeft = `${num(marginX)}px`;
          css.marginRight = `${num(marginX)}px`;
        }
        if (Math.abs(marginY) > 0.01) {
          css.marginTop = `${num(marginY)}px`;
          css.marginBottom = `${num(marginY)}px`;
        }
      }
    }
  }
  // Text styling
  Object.assign(css, textStyles(node, ctx));
  // Autolayout (flex)
  Object.assign(css, autolayoutStyles(node, ctx));

  // Opacity / blend mode / overflow / visibility
  if (typeof node.opacity === "number" && node.opacity < 0.999)
    css.opacity = node.opacity;
  if (node.blendMode) {
    const bmResult = cssBlendMode(node.blendMode);
    if (bmResult) {
      css.mixBlendMode = bmResult.cssMode;
      if (bmResult.verdict === "approximated") {
        recordApproximation(
          node,
          ctx,
          `blend mode ${node.blendMode} approximated as ${bmResult.cssMode}`,
        );
      }
    }
  }
  if (
    (node.type === "FRAME" || node.type === "INSTANCE") &&
    node.frameMaskDisabled !== true &&
    // `resizeToFit` marks a group/hug container that sizes to its children and
    // never clips in Figma — its children legitimately overflow the baked box,
    // so clipping here would crop content that should be visible.
    node.resizeToFit !== true
  ) {
    css.overflow = "hidden";
  }
  // Vector <svg> elements default to clipping content to their viewport. Figma
  // vector bounds are the path's *fill* box, but strokes, arrowheads, and line
  // caps extend beyond it (and horizontal/vertical lines have a 0-size box), so
  // clipping erases them. `overflow: visible` lets the full geometry paint.
  if (vectorLike) {
    css.overflow = "visible";
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
  /** When true, per-node IMAGE fills with no imageMap entry emit data-figma-image-ref. */
  trackUnresolvedImageRefs?: boolean;
  /** Populated by buildAttrs() when trackUnresolvedImageRefs is true. */
  unresolvedImageRefs?: Set<string>;
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
  /** Monotonic id suffix for SVG <defs> entries; ids must be document-unique. */
  svgDefSeq: number;
  /** Collect fidelity verdicts for approximated nodes. */
  approximatedNodes: Array<{
    nodeId: string;
    nodeName?: string;
    nodeType?: string;
    notes: string[];
  }>;
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

/**
 * Decode a Figma vector-network blob into an SVG path. The clipboard ships this
 * editable `vectorData.vectorNetworkBlob` instead of a flattened `commandsBlob`,
 * so it's the only vector geometry a no-token paste has. Format (little-endian,
 * reverse-engineered from real `.fig` data):
 *   header  : u32 vertexCount, segmentCount, regionCount, _reserved
 *   vertices: vertexCount × { f32 x, f32 y, u32 styleID }               (12 B)
 *   segments: segmentCount × { u32 startVtx, f32 tanStart{x,y},
 *                              u32 endVtx, f32 tanEnd{x,y}, u32 _ }  (24 B / 28 stride)
 * Each segment is the cubic P0=vtx[start], P1=P0+tanStart, P2=vtx[end]+tanEnd,
 * P3=vtx[end] (zero tangents → a line); segments chain end→start into subpaths.
 */
interface DecodedVectorNetwork {
  d: string;
  /** End stroke-cap is an arrow/marker type (cap enum ≥ 3; 0/1/2 = none/round/square). */
  arrowEnd: boolean;
}

function decodeVectorNetwork(bytes: Buffer | undefined): DecodedVectorNetwork {
  const empty: DecodedVectorNetwork = { d: "", arrowEnd: false };
  if (!bytes || bytes.length < 16) return empty;
  const vertexCount = bytes.readUInt32LE(0);
  const segmentCount = bytes.readUInt32LE(4);
  if (vertexCount > 200_000 || segmentCount > 200_000) return empty;
  const arrowEnd = bytes.readUInt32LE(12) >= 3;

  const verts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < vertexCount; i++) {
    const o = 16 + i * 12;
    if (o + 8 > bytes.length) break;
    verts.push({ x: bytes.readFloatLE(o), y: bytes.readFloatLE(o + 4) });
  }

  interface Seg {
    s: number;
    sx: number;
    sy: number;
    e: number;
    ex: number;
    ey: number;
  }
  const segStart = 16 + vertexCount * 12;
  const segs: Seg[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const o = segStart + i * 28;
    if (o + 24 > bytes.length) break;
    segs.push({
      s: bytes.readUInt32LE(o),
      sx: bytes.readFloatLE(o + 4),
      sy: bytes.readFloatLE(o + 8),
      e: bytes.readUInt32LE(o + 12),
      ex: bytes.readFloatLE(o + 16),
      ey: bytes.readFloatLE(o + 20),
    });
  }
  if (segs.length === 0) return empty;

  const fmt = (n: number) => {
    if (!Number.isFinite(n)) return "0";
    const r = Math.round(n * 1000) / 1000;
    return Object.is(r, -0) ? "0" : String(r);
  };
  const out: string[] = [];
  const used = new Array<boolean>(segs.length).fill(false);

  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    // Trace a connected chain: each segment's end vertex feeds the next
    // segment's start vertex.
    const chain: Seg[] = [];
    let cur: number | null = start;
    while (cur !== null && !used[cur]) {
      used[cur] = true;
      chain.push(segs[cur]!);
      const endV = segs[cur]!.e;
      let next: number | null = null;
      for (let j = 0; j < segs.length; j++) {
        if (!used[j] && segs[j]!.s === endV) {
          next = j;
          break;
        }
      }
      cur = next;
    }
    const first = chain[0]!;
    const p0 = verts[first.s];
    if (!p0) continue;
    out.push(`M${fmt(p0.x)} ${fmt(p0.y)}`);
    for (const seg of chain) {
      const a = verts[seg.s];
      const b = verts[seg.e];
      if (!a || !b) continue;
      const straight =
        seg.sx === 0 && seg.sy === 0 && seg.ex === 0 && seg.ey === 0;
      if (straight) {
        out.push(`L${fmt(b.x)} ${fmt(b.y)}`);
      } else {
        out.push(
          `C${fmt(a.x + seg.sx)} ${fmt(a.y + seg.sy)} ${fmt(b.x + seg.ex)} ${fmt(b.y + seg.ey)} ${fmt(b.x)} ${fmt(b.y)}`,
        );
      }
    }
    if (chain.length > 0 && chain[chain.length - 1]!.e === first.s) {
      out.push("Z");
    }
  }
  return { d: out.join(" "), arrowEnd };
}

/**
 * SVG paint attribute (fill / stroke) for the visible paint. Figma composites
 * a node's paint list bottom-to-top, so the LAST paint SVG can express is the
 * one actually seen — e.g. a stroke stacked `[cyan, pink]` renders pink. Pick
 * the topmost expressible paint rather than the first.
 *
 * Gradients become a paint server pushed onto `defs`; the returned `color` is
 * then a `url(#id)` reference and the alpha rides on the stops, so there is no
 * separate opacity to apply.
 */
function paintToSvgFill(
  paints: Paint[] | undefined,
  node: FigNode,
  ctx: Ctx,
  key: string,
  defs: string[],
): { color: string; opacity?: number } | null {
  const visible = (paints ?? []).filter((p) => p.visible !== false);
  if (visible.length === 0) return null;
  let paint: Paint | undefined;
  for (const candidate of visible) {
    if (candidate.type === "SOLID" || candidate.type?.startsWith("GRADIENT_"))
      paint = candidate;
  }
  if (!paint) {
    // An IMAGE fill routes to the CSS `background-image` path before it ever
    // gets here (see isVectorLike), so this is an image *stroke* or a paint
    // type we do not know. Either way the layer loses its paint — say so
    // rather than handing back a silent `fill="none"`.
    recordApproximation(
      node,
      ctx,
      `${visible[visible.length - 1]!.type ?? "unknown"} ${key} paint on a vector has no SVG equivalent; left unpainted`,
    );
    return null;
  }
  if (paint.type === "SOLID") return solidSvgFill(paint.color, paint.opacity);
  return gradientSvgFill(paint, node, ctx, key, defs);
}

function solidSvgFill(
  color: Color | undefined,
  paintOpacity: number | undefined,
): { color: string; opacity?: number } | null {
  if (!color) return null;
  const opacity = color.a * (paintOpacity ?? 1);
  return {
    // Alpha lives in the separate fill-opacity / stroke-opacity attribute.
    color: colorToCss({ ...color, a: 1 })!,
    opacity: opacity < 0.999 ? Number(opacity.toFixed(3)) : undefined,
  };
}

/**
 * Gradient paint → an SVG paint server pushed onto `defs`, referenced as
 * `url(#id)`. Mirrors the REST importer's `paintToSvgFill`
 * (packages/core/src/ingestion/figma-node-to-html.ts) so both import paths
 * emit the same markup; the only difference is the geometry source, which is
 * a node-to-gradient matrix here instead of REST handle positions.
 */
function gradientSvgFill(
  paint: Paint,
  node: FigNode,
  ctx: Ctx,
  key: string,
  defs: string[],
): { color: string; opacity?: number } | null {
  const stops = paint.stops ?? [];
  if (stops.length === 0) return null;
  // Visible, approximate, and reported beats a vanished layer.
  const firstStop = () => solidSvgFill(stops[0]!.color, paint.opacity);
  const kind = paint.type!.slice("GRADIENT_".length) as
    | "LINEAR"
    | "RADIAL"
    | "ANGULAR"
    | "DIAMOND";
  if (kind === "ANGULAR") {
    recordApproximation(
      node,
      ctx,
      "GRADIENT_ANGULAR on a vector has no SVG paint server (SVG has no conic gradient); painted as its first stop color",
    );
    return firstStop();
  }
  const box = node.size ? { width: node.size.x, height: node.size.y } : null;
  const geometry =
    paint.transform && box
      ? gradientGeometryFromTransform(kind, paint.transform, box)
      : null;
  if (!geometry || !box) {
    recordApproximation(
      node,
      ctx,
      `${paint.type} on a vector had no usable gradient transform; painted as its first stop color`,
    );
    return firstStop();
  }
  const q = (n: number) => Number(n.toFixed(4));
  const id = `fg-${guidKey(node.guid).replace(/[^a-z0-9]/gi, "")}-${key}-${ctx.svgDefSeq++}`;
  const stopMarkup = stops
    .map(
      (s) =>
        `<stop offset="${q(s.position)}" stop-color="${colorToCss({ ...s.color, a: 1 })}" stop-opacity="${q(s.color.a * (paint.opacity ?? 1))}" />`,
    )
    .join("");
  if (kind === "LINEAR") {
    // Handles are already normalized to the node's box, which is exactly SVG
    // `objectBoundingBox` space — no angle derivation or stop remapping (the
    // CSS path needs both only because a CSS gradient line spans the box
    // diagonal rather than the handles).
    const { start, end } = geometry.handles;
    defs.push(
      `<linearGradient id="${id}" x1="${q(start.x)}" y1="${q(start.y)}" x2="${q(end.x)}" y2="${q(end.y)}">${stopMarkup}</linearGradient>`,
    );
    return { color: `url(#${id})` };
  }
  if (geometry.rx <= 0 || geometry.ry <= 0) {
    recordApproximation(
      node,
      ctx,
      `${paint.type} on a vector collapsed to zero radius; painted as its first stop color`,
    );
    return firstStop();
  }
  // A unit circle transformed into the ellipse Figma's two radius handles
  // describe — the SVG equivalent of the `radial-gradient(ellipse ...)`
  // mapping the CSS path uses for non-vector nodes.
  defs.push(
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${q(geometry.center.x)} ${q(geometry.center.y)}) scale(${q(geometry.rx)} ${q(geometry.ry)})">${stopMarkup}</radialGradient>`,
  );
  recordApproximation(
    node,
    ctx,
    kind === "DIAMOND"
      ? "GRADIENT_DIAMOND on a vector approximated as an SVG <radialGradient>"
      : "Vector radial gradient rendered as an axis-aligned ellipse; a rotated or skewed radial gradient needs a full gradient transform",
  );
  return { color: `url(#${id})` };
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

function isVectorLike(node: FigNode, ctx?: Ctx): boolean {
  if (!node.type || !VECTOR_LIKE_TYPES.has(node.type)) return false;
  // A UNION whose operands all decode draws as one shape, and its operands
  // must NOT also render on their own — Figma never paints them, and their own
  // paints are not the boolean's (a testimonial bubble's rounded rect carries
  // a white stroke where the union it belongs to carries the green one).
  if (ctx && booleanUnionOperands(node, ctx)) return true;
  // Flattened geometry (saved .fig / REST) OR an editable vector network
  // (clipboard paste) — either lets us draw the real shape as <svg>.
  const hasFlatGeometry =
    (node.fillGeometry?.length ?? 0) > 0 ||
    (node.strokeGeometry?.length ?? 0) > 0;
  const hasNetwork = typeof node.vectorData?.vectorNetworkBlob === "number";
  // A STAR / REGULAR_POLYGON carries neither in a clipboard payload, but its
  // parameters describe the outline exactly.
  const hasParametricShape = parametricShapePath(node) !== null;
  if (!hasFlatGeometry && !hasNetwork && !hasParametricShape) {
    // Not a loss on its own: a full ELLIPSE still draws exactly through
    // `border-radius: 50%`, and a LINE through a bordered box. The nodes that
    // genuinely lose their shape are reported where they are emitted as an
    // empty box, which is the only place that knows nothing was drawn.
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
/**
 * The operands of a UNION boolean, each as a path in the boolean's own space.
 *
 * A clipboard paste carries only the operands, never the flattened outline
 * Figma computes — but a UNION does not need the outline. Filling the operands
 * together IS the union region, and stroking each one with the others' filled
 * interiors masked away IS the union's outline, because the boundary of a
 * union is exactly each part's boundary outside every other part.
 *
 * Returns null for anything else: SUBTRACT, INTERSECT and EXCLUDE genuinely
 * need computed geometry, and a wrong shape is worse than a reported hole.
 */
function booleanUnionOperands(
  node: FigNode,
  ctx: Ctx,
): Array<{ d: string; transform: string }> | null {
  if (node.type !== "BOOLEAN_OPERATION" || node.booleanOperation !== "UNION") {
    return null;
  }
  if ((node.fillGeometry?.length ?? 0) > 0) return null;
  const operands: Array<{ d: string; transform: string }> = [];
  for (const child of getChildren(node, ctx)) {
    if (child.visible === false) return null;
    const outline = nodeOutlinePath(child, ctx);
    if (!outline) return null;
    const t = child.transform;
    const parts: string[] = [];
    if (t) {
      parts.push(
        `matrix(${num(t.m00)} ${num(t.m10)} ${num(t.m01)} ${num(t.m11)} ${num(t.m02)} ${num(t.m12)})`,
      );
    }
    if (
      Math.abs(outline.scaleX - 1) > 1e-6 ||
      Math.abs(outline.scaleY - 1) > 1e-6
    ) {
      parts.push(`scale(${num(outline.scaleX)} ${num(outline.scaleY)})`);
    }
    operands.push({
      d: outline.d,
      transform: parts.length ? ` transform="${parts.join(" ")}"` : "",
    });
  }
  return operands.length ? operands : null;
}

/** A node's own outline in its own box, however this file can get at one. */
function nodeOutlinePath(
  node: FigNode,
  ctx: Ctx,
): { d: string; scaleX: number; scaleY: number } | null {
  const rounded = roundedRectangleOverride(node);
  if (rounded) return { d: rounded, scaleX: 1, scaleY: 1 };
  for (const g of node.fillGeometry ?? []) {
    if (typeof g.commandsBlob !== "number") continue;
    const d = decodePathCommands(ctx.blobs[g.commandsBlob]);
    if (d) return { d, scaleX: 1, scaleY: 1 };
  }
  const networkBlob = node.vectorData?.vectorNetworkBlob;
  if (typeof networkBlob === "number") {
    const d = decodeVectorNetwork(ctx.blobs[networkBlob]).d;
    if (d) {
      const ns = node.vectorData?.normalizedSize;
      return {
        d,
        scaleX: ns?.x ? (node.size?.x || ns.x) / ns.x : 1,
        scaleY: ns?.y ? (node.size?.y || ns.y) / ns.y : 1,
      };
    }
  }
  const parametric = parametricShapePath(node);
  return parametric ? { d: parametric, scaleX: 1, scaleY: 1 } : null;
}

/**
 * Figma's dash pattern as `stroke-dasharray`.
 *
 * REST hands us the dashes already outlined into `strokeGeometry`, so that
 * path gets them for free; a `.fig` or clipboard payload carries the pattern
 * as numbers and we stroke a live path, which draws solid without this. Ten
 * nodes on one page — every connector between the feature icons.
 */
function dashArrayAttr(node: FigNode): string | null {
  const pattern = node.dashPattern;
  if (!pattern?.length || !pattern.some((value) => value > 0)) return null;
  return `stroke-dasharray="${pattern.map((value) => num(value)).join(" ")}"`;
}

function emitSvgBody(
  node: FigNode,
  ctx: Ctx,
  indent: string,
  out: string[],
): void {
  // Buffered so gradient <defs> can be written ahead of the paths that
  // reference them, and skipped entirely when no path survives decoding.
  const lines: string[] = [];
  const defs: string[] = [];
  const w = node.size?.x ?? 0;
  const h = node.size?.y ?? 0;
  const fillRule =
    node.fillGeometry?.[0]?.windingRule === "ODD" ? "evenodd" : "nonzero";
  const fillPaint = paintToSvgFill(
    effectiveFillPaints(node, ctx),
    node,
    ctx,
    "fill",
    defs,
  );
  const strokePaint = paintToSvgFill(
    effectiveStrokePaints(node, ctx),
    node,
    ctx,
    "stroke",
    defs,
  );
  const strokeWeight = node.strokeWeight ?? 0;

  let emittedFlat = false;

  const unionOperands = booleanUnionOperands(node, ctx);
  if (unionOperands) {
    const fillAttrs = fillPaint
      ? `fill="${fillPaint.color}"` +
        (fillPaint.opacity !== undefined
          ? ` fill-opacity="${fillPaint.opacity}"`
          : "")
      : `fill="none"`;
    for (const operand of unionOperands) {
      lines.push(
        `${indent}  <path d="${operand.d}"${operand.transform} ${fillAttrs} />`,
      );
    }
    if (strokePaint && strokeWeight > 0) {
      // The union's outline is each operand's boundary MINUS every other
      // operand's interior — the seams where the parts meet are inside the
      // union, and drop out. SVG strokes are always centred, so the mask
      // carries the alignment band too: keep the operand's own interior for
      // INSIDE, everything outside the union for OUTSIDE, both for CENTER.
      const align = node.strokeAlign ?? "CENTER";
      const bandWidth = strokeWeight * (align === "CENTER" ? 1 : 2);
      const maskBase = `bool-${guidKey(node.guid).replace(/[^a-z0-9]/gi, "")}`;
      const pad = bandWidth + 1;
      const box = `x="${num(-pad)}" y="${num(-pad)}" width="${num(w + pad * 2)}" height="${num(h + pad * 2)}"`;
      // In a mask white and black ARE the alpha channel ("keep" / "drop"),
      // not themeable colours: a token would make the mask follow the viewer's
      // theme and eat the shape it reveals.
      const keep = (operand: { d: string; transform: string }) =>
        // guard:allow-raw-color — mask alpha, see above
        `<path d="${operand.d}"${operand.transform} fill="#fff" />`;
      // Stroked as well as filled: operands often only TOUCH along an edge
      // rather than overlap, and a shared edge has no interior to mask with.
      // Dropping a band around the other operand's boundary removes the seam —
      // a speech bubble's tail meets its box exactly on the box's bottom edge,
      // and without this the outline drew straight across the tail's mouth.
      const drop = (operand: { d: string; transform: string }) =>
        // guard:allow-raw-color — mask alpha, see above
        `<path d="${operand.d}"${operand.transform} fill="#000" stroke="#000" stroke-width="${num(bandWidth)}" />`;
      unionOperands.forEach((operand, index) => {
        const others = unionOperands.filter((_, other) => other !== index);
        const maskId = `${maskBase}-${index}`;
        const inside =
          align === "INSIDE"
            ? keep(operand)
            : // guard:allow-raw-color — mask alpha, see above
              `<rect ${box} fill="#fff" />` +
              (align === "OUTSIDE" ? drop(operand) : "");
        defs.push(
          `<mask id="${maskId}" maskUnits="userSpaceOnUse" ${box}>` +
            inside +
            others.map(drop).join("") +
            `</mask>`,
        );
        const attrs = [
          `d="${operand.d}"`,
          `fill="none"`,
          `stroke="${strokePaint.color}"`,
          `stroke-width="${num(bandWidth)}"`,
        ];
        if (strokePaint.opacity !== undefined) {
          attrs.push(`stroke-opacity="${strokePaint.opacity}"`);
        }
        // The mask must sit on a wrapper, not the path: a `userSpaceOnUse`
        // mask resolves in the coordinate system in effect where it is
        // referenced, so putting it on the transformed path would apply the
        // operand's own transform to the mask content a second time.
        lines.push(
          `${indent}  <g mask="url(#${maskId})"><path ${attrs.join(" ")}${operand.transform} /></g>`,
        );
      });
    }
    emittedFlat = true;
  }

  // Fill paths
  for (const g of node.fillGeometry ?? []) {
    if (typeof g.commandsBlob !== "number") continue;
    const d = decodePathCommands(ctx.blobs[g.commandsBlob]);
    if (!d) continue;
    emittedFlat = true;
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
      emittedFlat = true;
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
      const dashes = dashArrayAttr(node);
      if (dashes) attrs.push(dashes);
      lines.push(`${indent}  <path ${attrs.join(" ")} />`);
    }
  }

  // Vector-network fallback (clipboard paste ships only the editable network,
  // not flattened geometry). Decode it to a path and paint it with the node's
  // fill/stroke. Network coords are in `normalizedSize` space, so scale into
  // the node's box (the SVG viewBox is 0 0 w h).
  if (!emittedFlat && typeof node.vectorData?.vectorNetworkBlob !== "number") {
    const d = parametricShapePath(node);
    if (d) {
      const attrs: string[] = [`d="${escapeHtmlAttr(d)}"`];
      if (fillPaint) {
        attrs.push(`fill="${fillPaint.color}"`);
        if (fillPaint.opacity !== undefined)
          attrs.push(`fill-opacity="${num(fillPaint.opacity)}"`);
      } else {
        attrs.push(`fill="none"`);
      }
      if (strokePaint && strokeWeight > 0) {
        attrs.push(`stroke="${strokePaint.color}"`);
        attrs.push(`stroke-width="${num(strokeWeight)}"`);
        if (strokePaint.opacity !== undefined)
          attrs.push(`stroke-opacity="${num(strokePaint.opacity)}"`);
        const dashes = dashArrayAttr(node);
        if (dashes) attrs.push(dashes);
      }
      lines.push(`${indent}  <path ${attrs.join(" ")} />`);
      emittedFlat = true;
    }
  }
  if (!emittedFlat && typeof node.vectorData?.vectorNetworkBlob === "number") {
    const net = decodeVectorNetwork(
      ctx.blobs[node.vectorData.vectorNetworkBlob],
    );
    if (net.d) {
      const d = net.d;
      const ns = node.vectorData.normalizedSize;
      const sx = ns && ns.x ? (w || ns.x) / ns.x : 1;
      const sy = ns && ns.y ? (h || ns.y) / ns.y : 1;
      const scaled = Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6;
      const inner = scaled ? `${indent}  ` : indent;
      // Arrow end-cap → SVG `<marker>` (SVG strokes have no arrow linecap). It
      // scales with stroke width and auto-orients to the path's end direction.
      const arrowId =
        net.arrowEnd && strokePaint && strokeWeight > 0
          ? `ah-${guidKey(node.guid).replace(/[^a-z0-9]/gi, "")}`
          : null;
      if (arrowId) {
        lines.push(
          `${inner}  <marker id="${arrowId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0 L10 5 L0 10 z" fill="${strokePaint!.color}" /></marker>`,
        );
      }
      if (scaled)
        lines.push(`${indent}  <g transform="scale(${num(sx)} ${num(sy)})">`);
      if (fillPaint) {
        const a = [
          `d="${d}"`,
          `fill-rule="${fillRule}"`,
          `fill="${fillPaint.color}"`,
        ];
        if (fillPaint.opacity !== undefined)
          a.push(`fill-opacity="${fillPaint.opacity}"`);
        lines.push(`${inner}  <path ${a.join(" ")} />`);
      }
      if (strokePaint && strokeWeight > 0) {
        const a = [
          `d="${d}"`,
          `fill="none"`,
          `stroke="${strokePaint.color}"`,
          `stroke-width="${num(strokeWeight)}"`,
          `stroke-linejoin="${(node.strokeJoin ?? "ROUND").toLowerCase()}"`,
          `stroke-linecap="${(node.strokeCap ?? "ROUND").toLowerCase()}"`,
        ];
        if (arrowId) a.push(`marker-start="url(#${arrowId})"`);
        if (strokePaint.opacity !== undefined)
          a.push(`stroke-opacity="${strokePaint.opacity}"`);
        const dashes = dashArrayAttr(node);
        if (dashes) a.push(dashes);
        lines.push(`${inner}  <path ${a.join(" ")} />`);
      }
      if (scaled) lines.push(`${indent}  </g>`);
    }
  }

  if (lines.length === 0) return;
  if (defs.length > 0) out.push(`${indent}  <defs>${defs.join("")}</defs>`);
  out.push(...lines);
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

  // The node's own Figma id, in the same `sessionID:localID` spelling the REST
  // importer emits — so a design imported this way is traceable back to Figma
  // the same way, and so a per-node audit can line this walker's output up
  // against the REST references frame for frame.
  const nodeId = guidKey(node.guid);
  if (nodeId) attrs.push(`data-figma-node-id="${escapeHtmlAttr(nodeId)}"`);

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

  // Stamp data-figma-image-ref on elements whose IMAGE fills have no imageMap
  // entry. The sentinel placeholder URLs in the style (written by imageUrl())
  // can then be swapped for real URLs by hydrate-figma-paste-images without a
  // full re-render. Only active when the caller opts in via trackUnresolvedImageRefs.
  if (ctx.trackUnresolvedImageRefs) {
    const unresolvedHashes = (effectiveFillPaints(node, ctx) ?? [])
      .filter((p) => p.visible !== false && p.type === "IMAGE")
      .map((p) => hashToHex(p.image?.hash))
      .filter((h): h is string => h !== null && !ctx.imageMap.has(h));
    if (unresolvedHashes.length > 0) {
      const joined = unresolvedHashes.join(" ");
      attrs.push(`data-figma-image-ref="${escapeHtmlAttr(joined)}"`);
      for (const h of unresolvedHashes) ctx.unresolvedImageRefs?.add(h);
    }
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
  const selfVector = isVectorLike(node, ctx);
  const symbolVector = !!inlinedSymbol && isVectorLike(inlinedSymbol, ctx);
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
  const childrenOfSource = ctx.childrenOf.get(guidKey(childSource.guid)) ?? [];
  const hasAbsoluteChild =
    childrenOfSource.some((c) => c.stackPositioning === "ABSOLUTE") ||
    // Non-autolayout frames/instances that are NOT themselves absolutely
    // positioned need position:relative so their absolutely-positioned children
    // (all children in non-flex mode) are offset relative to THIS element, not
    // the nearest positioned ancestor further up the tree (e.g. <html> for
    // top-level frames). Without this, children near the bottom of a frame
    // escape the frame's overflow:hidden box and appear at wrong viewport coords.
    (!isPositioned &&
      (!layoutNode.stackMode || layoutNode.stackMode === "NONE") &&
      childrenOfSource.length > 0);
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
    // A viewBox with a 0 (or sub-pixel, rounds-to-0) dimension is degenerate —
    // the browser can't map coordinates and drops the whole SVG. Horizontal /
    // vertical line vectors have exactly this shape (one dimension ~0), so emit
    // a viewBox only when both dimensions survive rounding; otherwise the SVG
    // paints its geometry at native 1:1 coords under `overflow: visible`.
    if (num(vw)! > 0 && num(vh)! > 0) {
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
    const chars = textCharacters(node);
    if (chars.length === 0) {
      emitOpenWithChildren(tag, attrs, indent, lines);
      lines.push(`${indent}</${tag}>`);
      return;
    }
    emitOpenWithChildren(tag, attrs, indent, lines);
    // Preserve newlines in the source by splitting into <br>-separated lines
    // (HTML otherwise collapses whitespace).
    const runs = textStyleRuns(node);
    const toHtml = (s: string) => escapeHtmlText(s).replace(/\n/g, "<br>");
    if (runs.length <= 1) {
      lines.push(`${indent}  ${toHtml(chars)}`);
    } else {
      // Per-character color runs → one <span> per run; base-color runs inherit
      // the element's `color`, overridden runs carry their own.
      const html = runs
        .map((r) =>
          r.color
            ? `<span style="color: ${r.color}">${toHtml(r.text)}</span>`
            : toHtml(r.text),
        )
        .join("");
      lines.push(`${indent}  ${html}`);
    }
    lines.push(`${indent}</${tag}>`);
    return;
  }

  // Pick which children to render: the inlined SYMBOL's, or the node's own.
  let children: FigNode[];
  let symKeyForCycle: string | null = null;
  if (inlinedSymbol) {
    symKeyForCycle = guidKey(inlinedSymbol.guid);
    ctx.inliningStack.add(symKeyForCycle);
    children = resizeInlinedSymbolChildren(
      getChildren(inlinedSymbol, ctx),
      inlinedSymbol,
      node,
      ctx,
    );
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
    // `resizeInlinedSymbolChildren` puts the master's children into the
    // INSTANCE's coordinate space, so the parent the constraint code measures
    // against has to be that size too — otherwise a MAX or STRETCH child
    // resolves its end edge against the component's width and lands outside.
    const childParentNode = inlinedSymbol
      ? { ...inlinedSymbol, size: node.size ?? inlinedSymbol.size }
      : node;
    // A Figma mask clips the siblings painted after it, up to the next mask,
    // and is never drawn itself. `openMaskRun` tracks the wrapper holding the
    // current run so it closes before the next mask opens one and before the
    // parent's own closing tag.
    let openMaskRun = false;
    const closeMaskRun = () => {
      if (!openMaskRun) return;
      lines.push(`${indent}  </div>`);
      openMaskRun = false;
    };
    for (const child of children) {
      if (child.mask) {
        closeMaskRun();
        const clipId = `figmask-${guidKey(child.guid).replace(":", "-")}`;
        const clip = maskMarkup(child, childParentNode, ctx, clipId);
        if (!clip) {
          recordApproximation(
            child,
            ctx,
            "mask has no geometry to clip with; masked siblings render unmasked",
          );
          continue;
        }
        if (childParentIsFlex) {
          // The wrapper must be out of flow to keep the clip in the parent's
          // coordinate space, and taking it out of flow inside an auto-layout
          // parent would pull the run out of the stack it belongs to.
          recordApproximation(
            child,
            ctx,
            "mask inside an auto-layout parent; masked siblings render unmasked",
          );
          continue;
        }
        if (maskHasSoftAlpha(child)) {
          recordApproximation(
            child,
            ctx,
            "mask alpha is not uniform; clipped hard where Figma fades",
          );
        }
        if (clip.defs) lines.push(`${indent}  ${clip.defs}`);
        lines.push(
          `${indent}  <div style="position:absolute;inset:0;${escapeHtmlAttr(clip.css)}">`,
        );
        openMaskRun = true;
        continue;
      }
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
    closeMaskRun();
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
    // `text-rendering: geometricPrecision` for the same reason the REST import
    // sets it: Figma lays glyphs out on exact outlines while the browser hints
    // them by default, snapping stems to the pixel grid and nudging advances.
    // That is right for body text on a web page and wrong for reproducing a
    // design tool, and it is why this walker trailed the REST one on every
    // case that has text even where the geometry already matched node for node.
    "  <style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; padding: 0; }" +
      " * { text-rendering: geometricPrecision; }</style>",
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

export interface RenderHtmlFidelityEntry {
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  notes: string[];
}

export interface RenderHtmlResult {
  pageCount: number;
  frameCount: number;
  frames: RenderedFrame[];
  /** Populated when `trackUnresolvedImageRefs` is true in RenderHtmlOptions. */
  unresolvedImageRefs?: Set<string>;
  /** Approximated nodes collected during rendering. */
  approximatedNodes: RenderHtmlFidelityEntry[];
}

export interface RenderHtmlOptions {
  /** Optional prefix for image url() references (default: "../images") */
  imageRefBase?: string;
  /** Pre-built `hash -> filename` map for image references. */
  imageMap?: Map<string, string>;
  /** Safe URL used when an embedded image was omitted (for example no storage provider). */
  missingImageUrl?: string;
  /**
   * When true, any node whose IMAGE fill hash is absent from `imageMap` gets a
   * `data-figma-image-ref="<hexHash>"` attribute stamped on its rendered element.
   * The collected set is returned as `unresolvedImageRefs` in the result so
   * callers know which hashes need retroactive resolution.
   */
  trackUnresolvedImageRefs?: boolean;
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
    trackUnresolvedImageRefs: options.trackUnresolvedImageRefs,
    unresolvedImageRefs: options.trackUnresolvedImageRefs
      ? new Set<string>()
      : undefined,
    fontUsage: new Set(),
    inliningStack: new Set(),
    svgDefSeq: 0,
    approximatedNodes: [],
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
  if (!documentNode)
    return { pageCount: 0, frameCount: 0, frames: [], approximatedNodes: [] };

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
    approximatedNodes: ctx.approximatedNodes,
    ...(ctx.unresolvedImageRefs !== undefined
      ? { unresolvedImageRefs: ctx.unresolvedImageRefs }
      : {}),
  };
}
