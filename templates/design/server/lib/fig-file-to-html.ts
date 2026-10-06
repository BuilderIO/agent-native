import {
  base64ToBytes,
  readAscii,
  readF32LE,
  readU16BE,
  readU32BE,
  readU32LE,
  utf8ByteLength,
} from "../../shared/fig-bytes.js";
import {
  cssBlendMode,
  figmaDrawnText,
  FIGMA_BLUR_RADIUS_TO_CSS_BLUR,
  hasPrivateUseCharacters,
  gradientAngleDegreesFromHandles,
  gradientGeometryFromTransform,
  remapLinearStopPosition,
  textDecorationCss,
  textTransformCss,
  textUnderlinePositionCss,
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
  key?: string;
  styleType?: string;
  strokeWeight?: number;
  strokeAlign?: string;
  strokeTopWeight?: number;
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  borderStrokeWeightsIndependent?: boolean;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  effects?: Effect[];
  opacity?: number;
  blendMode?: string;
  cornerRadius?: number;
  booleanOperation?: string;
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;
  mask?: boolean;
  count?: number;
  starInnerScale?: number;
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
    lines?: unknown[];
    characterStyleIDs?: number[];
    styleOverrideTable?: Array<{
      styleID?: number;
      fillPaints?: Paint[];
      fontSize?: number;
      fontName?: { family?: string; style?: string };
      lineHeight?: { value: number; units?: string };
      letterSpacing?: { value: number; units?: string };
      textDecoration?: string;
    }>;
  };
  derivedTextData?: {
    glyphs?: Array<{
      commandsBlob?: number;
      position?: { x: number; y: number };
      fontSize?: number;
    }>;
    baselines?: Array<{ endCharacter?: number }>;
  };
  textTruncation?: string;
  maxLines?: number;
  textAutoResize?: string;
  textCase?: string;
  textDecoration?: string;
  symbolData?: {
    symbolID?: Guid;
    symbolOverrides?: SymbolOverride[];
  };
  stackMode?: string;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  stackWrap?: string;
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
  stackPositioning?: string;
  resizeToFit?: boolean;
  horizontalConstraint?: string;
  verticalConstraint?: string;
  frameMaskDisabled?: boolean;
  internalOnly?: boolean;
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
  dashPattern?: number[];
  strokeCap?: string;
  strokeDashes?: number[];
  vectorData?: {
    normalizedSize?: { x: number; y: number };
    vectorNetworkBlob?: number;
  };
  variableConsumptionMap?: {
    entries?: Array<{
      variableField?: string;
      variableData?: { value?: VariableValue };
    }>;
  };
  variableModeBySetMap?: {
    entries?: Array<{
      variableSetID?: VariableSetRef;
      variableModeID?: Guid;
    }>;
  };
  variableSetModes?: Array<{ id?: Guid; name?: string }>;
  variableSetID?: VariableSetRef;
  variableDataValues?: {
    entries?: Array<{
      modeID?: Guid;
      variableData?: { value?: VariableValue };
    }>;
  };
}

interface VariableValue {
  alias?: { guid?: Guid; assetRef?: { key?: string } };
  boolValue?: boolean;
  expressionValue?: {
    expressionFunction?: string;
    expressionArguments?: Array<{ value?: VariableValue }>;
  };
  [field: string]: unknown;
}

interface VariableSetRef {
  guid?: Guid;
  assetRef?: { key?: string };
}

function isVariantSymbolName(name: string | undefined): boolean {
  if (!name) return false;
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

function resolveComponentIdentity(
  symbol: FigNode,
  ctx: Ctx,
): { base: string; variant: string | null } {
  const ident = splitComponentName(symbol.name);
  if (ident.base) return ident;
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

interface ResolvedPropValue {
  bool?: boolean;
  text?: string;
  guid?: Guid;
}

function resolvePropAssignment(a: unknown): ResolvedPropValue | null {
  type RawValue = {
    boolValue?: boolean;
    textValue?: { characters?: string };
    textDataValue?: { characters?: string };
    guidValue?: Guid;
    symbolIdValue?: { guid?: Guid };
    slotContentIdValue?: { guid?: Guid };
    textIdValue?: { value?: string };
  };
  const ax = a as { value?: RawValue; varValue?: { value?: RawValue } };
  const vv = ax.varValue?.value;
  const v = ax.value;
  const out: ResolvedPropValue = {};
  if (typeof vv?.boolValue === "boolean") out.bool = vv.boolValue;
  else if (typeof v?.boolValue === "boolean") out.bool = v.boolValue;
  const text =
    vv?.textValue?.characters ??
    vv?.textDataValue?.characters ??
    v?.textValue?.characters ??
    v?.textDataValue?.characters ??
    vv?.textIdValue?.value;
  if (text !== undefined) out.text = text;
  const guid =
    vv?.symbolIdValue?.guid ??
    vv?.slotContentIdValue?.guid ??
    vv?.guidValue ??
    v?.slotContentIdValue?.guid ??
    v?.guidValue;
  if (guid) out.guid = guid;
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
    if (field === "VISIBLE" && v.bool === true && patched.visible === false) {
      patched = { ...patched, visible: true };
    }
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

function slotContentOf(
  node: FigNode,
  env: Map<string, ResolvedPropValue>,
  ctx: Ctx,
): FigNode | null {
  for (const ref of (node.componentPropRefs ?? []) as Array<{
    defID?: Guid;
    componentPropNodeField?: string;
  }>) {
    if (ref.componentPropNodeField !== "SLOT_CONTENT_ID") continue;
    const guid = env.get(guidKey(ref.defID))?.guid;
    const content = guid ? ctx.byGuid.get(guidKey(guid)) : undefined;
    if (content) return content;
  }
  return null;
}

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
    const existing = out.get(key);
    if (existing) {
      out.set(key, { ...existing, ...o });
    } else {
      out.set(key, o);
    }
  }
  for (const d of (
    node as {
      derivedSymbolData?: Array<
        Partial<FigNode> & { guidPath?: { guids?: Guid[] } }
      >;
    }
  ).derivedSymbolData ?? []) {
    const guids = d.guidPath?.guids ?? [];
    if (guids.length === 0) continue;
    const patch: SymbolOverride = {};
    if (d.fillGeometry?.length) patch.fillGeometry = d.fillGeometry;
    if (d.strokeGeometry?.length) patch.strokeGeometry = d.strokeGeometry;
    if (d.size) patch.size = d.size;
    if (d.transform) patch.transform = d.transform;
    if (d.derivedTextData?.glyphs?.length)
      patch.derivedTextData = d.derivedTextData;
    if (Object.keys(patch).length === 0) continue;
    const key = guids.map((g) => guidKey(g)).join("/");
    const existing = out.get(key);
    out.set(key, existing ? { ...existing, ...patch } : patch);
  }
  return out;
}

function applyOverrideLayers(
  node: FigNode,
  layers: OverrideLayer[],
  instancePath: string[],
): FigNode {
  if (layers.length === 0) return node;
  const nodeKey = guidKey(node.overrideKey ?? node.guid);
  if (!nodeKey) return node;
  const matches: OverrideEntry[] = [];
  for (const layer of layers) {
    const prefix = instancePath.slice(layer.startIndex);
    const relKey =
      prefix.length > 0 ? `${prefix.join("/")}/${nodeKey}` : nodeKey;
    const entry = layer.map.get(relKey);
    if (entry) matches.push(entry);
  }
  if (matches.length === 0) return node;

  const merged: FigNode = { ...node };
  for (let i = matches.length - 1; i >= 0; i--) {
    const entry = matches[i]!;
    for (const [field, value] of Object.entries(entry)) {
      if (field === "guidPath" || field === "overriddenSymbolID") continue;
      if (value === undefined) continue;
      if (field === "componentPropAssignments" && Array.isArray(value)) {
        const byDef = new Map(
          ((merged.componentPropAssignments ?? []) as Array<{ defID?: Guid }>)
            .concat(value as Array<{ defID?: Guid }>)
            .map((a) => [guidKey(a.defID), a]),
        );
        merged.componentPropAssignments = [...byDef.values()];
        continue;
      }
      (merged as Record<string, unknown>)[field] = value;
    }
    if (entry.overriddenSymbolID) {
      merged.symbolData = {
        ...(merged.symbolData ?? {}),
        symbolID: entry.overriddenSymbolID,
      };
    }
  }
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
  style?: string;
}

function textCharacters(node: FigNode): string {
  return figmaDrawnText(
    node.textData?.characters ?? "",
    node.textData?.lines?.length,
  );
}

function textStyleRuns(node: FigNode, ctx: Ctx): TextRun[] {
  const chars = textCharacters(node);
  const ids = node.textData?.characterStyleIDs;
  const table = node.textData?.styleOverrideTable;
  if (!chars) return [];
  if (!ids || ids.length === 0 || !table || table.length === 0) {
    return [{ text: chars }];
  }
  const styleById = new Map<number, string | undefined>();
  for (const entry of table) {
    if (entry?.styleID == null) continue;
    const css: Record<string, string | number> = {};
    let solid: Paint | undefined;
    for (const p of entry.fillPaints ?? []) {
      if (p.visible !== false && p.type === "SOLID") solid = p;
    }
    const color = solid ? colorToCss(solid.color, solid.opacity ?? 1) : null;
    if (color) css.color = color;
    const fontSize = entry.fontSize ?? node.fontSize;
    if (typeof entry.fontSize === "number")
      css.fontSize = `${num(entry.fontSize)}px`;
    if (
      entry.fontName?.family &&
      entry.fontName.family !== node.fontName?.family
    )
      css.fontFamily = fontFamilyCss(entry.fontName.family);
    if (entry.fontName?.style) {
      const weight = fontWeightFromStyle(entry.fontName.style);
      const italic = /italic|oblique/i.test(entry.fontName.style);
      if (weight !== null) css.fontWeight = weight;
      if (italic) css.fontStyle = "italic";
      const family = entry.fontName.family ?? node.fontName?.family;
      if (family)
        ctx.fontUsage.add(`${family}|${weight ?? 400}|${italic ? 1 : 0}`);
    }
    const lineHeight = entry.lineHeight
      ? lineHeightCss(
          entry.lineHeight,
          fontSize,
          ctx.autoLineHeight.get(
            autoLineHeightKey(entry.fontName ?? node.fontName),
          ),
        )
      : null;
    if (lineHeight !== null) css.lineHeight = lineHeight;
    const letterSpacing = lengthFromUnits(entry.letterSpacing, fontSize);
    if (letterSpacing !== null) css.letterSpacing = letterSpacing;
    const decoration = textDecorationCss(entry.textDecoration as never);
    if (decoration) css.textDecoration = decoration;
    styleById.set(
      entry.styleID,
      Object.keys(css).length ? formatStyleString(css) : undefined,
    );
  }
  const runs: TextRun[] = [];
  let curText = "";
  let curStyle: string | undefined;
  let started = false;
  for (let i = 0; i < chars.length; i++) {
    const style = styleById.get(ids[i] ?? 0);
    if (!started) {
      curStyle = style;
      started = true;
    } else if (style !== curStyle) {
      runs.push({ text: curText, style: curStyle });
      curText = "";
      curStyle = style;
    }
    curText += chars[i];
  }
  if (curText) runs.push({ text: curText, style: curStyle });
  return runs;
}

function tagFor(type: string | undefined): string {
  if (type === "TEXT") return "span";
  return "div";
}

const STACK_ALIGN: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  BASELINE: "baseline",
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

function deriveAutoLineHeights(nodes: FigNode[]): Map<string, number> {
  const best = new Map<string, { ratio: number; weight: number }>();
  for (const node of nodes) {
    if (node.type !== "TEXT") continue;
    const lineHeight = node.lineHeight;
    if (!(lineHeight?.units === "PERCENT" && lineHeight.value === 100))
      continue;
    if (node.textAutoResize !== "WIDTH_AND_HEIGHT") continue;
    const lines = node.textData?.lines?.length ?? 0;
    const fontSize = node.fontSize;
    const height = node.size?.y;
    if (!lines || !fontSize || !height) continue;
    const weight = lines * fontSize;
    const key = autoLineHeightKey(node.fontName);
    const current = best.get(key);
    if (!current || weight > current.weight) {
      best.set(key, { ratio: height / (lines * fontSize), weight });
    }
  }
  return new Map([...best].map(([key, value]) => [key, value.ratio]));
}

function autoLineHeightKey(
  fontName: { family?: string; style?: string } | undefined,
): string {
  return `${fontName?.family ?? ""}|${fontName?.style ?? ""}`;
}

function lineHeightCss(
  v: { value: number; units?: string } | undefined,
  fontSize?: number,
  autoRatio?: number,
): string | number | null {
  if (v && v.units === "PERCENT" && v.value === 100) {
    return autoRatio ? `${num(autoRatio * (fontSize ?? 0))}px` : "normal";
  }
  return lengthFromUnits(v, fontSize);
}

function hashToHex(
  h: string | Uint8Array | number[] | undefined,
): string | null {
  if (!h) return null;
  if (typeof h === "string") return h;
  const arr = h instanceof Uint8Array ? Array.from(h) : (h as number[]);
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function imageUrl(hashHex: string, ctx: Ctx): string {
  const resolved = ctx.imageMap.get(hashHex);
  if (!resolved && ctx.missingImageUrl) return ctx.missingImageUrl;
  return imageRefUrl(resolved ?? hashHex, ctx.imageRefBase);
}

export function imageRefUrl(filename: string, base = "images"): string {
  return /^(?:https?:|blob:|about:|data:|file:|\/)/i.test(filename)
    ? filename
    : `${base}/${filename}`;
}

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

function maskMarkup(
  maskNode: FigNode,
  parent: FigNode | null,
  ctx: Ctx,
  id: string,
): { defs: string; css: string } | null {
  const t = maskNode.transform;
  const matrix = t
    ? `matrix(${num(t.m00)} ${num(t.m10)} ${num(t.m01)} ${num(t.m11)} ${num(t.m02)} ${num(t.m12)})`
    : "";
  const placement = matrix ? ` transform="${matrix}"` : "";
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

function maskHasSoftAlpha(maskNode: FigNode): boolean {
  if (typeof maskNode.opacity === "number" && maskNode.opacity < 1) return true;
  return (maskNode.fillPaints ?? []).some(
    (paint) =>
      paint.visible !== false &&
      (paint.type !== "SOLID" || (paint.opacity ?? 1) < 1),
  );
}

function isFullTurnArc(arc: FigNode["arcData"]): boolean {
  if (!arc) return true;
  if ((arc.innerRadius ?? 0) > 1e-6) return false;
  const sweep = Math.abs((arc.endingAngle ?? 0) - (arc.startingAngle ?? 0));
  return sweep >= Math.PI * 2 - 1e-3;
}

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

function withoutPrivateUse(text: string): string {
  if (!hasPrivateUseCharacters(text)) return text;
  return Array.from(text)
    .filter((character) => !hasPrivateUseCharacters(character))
    .join("");
}

function glyphOutlineSvg(node: FigNode, ctx: Ctx): string | null {
  const data = node.derivedTextData;
  if (!data?.glyphs?.length) return null;
  const characters = Array.from(node.textData?.characters ?? "").length;
  const baselines = data.baselines ?? [];
  if (baselines[baselines.length - 1]?.endCharacter !== characters) {
    return null;
  }
  const paths: string[] = [];
  for (const glyph of data.glyphs) {
    const d =
      glyph.commandsBlob === undefined
        ? ""
        : decodePathCommands(ctx.blobs[glyph.commandsBlob]);
    const size = glyph.fontSize ?? node.fontSize;
    if (!d || !glyph.position || !size) continue;
    paths.push(
      `<path transform="translate(${num(glyph.position.x)} ${num(glyph.position.y)}) scale(${num(size)} ${num(-size)})" d="${d}"/>`,
    );
  }
  if (paths.length === 0) return null;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(node.size?.x) ?? 0}" height="${num(node.size?.y) ?? 0}" ` +
    `fill="currentColor" aria-hidden="true" style="position:absolute;left:0;top:0;overflow:visible">` +
    `${paths.join("")}</svg>`
  );
}

function recordApproximation(node: FigNode, ctx: Ctx, note: string): void {
  const nodeId = guidKey(node.guid);
  const existing = ctx.approximationByNode.get(nodeId);
  if (existing) {
    if (!existing.notes.includes(note)) existing.notes.push(note);
    return;
  }
  const entry = {
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
    notes: [note],
  };
  ctx.approximationByNode.set(nodeId, entry);
  ctx.approximatedNodes.push(entry);
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
      if (geometry) {
        const { start, end } = geometry.handles;
        const centerX = (start.x + end.x) / 2;
        const centerY = (start.y + end.y) / 2;
        const from =
          ((((Math.atan2(end.y - centerY, end.x - centerX) * 180) / Math.PI +
            90) %
            360) +
            360) %
          360;
        return (
          `conic-gradient(from ${num(from)}deg ` +
          `at ${num(centerX * 100)}% ${num(centerY * 100)}%, ${stops})`
        );
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
  overlays?: string[],
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
    imageRendering?: string;
  } = {};
  const isSingleSolidOnly = fills.length === 1 && fills[0]?.type === "SOLID";
  if (isSingleSolidOnly) {
    const color = colorToCss(fills[0]!.color, fills[0]!.opacity ?? 1);
    if (color) result.backgroundColor = color;
    return result;
  }
  const topMost = fills[fills.length - 1];
  const overlayMarkup = topMost ? paintOverlayMarkup(topMost, node, ctx) : null;
  if (overlayMarkup && overlays) overlays.push(overlayMarkup);
  const movedToOverlay = overlayMarkup && overlays ? topMost : null;

  const bgImages: string[] = [];
  const bgSizes: string[] = [];
  const bgPositions: string[] = [];
  const bgRepeats: string[] = [];
  const bgBlends: string[] = [];
  for (const f of fills) {
    if (f === movedToOverlay) continue;
    const diamond =
      f.type === "GRADIENT_DIAMOND"
        ? diamondBackgroundLayers(f, node, ctx)
        : null;
    if (diamond) {
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
    const scale = imageScaleModeCss(f, node, ctx);
    bgSizes.push(scale.size);
    bgPositions.push(scale.position);
    bgRepeats.push(scale.repeat);
  }
  const magnified = fills.some((f) => {
    if (f.type !== "IMAGE" || !node.size) return false;
    const intrinsic = fillIntrinsicSize(hashToHex(f.image?.hash), ctx);
    if (!intrinsic || intrinsic.width <= 0 || intrinsic.height <= 0)
      return false;
    return (
      node.size.x > intrinsic.width * 1.2 ||
      node.size.y > intrinsic.height * 1.2
    );
  });
  if (magnified) result.imageRendering = "pixelated";

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

interface BackgroundLayer {
  image: string;
  size: string;
  position: string;
  repeat: string;
}

function imageScaleModeCss(
  p: Paint,
  node: FigNode,
  ctx: Ctx,
): { size: string; position: string; repeat: string } {
  const mode = p.imageScaleMode ?? "FILL";
  if (mode === "FILL")
    return { size: "cover", position: "center", repeat: "no-repeat" };
  if (mode === "FIT")
    return { size: "contain", position: "center", repeat: "no-repeat" };
  if (mode === "TILE") {
    const tile = fillIntrinsicSize(hashToHex(p.image?.hash), ctx);
    return {
      size:
        tile && tile.width > 0 && tile.height > 0
          ? `${num(tile.width)}px ${num(tile.height)}px`
          : "auto",
      position: "0% 0%",
      repeat: "repeat",
    };
  }
  if (mode === "STRETCH") {
    const t = p.transform;
    const axisAligned =
      !t || (Math.abs(t.m01) < 1e-6 && Math.abs(t.m10) < 1e-6);
    const box = node.size;
    if (
      t &&
      axisAligned &&
      t.m00 > 1e-6 &&
      t.m11 > 1e-6 &&
      box &&
      box.x > 0 &&
      box.y > 0
    ) {
      const displayWidth = box.x / t.m00;
      const displayHeight = box.y / t.m11;
      return {
        size: `${num(displayWidth)}px ${num(displayHeight)}px`,
        position: `${num(-(t.m02 ?? 0) * displayWidth)}px ${num(-(t.m12 ?? 0) * displayHeight)}px`,
        repeat: "no-repeat",
      };
    }
    if (t && !axisAligned) {
      recordApproximation(
        node,
        ctx,
        "Image fill has a non-axis-aligned paint transform (rotated/skewed crop); approximated with the scale-mode-only CSS mapping, without the transform matrix",
      );
    } else if (t && (t.m00 < -1e-6 || t.m11 < -1e-6)) {
      recordApproximation(
        node,
        ctx,
        "Image fill's crop transform flips the artwork; CSS background-size has no negative form, so the crop was approximated without the flip",
      );
    }
    return { size: "100% 100%", position: "center", repeat: "no-repeat" };
  }
  return { size: "auto", position: "center", repeat: "no-repeat" };
}

function paintOverlayMarkup(p: Paint, node: FigNode, ctx: Ctx): string | null {
  const box = node.size ? { width: node.size.x, height: node.size.y } : null;
  if (!box || box.width <= 0 || box.height <= 0) return null;

  if (p.type === "GRADIENT_ANGULAR" && Math.abs(box.width - box.height) > 0.5) {
    const image = paintToBackground(p, node, ctx);
    if (!image) return null;
    const side = box.width;
    const scaleY = side > 0 ? box.height / side : 1;
    const inner =
      `position:absolute;left:0;top:0;width:${num(side)}px;height:${num(side)}px;` +
      `transform:scale(1, ${num(scaleY)});transform-origin:0 0;` +
      `background-image:${image};background-size:100% 100%;background-repeat:no-repeat`;
    return (
      `<div style="position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none">` +
      `<div style="${escapeHtmlAttr(inner)}"></div></div>`
    );
  }

  if (p.type === "IMAGE" && (p.opacity ?? 1) < 1) {
    const image = paintToBackground(p, node, ctx);
    if (!image) return null;
    const scale = imageScaleModeCss(p, node, ctx);
    const style =
      `position:absolute;inset:0;border-radius:inherit;pointer-events:none;` +
      `background-image:${image};background-size:${scale.size};` +
      `background-position:${scale.position};` +
      `background-repeat:${scale.repeat};` +
      `opacity:${num(p.opacity ?? 1)}`;
    return `<div style="${escapeHtmlAttr(style)}"></div>`;
  }

  return null;
}

function fillIntrinsicSize(
  hashHex: string | null,
  ctx: Ctx,
): { width: number; height: number } | null {
  if (!hashHex) return null;
  return (
    ctx.imageSizes.get(hashHex) ?? intrinsicImageSize(imageUrl(hashHex, ctx))
  );
}

export function imageSizeFromBytes(
  bytes: Uint8Array,
  kind: "png" | "jpeg",
): { width: number; height: number } | null {
  if (kind === "png") {
    if (bytes.length < 24 || readAscii(bytes, 12, 16) !== "IHDR") return null;
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
  }
  let offset = 2;
  while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]!;
    const length = readU16BE(bytes, offset + 2);
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: readU16BE(bytes, offset + 5),
        width: readU16BE(bytes, offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

export function imageSizeFromUnknownBytes(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50)
    return imageSizeFromBytes(bytes, "png");
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8)
    return imageSizeFromBytes(bytes, "jpeg");
  return null;
}

function intrinsicImageSize(
  url: string,
): { width: number; height: number } | null {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(
    url,
  );
  if (!match) return null;
  return imageSizeFromBytes(
    base64ToBytes(match[2]!),
    match[1] === "png" ? "png" : "jpeg",
  );
}

function borderShorthand(
  node: FigNode,
  ctx: Ctx,
  strokeOverlays?: string[],
  rendersChildren = false,
): Record<string, string> {
  const strokes = (effectiveStrokePaints(node, ctx) ?? []).filter(
    (p) => p.visible !== false,
  );
  if (strokes.length === 0) return {};
  const paint = strokes[strokes.length - 1]!;
  const gradient = !!paint.type?.startsWith("GRADIENT_");
  const color =
    paint.type === "SOLID" ? colorToCss(paint.color, paint.opacity ?? 1) : null;
  if (!color && !gradient) {
    recordApproximation(node, ctx, `${paint.type ?? "unknown"} stroke omitted`);
    return {};
  }

  const independent = node.borderStrokeWeightsIndependent === true;
  const hasPerSide =
    independent ||
    node.strokeTopWeight !== undefined ||
    node.strokeRightWeight !== undefined ||
    node.strokeBottomWeight !== undefined ||
    node.strokeLeftWeight !== undefined;

  const uniformW = node.strokeWeight ?? 0;

  const dashed = dashArrayAttr(node) !== null;
  const style = dashed ? "dashed" : "solid";

  const side = (
    resolved: number | undefined,
    raw: number | undefined,
  ): number => resolved ?? raw ?? (independent ? 0 : uniformW);
  const topW = side(node.strokeTopWeight, node.borderTopWeight);
  const rightW = side(node.strokeRightWeight, node.borderRightWeight);
  const bottomW = side(node.strokeBottomWeight, node.borderBottomWeight);
  const leftW = side(node.strokeLeftWeight, node.borderLeftWeight);

  if (
    strokeOverlays &&
    (gradient || (node.strokeAlign === "INSIDE" && rendersChildren))
  ) {
    const weights = [topW, rightW, bottomW, leftW];
    if (weights.every((w) => !w)) return {};
    const outward =
      node.strokeAlign === "OUTSIDE"
        ? 1
        : node.strokeAlign === "CENTER"
          ? 0.5
          : 0;
    const background = gradient ? paintToBackground(paint, node, ctx) : null;
    if (gradient && !background) {
      recordApproximation(node, ctx, `${paint.type} stroke omitted`);
      return {};
    }
    if (gradient && dashed) {
      recordApproximation(node, ctx, "dashed gradient stroke drawn solid");
    }
    const widths = weights.map((w) => `${num(w)}px`).join(" ");
    // guard:allow-raw-color — an opaque mask source in the imported design's own CSS, not app chrome
    const opaque = "linear-gradient(#000 0 0)";
    const paintCss = background
      ? `padding:${widths};background:${background};` +
        `-webkit-mask:${opaque} content-box,${opaque};` +
        `-webkit-mask-composite:xor;` +
        `mask:${opaque} content-box exclude,${opaque}`
      : `border-style:${style};border-color:${color};border-width:${widths}`;
    const inset = weights.map((w) => `${num(-w * outward)}px`).join(" ");
    strokeOverlays.push(
      `<div style="${escapeHtmlAttr(`position:absolute;inset:${inset};border-radius:inherit;box-sizing:border-box;pointer-events:none;${paintCss}`)}"></div>`,
    );
    return {};
  }
  if (!color) {
    recordApproximation(node, ctx, `${paint.type} stroke omitted`);
    return {};
  }

  if (!hasPerSide) {
    if (!uniformW) return {};
    if (node.strokeAlign === "OUTSIDE") {
      return { outline: `${num(uniformW)}px ${style} ${color}` };
    }
    if (node.strokeAlign === "INSIDE") {
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

  if (!topW && !rightW && !bottomW && !leftW) return {};

  const result: Record<string, string> = {};

  if (node.strokeAlign === "INSIDE") {
    if (topW) result.borderTop = `${num(topW)}px solid ${color}`;
    if (rightW) result.borderRight = `${num(rightW)}px solid ${color}`;
    if (bottomW) result.borderBottom = `${num(bottomW)}px solid ${color}`;
    if (leftW) result.borderLeft = `${num(leftW)}px solid ${color}`;
    result.boxSizing = "border-box";
    return result;
  }

  if (node.strokeAlign === "OUTSIDE") {
    const shadows: string[] = [];
    if (topW) shadows.push(`0 -${num(topW)}px 0 0 ${color}`);
    if (rightW) shadows.push(`${num(rightW)}px 0 0 0 ${color}`);
    if (bottomW) shadows.push(`0 ${num(bottomW)}px 0 0 ${color}`);
    if (leftW) shadows.push(`-${num(leftW)}px 0 0 0 ${color}`);
    return shadows.length ? { boxShadow: shadows.join(", ") } : {};
  }

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

function effectStyles(
  node: FigNode,
  ctx: Ctx,
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
      const c = colorToCss(e.color) ?? "rgba(0, 0, 0, 0.25)";
      shadows.push(
        `inset ${num(e.offset?.x ?? 0)}px ${num(e.offset?.y ?? 0)}px ${num(e.radius ?? 0)}px ${num(e.spread ?? 0)}px ${c}`,
      );
    } else if (e.type === "FOREGROUND_BLUR" || e.type === "LAYER_BLUR") {
      filters.push(
        `blur(${num((e.radius ?? 0) * FIGMA_BLUR_RADIUS_TO_CSS_BLUR)}px)`,
      );
    } else if (e.type === "BACKGROUND_BLUR") {
      backdropBlur = `blur(${num((e.radius ?? 0) * FIGMA_BLUR_RADIUS_TO_CSS_BLUR)}px)`;
    } else if (e.type === "GLASS") {
      backdropBlur = `blur(${num((e.radius ?? 0) * FIGMA_BLUR_RADIUS_TO_CSS_BLUR)}px)`;
      recordApproximation(
        node,
        ctx,
        "GLASS effect approximated as a background blur; refraction, bevel and highlights are not drawn",
      );
    } else {
      recordApproximation(node, ctx, `${e.type ?? "unknown"} effect omitted`);
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

function overlapSpacing(node: FigNode, ctx: Ctx): number | null {
  const spacing = node.stackSpacing;
  if (typeof spacing !== "number" || spacing >= 0) return null;
  const horizontal = node.stackMode === "HORIZONTAL";
  if ((node.stackPrimarySizing ?? "RESIZE_TO_FIT") !== "FIXED") return spacing;
  const total = horizontal ? node.size?.x : node.size?.y;
  if (!total) return spacing;
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
  out.alignItems =
    STACK_ALIGN[node.stackCounterAlignItems ?? "MIN"] ?? "flex-start";
  const primaryDistributes =
    node.stackPrimaryAlignItems === "SPACE_EVENLY" ||
    node.stackPrimaryAlignItems === "SPACE_BETWEEN";
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
  const pl = node.stackHorizontalPadding;
  const pr = node.stackPaddingRight;
  const pt = node.stackVerticalPadding;
  const pb = node.stackPaddingBottom;
  if ([pl, pr, pt, pb].some((v) => typeof v === "number" && v !== 0)) {
    out.padding = `${num(pt ?? 0)}px ${num(pr ?? 0)}px ${num(pb ?? 0)}px ${num(pl ?? 0)}px`;
  }
  return out;
}

function fontFamilyCss(fam: string): string {
  const quoted = /\s/.test(fam) ? `"${fam}"` : fam;
  if (/mono|courier|code|consol|menlo|fira code|source code/i.test(fam)) {
    return `${quoted}, ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace`;
  }
  if (/serif|georgia|garamond|didot|baskerville|palatino|times/i.test(fam)) {
    return `${quoted}, 'Times New Roman', Georgia, Garamond, serif`;
  }
  const system = NON_GOOGLE_FONT_FAMILY.test(fam) ? "system-ui, " : "";
  return `${quoted}, ${system}-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
}

const NON_GOOGLE_FONT_FAMILY =
  /^(SF\b|San Francisco|New York|\.?AppleSystem|Helvetica|Arial|Segoe|Graphik|Avenir|Proxima Nova|Circular)/i;

function textVerticalAlign(node: FigNode): string | null {
  if (
    node.textAutoResize === "WIDTH_AND_HEIGHT" ||
    node.textAutoResize === "HEIGHT"
  ) {
    return null;
  }
  if (node.textAlignVertical === "CENTER") return "center";
  if (node.textAlignVertical === "BOTTOM") return "flex-end";
  return null;
}

function textTruncationCss(
  node: FigNode,
  ctx: Ctx,
): Record<string, string | number> | null {
  if (node.textTruncation !== "ENDING") return null;
  const lineHeight = lineHeightCss(
    node.lineHeight,
    node.fontSize,
    ctx.autoLineHeight.get(autoLineHeightKey(node.fontName)),
  );
  const linePx =
    typeof lineHeight === "string" && lineHeight.endsWith("px")
      ? Number.parseFloat(lineHeight)
      : null;
  const fits =
    linePx && node.size?.y ? Math.floor(node.size.y / linePx + 0.01) : 1;
  const lines = Math.max(1, node.maxLines ?? fits);
  if (lines === 1) {
    return {
      display: "block",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    };
  }
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}

function textStyles(node: FigNode, ctx?: Ctx): Record<string, string | number> {
  if (node.type !== "TEXT") return {};
  const out: Record<string, string | number> = {};
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

  if (fontName?.family) out.fontFamily = fontFamilyCss(fontName.family);
  const weight = fontWeightFromStyle(fontName?.style);
  if (weight !== null) out.fontWeight = weight;
  if (ctx && fontName?.family) {
    const italic = !!(fontName.style && /italic|oblique/i.test(fontName.style));
    ctx.fontUsage.add(`${fontName.family}|${weight ?? 400}|${italic ? 1 : 0}`);
  }
  if (fontName?.style && /italic|oblique/i.test(fontName.style)) {
    out.fontStyle = "italic";
  }
  if (typeof fontSize === "number") out.fontSize = `${num(fontSize)}px`;
  const lh = lineHeightCss(
    lineHeight,
    fontSize,
    ctx?.autoLineHeight.get(autoLineHeightKey(fontName)),
  );
  if (lh !== null && lh !== undefined) out.lineHeight = lh;
  const ls = lengthFromUnits(letterSpacing, fontSize);
  if (ls !== null && ls !== undefined) out.letterSpacing = ls;
  if (textAlignHorizontal)
    out.textAlign = TEXT_ALIGN[textAlignHorizontal] ?? "left";
  const textCase = styleNode?.textCase ?? node.textCase;
  const textDecoration = styleNode?.textDecoration ?? node.textDecoration;
  const transform = textTransformCss(textCase as never);
  if (transform) out.textTransform = transform;
  const decoration = textDecorationCss(textDecoration as never);
  if (decoration) out.textDecoration = decoration;
  const underlinePosition = textUnderlinePositionCss(textDecoration as never);
  if (underlinePosition) out.textUnderlinePosition = underlinePosition;
  const lineCount = node.textData?.lines?.length ?? 1;
  const boxHeight = node.size?.y;
  const resolvedLineHeight = lengthFromUnits(lineHeight, fontSize);
  const lineHeightPx =
    typeof resolvedLineHeight === "string" && resolvedLineHeight.endsWith("px")
      ? Number.parseFloat(resolvedLineHeight)
      : null;
  if (
    lineCount === 1 &&
    boxHeight &&
    lineHeightPx &&
    Math.round(boxHeight / lineHeightPx) === 1 &&
    node.textAutoResize === "WIDTH_AND_HEIGHT"
  ) {
    out.whiteSpace = "nowrap";
  }
  const verticalAlign = textVerticalAlign(node);
  if (verticalAlign) {
    out.display = "flex";
    out.flexDirection = "column";
    out.justifyContent = verticalAlign;
  } else if (ctx) {
    Object.assign(out, textTruncationCss(node, ctx));
  }
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

const STACK_LAYOUT_FIELDS: (keyof FigNode)[] = [
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

function withMasterLayout(
  instance: FigNode,
  master: FigNode,
  original: FigNode = master,
): FigNode {
  const layoutFields = STACK_LAYOUT_FIELDS;
  const merged: FigNode = { ...instance };
  const masterDrivesLayout =
    typeof master.stackMode === "string" && master.stackMode !== "NONE";
  for (const f of layoutFields) {
    const mv = (master as Record<string, unknown>)[f as string];
    const iv = (instance as Record<string, unknown>)[f as string];
    if (iv !== (original as Record<string, unknown>)[f as string]) continue;
    if (masterDrivesLayout) {
      (merged as Record<string, unknown>)[f as string] = mv;
    } else if (mv !== undefined) {
      (merged as Record<string, unknown>)[f as string] = mv;
    }
  }
  return merged;
}

function withSlotLayout(slot: FigNode, content: FigNode): FigNode {
  const merged: FigNode = { ...slot };
  for (const f of STACK_LAYOUT_FIELDS) {
    (merged as Record<string, unknown>)[f as string] = content[f];
  }
  return merged;
}

function layoutSizing(
  node: FigNode,
  parent: FigNode | null,
): {
  horizontal: "FIXED" | "HUG" | "FILL";
  vertical: "FIXED" | "HUG" | "FILL";
} {
  let horizontal: "FIXED" | "HUG" | "FILL" = "FIXED";
  let vertical: "FIXED" | "HUG" | "FILL" = "FIXED";

  if (node.stackMode && node.stackMode !== "NONE") {
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

  if (node.type === "TEXT" && node.textAutoResize) {
    if (node.textAutoResize === "WIDTH_AND_HEIGHT") {
      horizontal = "HUG";
      vertical = "HUG";
    } else if (node.textAutoResize === "HEIGHT") {
      vertical = "HUG";
    }
  }

  if (
    parent &&
    parent.stackMode &&
    parent.stackMode !== "NONE" &&
    node.stackPositioning !== "ABSOLUTE"
  ) {
    const grow = (node.stackChildPrimaryGrow ?? 0) > 0;
    const stretch = node.stackChildAlignSelf === "STRETCH";
    const parentSelf = layoutSizing(parent, null);
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

function relayoutResizedChildren(
  children: readonly FigNode[],
  authored: { x: number; y: number } | undefined,
  rendered: { x: number; y: number } | undefined,
  parentIsFlex: boolean,
): readonly FigNode[] {
  const mw = authored?.x;
  const mh = authored?.y;
  const iw = rendered?.x;
  const ih = rendered?.y;
  if (!mw || !mh || !iw || !ih) return children;
  const dx = iw - mw;
  const dy = ih - mh;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return children;
  const sx = iw / mw;
  const sy = ih / mh;
  const axis = (
    constraint: string | undefined,
    pos: number,
    extent: number,
    delta: number,
    scale: number,
  ): { pos: number; extent: number } => {
    switch (constraint) {
      case "SCALE":
        return { pos: pos * scale, extent: extent * scale };
      case "STRETCH":
        return { pos, extent: extent + delta };
      case "MAX":
        return { pos: pos + delta, extent };
      case "CENTER":
        return { pos: pos + delta / 2, extent };
      default:
        return { pos, extent };
    }
  };

  return children.map((child) => {
    const t = child.transform;
    const size = child.size;
    if (!t || !size) return child;
    if (parentIsFlex && child.stackPositioning !== "ABSOLUTE") return child;
    const h = axis(child.horizontalConstraint, t.m02, size.x, dx, sx);
    const v = axis(child.verticalConstraint, t.m12, size.y, dy, sy);
    return {
      ...child,
      transform: { ...t, m02: h.pos, m12: v.pos },
      size: { x: h.extent, y: v.extent },
    };
  });
}

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
  overlays?: string[],
  rendersChildren?: boolean,
  strokeOverlays?: string[],
): Record<string, unknown> {
  const css: Record<string, unknown> = {};
  const parentFlex = !isPositioned && isAutolayout(parent);

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
    css.position = "relative";
  }

  const sizing = layoutSizing(node, parent);
  const hugsNothing =
    node.type !== "TEXT" &&
    !(rendersChildren ?? getChildren(node, ctx).length > 0);
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

  if (node.type === "TEXT" && node.size) {
    const hugsWidth = sizing.horizontal === "HUG";
    const hugsHeight = sizing.vertical === "HUG";
    const w = num(node.size.x);
    const h = num(node.size.y);
    if (hugsWidth && w !== null && !suppressWidth && !css.width) {
      css.minWidth = `${w}px`;
    }
    if (hugsHeight && h !== null && !suppressHeight && !css.height) {
      if (hugsWidth) css.height = `${h}px`;
      else css.minHeight = `${h}px`;
    }
  }

  if (vectorLike) {
    const minAxis = Math.max(1, num(node.strokeWeight) ?? 1);
    if (css.width === "0px") css.width = `${minAxis}px`;
    if (css.height === "0px") css.height = `${minAxis}px`;
  }

  const minX = num(node.minSize?.value?.x);
  const minY = num(node.minSize?.value?.y);
  const maxX = num(node.maxSize?.value?.x);
  const maxY = num(node.maxSize?.value?.y);
  if (minX !== null && minX > 0) css.minWidth = `${minX}px`;
  if (minY !== null && minY > 0) css.minHeight = `${minY}px`;
  if (maxX !== null && maxX > 0) css.maxWidth = `${maxX}px`;
  if (maxY !== null && maxY > 0) css.maxHeight = `${maxY}px`;

  if (parentFlex && node.stackPositioning !== "ABSOLUTE") {
    if ((node.stackChildPrimaryGrow ?? 0) > 0) {
      const parentPrimaryHug =
        (parent?.stackPrimarySizing ?? "RESIZE_TO_FIT") !== "FIXED";
      const ownMain =
        parent?.stackMode === "HORIZONTAL" ? node.size?.x : node.size?.y;
      if (parentPrimaryHug && typeof ownMain === "number" && ownMain > 0) {
        css.flex = "0 0 auto";
        if (parent?.stackMode === "HORIZONTAL") css.width = `${ownMain}px`;
        else css.height = `${ownMain}px`;
      } else if (typeof ownMain === "number" && ownMain > 0) {
        css.flex = `1 1 ${num(ownMain)}px`;
      } else {
        css.flex = "1 0 0";
      }
    } else {
      css.flexShrink = "0";
    }
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

  if (node.type !== "TEXT" && !vectorLike && !geometrylessVector) {
    Object.assign(css, backgroundShorthand(node, ctx, overlays));
  }

  const borderStyle =
    !vectorLike && !geometrylessVector
      ? borderShorthand(
          node,
          ctx,
          node.type === "TEXT" ? undefined : strokeOverlays,
          rendersChildren ?? getChildren(node, ctx).length > 0,
        )
      : {};
  const { boxShadow: borderBoxShadow, ...restBorderStyle } = borderStyle;
  Object.assign(css, restBorderStyle);
  Object.assign(css, radiusStyles(node));
  const effectStyle = effectStyles(node, ctx, shadowAsFilter);
  const { boxShadow: effectBoxShadow, ...restEffectStyle } = effectStyle;
  Object.assign(css, restEffectStyle);
  const mergedBoxShadows = (
    [borderBoxShadow, effectBoxShadow] as Array<string | undefined>
  ).filter(Boolean);
  if (mergedBoxShadows.length > 0) css.boxShadow = mergedBoxShadows.join(", ");
  Object.assign(css, transformStyle(node));
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
  Object.assign(css, textStyles(node, ctx));
  Object.assign(css, autolayoutStyles(node, ctx));

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
    node.resizeToFit !== true
  ) {
    css.overflow = "hidden";
  }
  if (vectorLike) {
    css.overflow = "visible";
  }
  if (!css.position && (overlays?.length || strokeOverlays?.length)) {
    css.position = "relative";
  }

  return css;
}

function formatStyleString(css: Record<string, unknown>): string {
  return Object.entries(css)
    .map(([k, v]) => `${kebabCase(k)}: ${String(v)}`)
    .join("; ");
}

interface Ctx {
  byGuid: Map<string, FigNode>;
  byKey: Map<string, FigNode>;
  childrenOf: Map<string, FigNode[]>;
  sortedChildren: Map<string, readonly FigNode[]>;
  symbolByGuid: Map<string, FigNode>;
  modeToSet: Map<string, string>;
  imageRefBase?: string;
  blobs: Uint8Array[];
  imageMap: Map<string, string>;
  imageSizes: Map<string, { width: number; height: number }>;
  autoLineHeight: Map<string, number>;
  missingImageUrl?: string;
  trackUnresolvedImageRefs?: boolean;
  unresolvedImageRefs?: Set<string>;
  fontUsage: Set<string>;
  inliningStack: Set<string>;
  renderedNodeCount: number;
  maxRenderedNodes: number;
  maxTreeDepth: number;
  maxFrameOutputBytes: number;
  maxTotalOutputBytes: number;
  totalOutputBytes: number;
  svgDefSeq: number;
  approximatedNodes: RenderHtmlFidelityEntry[];
  approximationByNode: Map<string, RenderHtmlFidelityEntry>;
}

function decodePathCommands(bytes: Uint8Array | undefined): string {
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
    if (op === 0 && out.length === 0) {
      i += 1;
      continue;
    } else if (op === 0) {
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
      break;
    }
    if (i + 1 + n * 4 > bytes.length) break;
    const args: string[] = [];
    for (let j = 0; j < n; j++) args.push(fmt(readF32LE(bytes, i + 1 + j * 4)));
    out.push(args.length ? `${letter}${args.join(" ")}` : letter);
    i += 1 + n * 4;
  }
  return out.join(" ");
}

interface DecodedVectorNetwork {
  d: string;
  arrowEnd: boolean;
}

function decodeVectorNetwork(
  bytes: Uint8Array | undefined,
): DecodedVectorNetwork {
  const empty: DecodedVectorNetwork = { d: "", arrowEnd: false };
  if (!bytes || bytes.length < 16) return empty;
  const vertexCount = readU32LE(bytes, 0);
  const segmentCount = readU32LE(bytes, 4);
  if (vertexCount > 200_000 || segmentCount > 200_000) return empty;
  const arrowEnd = readU32LE(bytes, 12) >= 3;

  const verts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < vertexCount; i++) {
    const o = 16 + i * 12;
    if (o + 8 > bytes.length) break;
    verts.push({ x: readF32LE(bytes, o), y: readF32LE(bytes, o + 4) });
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
      s: readU32LE(bytes, o),
      sx: readF32LE(bytes, o + 4),
      sy: readF32LE(bytes, o + 8),
      e: readU32LE(bytes, o + 12),
      ex: readF32LE(bytes, o + 16),
      ey: readF32LE(bytes, o + 20),
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
    color: colorToCss({ ...color, a: 1 })!,
    opacity: opacity < 0.999 ? Number(opacity.toFixed(3)) : undefined,
  };
}

function gradientSvgFill(
  paint: Paint,
  node: FigNode,
  ctx: Ctx,
  key: string,
  defs: string[],
): { color: string; opacity?: number } | null {
  const stops = paint.stops ?? [];
  if (stops.length === 0) return null;
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
  if (ctx && booleanUnionOperands(node, ctx)) return true;
  const hasFlatGeometry =
    (node.fillGeometry?.length ?? 0) > 0 ||
    (node.strokeGeometry?.length ?? 0) > 0;
  const hasNetwork = typeof node.vectorData?.vectorNetworkBlob === "number";
  const hasParametricShape = parametricShapePath(node) !== null;
  if (!hasFlatGeometry && !hasNetwork && !hasParametricShape) {
    return false;
  }
  if (node.fillPaints?.some((p) => p.visible !== false && p.type === "IMAGE")) {
    return false;
  }
  return true;
}

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
      const align = node.strokeAlign ?? "CENTER";
      const bandWidth = strokeWeight * (align === "CENTER" ? 1 : 2);
      const maskBase = `bool-${guidKey(node.guid).replace(/[^a-z0-9]/gi, "")}`;
      const pad = bandWidth + 1;
      const box = `x="${num(-pad)}" y="${num(-pad)}" width="${num(w + pad * 2)}" height="${num(h + pad * 2)}"`;
      const keep = (operand: { d: string; transform: string }) =>
        // guard:allow-raw-color — mask alpha, see above
        `<path d="${operand.d}"${operand.transform} fill="#fff" />`;
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
        lines.push(
          `${indent}  <g mask="url(#${maskId})"><path ${attrs.join(" ")}${operand.transform} /></g>`,
        );
      });
    }
    emittedFlat = true;
  }

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
  if (strokePaint && strokeWeight > 0) {
    const outlined = node.strokeGeometry ?? [];
    if (outlined.length > 0) {
      const strokeStart = lines.length;
      for (const g of outlined) {
        if (typeof g.commandsBlob !== "number") continue;
        const d = decodePathCommands(ctx.blobs[g.commandsBlob]);
        if (!d) continue;
        emittedFlat = true;
        const attrs = [
          `d="${d}"`,
          `fill="${strokePaint.color}"`,
          `fill-rule="${g.windingRule === "ODD" ? "evenodd" : "nonzero"}"`,
        ];
        if (strokePaint.opacity !== undefined)
          attrs.push(`fill-opacity="${strokePaint.opacity}"`);
        lines.push(`${indent}  <path ${attrs.join(" ")} />`);
      }
      if (
        node.strokeAlign === "INSIDE" &&
        lines.length > strokeStart &&
        (node.fillGeometry?.length ?? 0) > 0
      ) {
        const clipId = `fig-stroke-inside-${guidKey(node.guid).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const clipPaths = (node.fillGeometry ?? [])
          .map((g) => {
            if (typeof g.commandsBlob !== "number") return "";
            const d = decodePathCommands(ctx.blobs[g.commandsBlob]);
            return d
              ? `<path d="${d}"${g.windingRule === "ODD" ? ' clip-rule="evenodd"' : ""} />`
              : "";
          })
          .join("");
        if (clipPaths) {
          defs.push(`<clipPath id="${clipId}">${clipPaths}</clipPath>`);
          lines.splice(
            strokeStart,
            0,
            `${indent}  <g clip-path="url(#${clipId})">`,
          );
          lines.push(`${indent}  </g>`);
        }
      }
    } else
      for (const g of node.fillGeometry ?? []) {
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

function getChildren(node: FigNode, ctx: Ctx): readonly FigNode[] {
  const key = guidKey(node.guid);
  let sorted = ctx.sortedChildren.get(key);
  if (!sorted) {
    sorted = (ctx.childrenOf.get(key) ?? []).slice().sort((a, b) => {
      const pa = a.parentIndex?.position ?? "";
      const pb = b.parentIndex?.position ?? "";
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
    ctx.sortedChildren.set(key, sorted);
  }
  return sorted;
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
  overlays?: string[],
  rendersChildren?: boolean,
  strokeOverlays?: string[],
): string[] {
  const attrs: string[] = [];

  if (node.name)
    attrs.push(`data-agent-native-layer-name="${escapeHtmlAttr(node.name)}"`);

  const nodeId = guidKey(node.guid);
  if (nodeId) attrs.push(`data-figma-node-id="${escapeHtmlAttr(nodeId)}"`);

  const symbolForMeta =
    componentSymbol ??
    (node.type === "SYMBOL" || node.type === "INSTANCE" ? node : null);
  if (symbolForMeta && symbolForMeta.type === "SYMBOL") {
    const { base, variant } = resolveComponentIdentity(symbolForMeta, ctx);
    if (base) attrs.push(`data-component-name="${escapeHtmlAttr(base)}"`);
    if (variant) attrs.push(`data-variant-name="${escapeHtmlAttr(variant)}"`);
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

  const rawProps = collectRawProps(node, componentSymbol);
  if (rawProps) {
    const json = JSON.stringify(rawProps).replace(/'/g, "&#39;");
    attrs.push(`props='${json}'`);
  }

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
    overlays,
    rendersChildren,
    strokeOverlays,
  );
  if (Object.keys(css).length > 0) {
    attrs.push(`style="${escapeHtmlAttr(formatStyleString(css))}"`);
  }

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

function canonicalSetId(setNode: FigNode | undefined): string | null {
  if (!setNode) return null;
  if (setNode.key) return `key:${setNode.key}`;
  if (setNode.guid) return `guid:${guidKey(setNode.guid)}`;
  return null;
}

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

function resolveRenderedNode(
  node: FigNode,
  propEnv: Map<string, ResolvedPropValue>,
  overrideLayers: OverrideLayer[],
  instancePath: string[],
  varModes: Map<string, string>,
  ctx: Ctx,
): FigNode | null {
  const boundVisible = resolveBoundVisibility(node, varModes, ctx);
  if (boundVisible === false) return null;
  const overridden = applyOverrideLayers(
    boundVisible && node.visible === false ? { ...node, visible: true } : node,
    overrideLayers,
    instancePath,
  );
  const patched = applyPropRefs(overridden, propEnv);
  return patched && patched.visible !== false ? patched : null;
}

function emitNode(
  node: FigNode,
  parent: FigNode | null,
  ctx: Ctx,
  depth: number,
  parentIsFlex: boolean,
  lines: string[],
  propEnv: Map<string, ResolvedPropValue> = new Map(),
  overrideLayers: OverrideLayer[] = [],
  instancePath: string[] = [],
  varModes: Map<string, string> = new Map(),
): void {
  if (depth > ctx.maxTreeDepth) {
    throw new Error(".fig render tree is nested too deeply.");
  }
  ctx.renderedNodeCount += 1;
  if (ctx.renderedNodeCount > ctx.maxRenderedNodes) {
    throw new Error(".fig render exceeded its expanded-node budget.");
  }
  const originalSymbol =
    node.type === "INSTANCE"
      ? ctx.symbolByGuid.get(guidKey(node.symbolData?.symbolID))
      : undefined;
  const resolved = resolveRenderedNode(
    node,
    propEnv,
    overrideLayers,
    instancePath,
    varModes,
    ctx,
  );
  if (resolved === null) return;
  node = resolved;

  const indent = "  ".repeat(depth);

  let inlinedSymbol: FigNode | null = null;
  if (node.type === "INSTANCE" && node.symbolData?.symbolID) {
    const symKey = guidKey(node.symbolData.symbolID);
    if (!ctx.inliningStack.has(symKey)) {
      const sym = ctx.symbolByGuid.get(symKey);
      if (sym) inlinedSymbol = sym;
    }
  }
  const slotContent = inlinedSymbol ? null : slotContentOf(node, propEnv, ctx);

  let childPropEnv =
    node.type === "INSTANCE" ? buildPropEnv(node, propEnv) : propEnv;
  let childInstancePath =
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
  if (slotContent) {
    childPropEnv = new Map();
    childInstancePath = [];
    childOverrideLayers = [];
  }
  let childVarModes = varModes;
  if (node.type === "INSTANCE") {
    const added = collectInstanceVarModes(node, ctx);
    if (added.size > 0) {
      childVarModes = new Map(varModes);
      for (const [k, v] of added) childVarModes.set(k, v);
    }
  }

  const selfVector = isVectorLike(node, ctx);
  const symbolVector = !!inlinedSymbol && isVectorLike(inlinedSymbol, ctx);
  const vectorLike = selfVector || symbolVector;
  const vectorSourceNode = selfVector
    ? node
    : symbolVector
      ? inlinedSymbol!
      : node;
  const tag = vectorLike ? "svg" : tagFor(node.type);
  const isPositioned = !parentIsFlex || node.stackPositioning === "ABSOLUTE";

  let layoutNode = inlinedSymbol
    ? withMasterLayout(node, inlinedSymbol, originalSymbol ?? inlinedSymbol)
    : slotContent
      ? withSlotLayout(node, slotContent)
      : node;
  const childSource = slotContent ?? inlinedSymbol ?? node;
  const children: readonly FigNode[] =
    vectorLike || node.type === "TEXT"
      ? []
      : relayoutResizedChildren(
          getChildren(childSource, ctx),
          (childSource === node
            ? ctx.byGuid.get(guidKey(node.guid))
            : childSource
          )?.size,
          node.size,
          !!layoutNode.stackMode && layoutNode.stackMode !== "NONE",
        );
  const rendersChild = (child: FigNode): boolean =>
    resolveRenderedNode(
      child,
      childPropEnv,
      childOverrideLayers,
      childInstancePath,
      childVarModes,
      ctx,
    ) !== null;
  if (
    (layoutNode.stackPrimaryAlignItems === "SPACE_EVENLY" ||
      layoutNode.stackPrimaryAlignItems === "SPACE_BETWEEN") &&
    children.filter(
      (c) => !c.mask && c.stackPositioning !== "ABSOLUTE" && rendersChild(c),
    ).length === 1
  ) {
    layoutNode = { ...layoutNode, stackPrimaryAlignItems: "CENTER" };
  }
  const childrenOfSource = ctx.childrenOf.get(guidKey(childSource.guid)) ?? [];
  const hasAbsoluteChild =
    childrenOfSource.some((c) => c.stackPositioning === "ABSOLUTE") ||
    (!isPositioned &&
      (!layoutNode.stackMode || layoutNode.stackMode === "NONE") &&
      childrenOfSource.length > 0);
  const shadowAsFilter = getChildren(childSource, ctx).some(
    (c) => c.stackPositioning === "ABSOLUTE" && c.visible !== false,
  );
  const paintOverlays: string[] = [];
  const strokeOverlays: string[] = [];
  const attrs = buildAttrs(
    layoutNode,
    parent,
    ctx,
    isPositioned,
    inlinedSymbol,
    vectorLike,
    hasAbsoluteChild,
    shadowAsFilter,
    paintOverlays,
    vectorLike || node.type === "TEXT"
      ? undefined
      : children.some(rendersChild),
    strokeOverlays,
  );
  if (vectorLike) {
    const vw = vectorSourceNode.size?.x ?? node.size?.x ?? 0;
    const vh = vectorSourceNode.size?.y ?? node.size?.y ?? 0;
    if (num(vw)! > 0 && num(vh)! > 0) {
      attrs.push(`viewBox="0 0 ${num(vw)} ${num(vh)}"`);
      attrs.push(`preserveAspectRatio="none"`);
    }
    attrs.push(`xmlns="http://www.w3.org/2000/svg"`);
    attrs.push(`fill="none"`);
  }

  const isFlex = layoutNode.stackMode && layoutNode.stackMode !== "NONE";

  const symbolForMeta = inlinedSymbol ?? (node.type === "SYMBOL" ? node : null);
  if (symbolForMeta) {
    const desc = htmlToPlain(symbolForMeta.description);
    const links = extractDocLinks(symbolForMeta.description);
    if (desc || links.length > 0) {
      const parts = [
        `Component: ${(symbolForMeta.name ?? "<unnamed>").replace(/--/g, "\u2013")}`,
      ];
      if (desc) parts.push(desc.replace(/--/g, "\u2013"));
      if (links.length > 0) parts.push(`docs: ${links.join(", ")}`);
      lines.push(`${indent}<!-- ${parts.join(" \u2014 ")} -->`);
    }
  }

  if (vectorLike) {
    emitOpenWithChildren(tag, attrs, indent, lines, paintOverlays);
    emitSvgBody(vectorSourceNode, ctx, indent, lines);
    lines.push(`${indent}</${tag}>`);
    return;
  }

  if (node.type === "TEXT") {
    emitOpenWithChildren(tag, attrs, indent, lines, paintOverlays);
    const stored = textCharacters(node);
    const chars = withoutPrivateUse(stored);
    const outlines =
      chars !== stored && chars.trim() === ""
        ? glyphOutlineSvg(node, ctx)
        : null;
    if (outlines) {
      lines.push(`${indent}  ${outlines}`);
    } else if (chars !== stored) {
      recordApproximation(
        node,
        ctx,
        "icon-font glyphs dropped: their Private Use Area codepoints have no meaning outside the font that assigned them, and stored outlines are drawn only for text that is icons alone",
      );
    }
    if (!outlines && chars.length > 0) {
      const runs = textStyleRuns(node, ctx);
      const toHtml = (s: string) => escapeHtmlText(s).replace(/\n/g, "<br>");
      let html =
        runs.length <= 1
          ? toHtml(chars)
          : runs
              .map((run) => {
                const text = toHtml(withoutPrivateUse(run.text));
                return run.style
                  ? `<span style="${escapeHtmlAttr(run.style)}">${text}</span>`
                  : text;
              })
              .join("");
      if (textVerticalAlign(node)) {
        const truncation = textTruncationCss(node, ctx);
        html = truncation
          ? `<span style="${escapeHtmlAttr(formatStyleString(truncation))}">${html}</span>`
          : `<span>${html}</span>`;
      }
      lines.push(`${indent}  ${html}`);
    }
    lines.push(`${indent}</${tag}>`);
    return;
  }

  let symKeyForCycle: string | null = null;
  if (inlinedSymbol) {
    symKeyForCycle = guidKey(inlinedSymbol.guid);
    ctx.inliningStack.add(symKeyForCycle);
  }

  try {
    const closeTag = () => {
      for (const overlay of strokeOverlays) lines.push(`${indent}  ${overlay}`);
      lines.push(`${indent}</${tag}>`);
    };
    if (children.length === 0) {
      emitOpenWithChildren(tag, attrs, indent, lines, paintOverlays);
      closeTag();
      return;
    }
    emitOpenWithChildren(tag, attrs, indent, lines, paintOverlays);
    const childParentIsFlex = !!isFlex;
    const childParentNode =
      childSource === node
        ? layoutNode
        : {
            ...layoutNode,
            guid: childSource.guid,
            size: node.size ?? childSource.size,
          };
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
    closeTag();
  } finally {
    if (symKeyForCycle) ctx.inliningStack.delete(symKeyForCycle);
  }
}

function emitOpenWithChildren(
  tag: string,
  attrs: string[],
  indent: string,
  lines: string[],
  overlays?: string[],
): void {
  const withOverlays = (): void => {
    for (const overlay of overlays ?? []) lines.push(`${indent}  ${overlay}`);
  };
  if (attrs.length === 0) {
    lines.push(`${indent}<${tag}>`);
    withOverlays();
    return;
  }
  const oneLine = `${indent}<${tag} ${attrs.join(" ")}>`;
  if (attrs.length <= 2 && oneLine.length <= 200) {
    lines.push(oneLine);
    withOverlays();
    return;
  }
  lines.push(`${indent}<${tag}`);
  for (const a of attrs) lines.push(`${indent}  ${a}`);
  lines.push(`${indent}>`);
  withOverlays();
}

function buildGoogleFontsUrl(fontUsage: Set<string>): string | null {
  if (fontUsage.size === 0) return null;
  const byFamily = new Map<
    string,
    Array<{ weight: number; italic: boolean }>
  >();
  for (const entry of fontUsage) {
    const [family, weightStr, italicStr] = entry.split("|");
    if (!family || NON_GOOGLE_FONT_FAMILY.test(family)) continue;
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
  if (families.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

function emitFrameTemplate(frame: FigNode, ctx: Ctx, pageName: string): string {
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
  lines.push(
    "  <style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; padding: 0; }" +
      " * { text-rendering: geometricPrecision; }</style>",
  );
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
      this.bytes += utf8ByteLength(item) + 1;
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
  fileName: string;
  relativePath: string;
  html: string;
  width?: number;
  height?: number;
  x: number;
  y: number;
  nodeKey: string;
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
  unresolvedImageRefs?: Set<string>;
  approximatedNodes: RenderHtmlFidelityEntry[];
}

export interface RenderHtmlOptions {
  imageRefBase?: string;
  imageMap?: Map<string, string>;
  imageSizes?: Map<string, { width: number; height: number }>;
  missingImageUrl?: string;
  trackUnresolvedImageRefs?: boolean;
  selection?: Set<string>;
  maxFrames?: number;
  maxRenderedNodes?: number;
  maxTreeDepth?: number;
  maxFrameOutputBytes?: number;
  maxTotalOutputBytes?: number;
}

const DEFAULT_MAX_RENDER_FRAMES = 300;
const DEFAULT_MAX_RENDERED_NODES = 250_000;
const DEFAULT_MAX_TREE_DEPTH = 256;
const DEFAULT_MAX_FRAME_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = 24 * 1024 * 1024;

const TOP_LEVEL_RENDERABLE_TYPES = new Set(["FRAME", "SYMBOL", "INSTANCE"]);

export function collectTopLevelFrames(
  parent: FigNode,
  childrenOf: Map<string, FigNode[]>,
): FigNode[] {
  return collectTopLevelFrameBounds(parent, childrenOf).map(
    (entry) => entry.node,
  );
}

function collectTopLevelFrameBounds(
  parent: FigNode,
  childrenOf: Map<string, FigNode[]>,
): Array<{ node: FigNode; x: number; y: number }> {
  type Affine = {
    m00: number;
    m01: number;
    m02: number;
    m10: number;
    m11: number;
    m12: number;
  };
  const identity: Affine = {
    m00: 1,
    m01: 0,
    m02: 0,
    m10: 0,
    m11: 1,
    m12: 0,
  };
  const multiply = (parentMatrix: Affine, localMatrix: Affine): Affine => ({
    m00:
      parentMatrix.m00 * localMatrix.m00 + parentMatrix.m01 * localMatrix.m10,
    m01:
      parentMatrix.m00 * localMatrix.m01 + parentMatrix.m01 * localMatrix.m11,
    m02:
      parentMatrix.m00 * localMatrix.m02 +
      parentMatrix.m01 * localMatrix.m12 +
      parentMatrix.m02,
    m10:
      parentMatrix.m10 * localMatrix.m00 + parentMatrix.m11 * localMatrix.m10,
    m11:
      parentMatrix.m10 * localMatrix.m01 + parentMatrix.m11 * localMatrix.m11,
    m12:
      parentMatrix.m10 * localMatrix.m02 +
      parentMatrix.m11 * localMatrix.m12 +
      parentMatrix.m12,
  });
  const sortChildren = (kids: FigNode[]): FigNode[] =>
    kids.slice().sort((a, b) => {
      const pa = a.parentIndex?.position ?? "";
      const pb = b.parentIndex?.position ?? "";
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  const out: Array<{ node: FigNode; x: number; y: number }> = [];
  const visitedSections = new Set<string>();
  const stack = sortChildren(childrenOf.get(guidKey(parent.guid)) ?? [])
    .reverse()
    .map((node) => ({ node, depth: 1, matrix: identity }));
  let visited = 0;
  while (stack.length > 0) {
    const { node, depth, matrix } = stack.pop()!;
    visited += 1;
    if (visited > DEFAULT_MAX_RENDERED_NODES) {
      throw new Error(".fig section traversal exceeded its node budget.");
    }
    if (depth > DEFAULT_MAX_TREE_DEPTH) {
      throw new Error(".fig section tree is nested too deeply.");
    }
    if (!node.type || node.visible === false) continue;
    const nodeMatrix = multiply(matrix, node.transform ?? identity);
    if (node.type === "SECTION") {
      const key = guidKey(node.guid);
      if (visitedSections.has(key)) {
        throw new Error(".fig section tree contains a cycle.");
      }
      visitedSections.add(key);
      const children = sortChildren(childrenOf.get(key) ?? []);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({
          node: children[index]!,
          depth: depth + 1,
          matrix: nodeMatrix,
        });
      }
      continue;
    }
    if (TOP_LEVEL_RENDERABLE_TYPES.has(node.type)) {
      const width = node.size?.x ?? 0;
      const height = node.size?.y ?? 0;
      const bounds = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ].map(([x, y]) => ({
        x: nodeMatrix.m00 * x + nodeMatrix.m01 * y + nodeMatrix.m02,
        y: nodeMatrix.m10 * x + nodeMatrix.m11 * y + nodeMatrix.m12,
      }));
      out.push({
        node,
        x: Math.min(...bounds.map((point) => point.x)),
        y: Math.min(...bounds.map((point) => point.y)),
      });
    }
  }
  return out
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.x - b.x || a.y - b.y || a.index - b.index)
    .map(({ node, x, y }) => ({ node, x, y }));
}
const VARIABLE_FIELD_TO_PROP: Record<string, keyof FigNode> = {
  STACK_PADDING_LEFT: "stackHorizontalPadding",
  STACK_PADDING_RIGHT: "stackPaddingRight",
  STACK_PADDING_TOP: "stackVerticalPadding",
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
    blobs?: Array<{ bytes?: unknown }>;
  };
  const nodes = doc.nodeChanges ?? [];

  const blobs: Uint8Array[] = (doc.blobs ?? []).map((b) => {
    const v = b?.bytes;
    if (v === undefined) return new Uint8Array(0);
    if (v instanceof Uint8Array) return v;
    throw new Error(".fig document blob is not bytes.");
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

  resolveVariableBindings(nodes, byGuid, byKey);

  const ctx: Ctx = {
    byGuid,
    byKey,
    childrenOf,
    sortedChildren: new Map(),
    symbolByGuid,
    modeToSet,
    imageRefBase: options.imageRefBase,
    blobs,
    imageMap: options.imageMap ?? new Map<string, string>(),
    imageSizes:
      options.imageSizes ??
      new Map<string, { width: number; height: number }>(),
    autoLineHeight: deriveAutoLineHeights(nodes),
    missingImageUrl: options.missingImageUrl,
    trackUnresolvedImageRefs: options.trackUnresolvedImageRefs,
    unresolvedImageRefs: options.trackUnresolvedImageRefs
      ? new Set<string>()
      : undefined,
    fontUsage: new Set(),
    inliningStack: new Set(),
    svgDefSeq: 0,
    approximatedNodes: [],
    approximationByNode: new Map(),
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
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_RENDER_FRAMES;

  const pages = selection
    ? allPages.filter((page) => {
        if (selection.has(guidKey(page.guid))) return true;
        return collectTopLevelFrames(page, childrenOf).some((frame) =>
          selection.has(guidKey(frame.guid)),
        );
      })
    : allPages;

  const frames: RenderedFrame[] = [];
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]!;
    const pageDirName = sanitizeFilename(page.name, `page-${pageIdx + 1}`);
    const pageSelected = selection?.has(guidKey(page.guid)) ?? false;
    const pageFrames = collectTopLevelFrameBounds(page, ctx.childrenOf).filter(
      (c) => {
        if (!selection || pageSelected) return true;
        return selection.has(guidKey(c.node.guid));
      },
    );
    if (frames.length + pageFrames.length > maxFrames) {
      throw new Error(
        `.fig document has too many top-level frames (max ${maxFrames}).`,
      );
    }

    const seen = new Map<string, number>();
    for (let frameIdx = 0; frameIdx < pageFrames.length; frameIdx++) {
      const { node: frame, x, y } = pageFrames[frameIdx]!;
      const baseFile = sanitizeFilename(frame.name, `frame-${frameIdx + 1}`);
      const dupeIdx = seen.get(baseFile) ?? 0;
      seen.set(baseFile, dupeIdx + 1);
      const fileName =
        dupeIdx === 0 ? `${baseFile}.html` : `${baseFile}-${dupeIdx + 1}.html`;
      const pageName = page.name ?? `page-${pageIdx + 1}`;
      const html = emitFrameTemplate(frame, ctx, pageName);
      ctx.totalOutputBytes += utf8ByteLength(html);
      if (ctx.totalOutputBytes > ctx.maxTotalOutputBytes) {
        throw new Error(".fig render exceeded its total output budget.");
      }
      frames.push({
        pageName,
        pageDirName,
        frameName: frame.name ?? `frame-${frameIdx + 1}`,
        fileName,
        relativePath: `${pageDirName}/${fileName}`,
        html,
        width: frame.size?.x,
        height: frame.size?.y,
        x,
        y,
        nodeKey: guidKey(frame.guid),
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
