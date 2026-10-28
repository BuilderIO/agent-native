import { parse, type DefaultTreeAdapterTypes } from "parse5";

import { nativeShaderRuntimeBridgeScript } from "../.generated/bridge/native-shader-runtime.generated";
import { shaderRuntimeBridgeScript } from "../.generated/bridge/shader-runtime.generated";

export type GlslUniformType = "float" | "vec2" | "color";

export type GlslUniformValue = number | [number, number] | string;

export interface GlslUniformDef {
  type: GlslUniformType;
  value: GlslUniformValue;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export type GlslUniformManifest = Record<string, GlslUniformDef>;

export type GlslShaderMode = "fill" | "effect";

export interface GlslShaderDef {
  id: string;
  name: string;
  mode: GlslShaderMode;
  glsl: string;
  uniforms: GlslUniformManifest;
}

export interface GlslShaderMountRef {
  nodeId: string | null;
  shaderId: string;
  mode: GlslShaderMode;
  values?: Record<string, GlslUniformValue>;
}

export const SHADER_SCRIPT_TYPE = "application/x-agent-native-shader";
export const SHADER_FILL_ATTR = "data-an-shader-fill";
export const SHADER_EFFECT_ATTR = "data-an-shader-effect";
export const SHADER_UNIFORMS_ATTR = "data-an-shader-uniforms";
export const SHADER_EFFECT_UNIFORMS_ATTR = "data-an-shader-effect-uniforms";
export const SHADER_RUNTIME_ATTR = "data-agent-native-shader-runtime";
export const SHADER_RUNTIME_VERSION = "1";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MANIFEST_COMMENT_RE = /^\s*\/\*!\s*an-shader\s+v(\d+)\s*([\s\S]*?)\*\//;

export function unescapeShaderScriptBreakout(glsl: string): string {
  return glsl.replace(
    /<\\\/script/gi,
    (match) => match.slice(0, 1) + match.slice(2),
  );
}

export function parseShaderBlockBody(body: string): {
  uniforms: GlslUniformManifest;
  glsl: string;
} {
  const match = MANIFEST_COMMENT_RE.exec(body);
  if (!match) {
    return {
      uniforms: {},
      glsl: unescapeShaderScriptBreakout(
        body.replace(/^[ \t]*\r?\n/, "").trim(),
      ),
    };
  }
  let uniforms: GlslUniformManifest = {};
  try {
    const meta = JSON.parse(match[2]) as { uniforms?: GlslUniformManifest };
    if (meta && typeof meta === "object" && meta.uniforms) {
      uniforms = meta.uniforms;
    }
  } catch {
    uniforms = {};
  }
  const glsl = unescapeShaderScriptBreakout(
    body
      .slice(match.index + match[0].length)
      .replace(/^[ \t]*\r?\n/, "")
      .trim(),
  );
  return { uniforms, glsl };
}

const SHADER_BLOCK_RE = new RegExp(
  '<script\\b([^>]*type\\s*=\\s*"' +
    escapeRegExp(SHADER_SCRIPT_TYPE) +
    '"[^>]*)>([\\s\\S]*?)<\\/script\\s*>',
  "gi",
);

// Either quote style: the skill documents the overrides in single quotes, since
// their JSON holds double quotes, and the runtime reads them through the DOM.
function readAttrFrom(attrs: string, name: string): string | null {
  const match = new RegExp(
    name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')",
    "i",
  ).exec(attrs);
  const raw = match ? (match[1] ?? match[2]) : undefined;
  return raw === undefined ? null : unescapeAttr(raw);
}

export function listShadersInHtml(html: string): GlslShaderDef[] {
  const defs: GlslShaderDef[] = [];
  if (typeof html !== "string" || html.length === 0) return defs;
  SHADER_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SHADER_BLOCK_RE.exec(html))) {
    const attrs = match[1];
    const id = readAttrFrom(attrs, "data-shader-id");
    if (!id || !ID_RE.test(id)) continue;
    const body = parseShaderBlockBody(match[2]);
    defs.push({
      id,
      name: readAttrFrom(attrs, "data-shader-name") || id,
      mode:
        readAttrFrom(attrs, "data-shader-mode") === "effect"
          ? "effect"
          : "fill",
      glsl: body.glsl,
      uniforms: body.uniforms,
    });
  }
  return defs;
}

function findShaderBlockSpan(
  html: string,
  id: string,
): { start: number; end: number } | null {
  SHADER_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SHADER_BLOCK_RE.exec(html))) {
    if (readAttrFrom(match[1], "data-shader-id") === id) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

export function removeShaderFromHtml(html: string, id: string): string {
  const span = findShaderBlockSpan(html, id);
  if (!span) return html;
  let start = span.start;
  while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) {
    start--;
  }
  let end = span.end;
  if (html[end] === "\r") end++;
  if (html[end] === "\n") end++;
  return html.slice(0, start) + html.slice(end);
}

export const SHADER_RUNTIME_SOURCE: string = shaderRuntimeBridgeScript;

export const NATIVE_SHADER_RUNTIME_SOURCE: string =
  nativeShaderRuntimeBridgeScript;
const NATIVE_RUNTIME_ATTR = "data-agent-native-native-shader-runtime";

type LocatedHtmlNode = DefaultTreeAdapterTypes.Node;
type RuntimeScript = {
  native: boolean;
  start: number;
  end: number;
  verified: boolean;
};

function isGeneratedShaderRuntime(source: string, native: boolean): boolean {
  const body = source.trim();
  if (
    body ===
    (native ? NATIVE_SHADER_RUNTIME_SOURCE : SHADER_RUNTIME_SOURCE).trim()
  )
    return true;
  return native
    ? body.startsWith(
        '"use strict";\n(() => {\n  var __defProp = Object.defineProperty;',
      ) &&
        body.includes("nativeBuiltinExecutionMetadata") &&
        body.includes("window.__anNativeShaders = runtime;") &&
        body.endsWith("else runtime.start();\n})();")
    : body.startsWith(
        '"use strict";\n(() => {\n  // app/components/design/bridge/shader-runtime.bridge.ts',
      ) &&
        body.includes("W.__anShaders = {") &&
        body.endsWith("})();\n})();");
}

function inspectRuntimeScripts(html: string): RuntimeScript[] {
  if (
    !html.includes(NATIVE_RUNTIME_ATTR) &&
    !html.includes(SHADER_RUNTIME_ATTR)
  )
    return [];
  const scripts: RuntimeScript[] = [];
  const visit = (node: LocatedHtmlNode): void => {
    if (node.nodeName === "script") {
      const script = node as DefaultTreeAdapterTypes.Element;
      const native = script.attrs.some(
        (attribute) => attribute.name === NATIVE_RUNTIME_ATTR,
      );
      const legacy = script.attrs.some(
        (attribute) => attribute.name === SHADER_RUNTIME_ATTR,
      );
      const location = script.sourceCodeLocation;
      const version = script.attrs.find(
        (attribute) => attribute.name === "data-runtime-version",
      )?.value;
      if ((native || legacy) && location?.startTag && location.endTag) {
        const body = html.slice(
          location.startTag.endOffset,
          location.endTag.startOffset,
        );
        scripts.push({
          native,
          start: location.startOffset,
          end: location.endOffset,
          verified:
            ((native && version === "2") || (legacy && version === "1")) &&
            isGeneratedShaderRuntime(body, native),
        });
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  return scripts;
}

/** Removes only parsed, marked runtime scripts with a verified generated body. */
export function stripGeneratedShaderRuntimes(html: string): string {
  const spans = inspectRuntimeScripts(html).filter((script) => script.verified);
  let compact = html;
  for (const span of spans.reverse())
    compact = compact.slice(0, span.start) + compact.slice(span.end);
  return compact;
}

export function ensureNativeShaderRuntime(html: string): string {
  const tag = `<script ${NATIVE_RUNTIME_ATTR} data-runtime-version="2">\n${NATIVE_SHADER_RUNTIME_SOURCE}\n</script>`;
  const scripts = inspectRuntimeScripts(html).filter((script) => script.native);
  if (scripts.length > 1 || scripts.some((script) => !script.verified))
    throw new Error("Native shader runtime marker has unrecognized content");
  const existing = scripts[0];
  if (existing) {
    if (html.slice(existing.start, existing.end) === tag) return html;
    return html.slice(0, existing.start) + tag + html.slice(existing.end);
  }
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  if (bodyClose !== -1)
    return html.slice(0, bodyClose) + tag + "\n" + html.slice(bodyClose);
  const htmlClose = html.toLowerCase().lastIndexOf("</html>");
  if (htmlClose !== -1)
    return html.slice(0, htmlClose) + tag + "\n" + html.slice(htmlClose);
  return html + "\n" + tag + "\n";
}

export function buildShaderRuntimeScriptTag(): string {
  return (
    `<script ${SHADER_RUNTIME_ATTR} data-runtime-version="${SHADER_RUNTIME_VERSION}">\n` +
    SHADER_RUNTIME_SOURCE +
    "\n</script>"
  );
}

const RUNTIME_BLOCK_RE = new RegExp(
  "<script\\b[^>]*\\b" +
    SHADER_RUNTIME_ATTR +
    "\\b[^>]*>[\\s\\S]*?<\\/script\\s*>",
  "i",
);

export function ensureShaderRuntime(html: string): string {
  const tag = buildShaderRuntimeScriptTag();
  const existing = RUNTIME_BLOCK_RE.exec(html);
  if (existing) {
    if (existing[0] === tag) return html;
    return (
      html.slice(0, existing.index) +
      tag +
      html.slice(existing.index + existing[0].length)
    );
  }
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + tag + "\n" + html.slice(bodyClose);
  }
  const htmlClose = html.toLowerCase().lastIndexOf("</html>");
  if (htmlClose !== -1) {
    return html.slice(0, htmlClose) + tag + "\n" + html.slice(htmlClose);
  }
  return html + "\n" + tag + "\n";
}

export function replaceForeignShaderRuntime(html: string): string {
  return html.includes(SHADER_RUNTIME_ATTR) ? ensureShaderRuntime(html) : html;
}

export function htmlHasShaderReferences(html: string): boolean {
  return (
    html.includes(SHADER_FILL_ATTR + '="') ||
    html.includes(SHADER_EFFECT_ATTR + '="')
  );
}

/** Takes the embedded runtime out, with the line it sat on. */
function removeShaderRuntime(html: string): string {
  const existing = RUNTIME_BLOCK_RE.exec(html);
  if (!existing) return html;
  let start = existing.index;
  while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) {
    start--;
  }
  let end = existing.index + existing[0].length;
  if (html[end] === "\r") end++;
  if (html[end] === "\n") end++;
  return html.slice(0, start) + html.slice(end);
}

/**
 * Drops the definitions nothing references. Once nothing references a shader
 * the embedded runtime goes too: it is only there to run them.
 */
export function pruneUnusedShaders(html: string): string {
  let out = html;
  for (const def of listShadersInHtml(html)) {
    const fillRef = `${SHADER_FILL_ATTR}="${escapeAttr(def.id)}"`;
    const effectRef = `${SHADER_EFFECT_ATTR}="${escapeAttr(def.id)}"`;
    if (!out.includes(fillRef) && !out.includes(effectRef)) {
      out = removeShaderFromHtml(out, def.id);
    }
  }
  return htmlHasShaderReferences(out) ? out : removeShaderRuntime(out);
}

function findTagBounds(
  html: string,
  indexInsideTag: number,
): { start: number; end: number } | null {
  let start = -1;
  for (let i = indexInsideTag; i >= 0; i--) {
    const ch = html[i];
    if (ch === "<") {
      start = i;
      break;
    }
    if (ch === ">") return null;
  }
  if (start === -1) return null;
  if (!/[a-zA-Z]/.test(html[start + 1] ?? "")) return null;
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return { start, end: i + 1 };
  }
  return null;
}

function removeAttr(tagText: string, name: string): string {
  return tagText.replace(
    new RegExp("\\s+" + name + "\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s/>]+)", "gi"),
    "",
  );
}

function removeStyleProperty(tagText: string, property: string): string {
  const styleRe = /(\sstyle\s*=\s*")([^"]*)(")/i;
  const styleMatch = styleRe.exec(tagText);
  if (!styleMatch) return tagText;
  const kept = unescapeAttr(styleMatch[2])
    .split(";")
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        !new RegExp("^" + escapeRegExp(property) + "\\s*:", "i").test(part),
    );
  const before = tagText.slice(0, styleMatch.index);
  const after = tagText.slice(styleMatch.index + styleMatch[0].length);
  if (kept.length === 0) return before + after;
  return (
    before + styleMatch[1] + escapeAttr(kept.join("; ")) + styleMatch[3] + after
  );
}

function locateNodeTag(
  html: string,
  nodeId: string,
): { start: number; end: number; tagText: string } | null {
  const marker = new RegExp(
    'data-agent-native-node-id\\s*=\\s*"' + escapeRegExp(nodeId) + '"',
  ).exec(html);
  if (!marker) return null;
  const bounds = findTagBounds(html, marker.index);
  if (!bounds) return null;
  return {
    start: bounds.start,
    end: bounds.end,
    tagText: html.slice(bounds.start, bounds.end),
  };
}

export interface HtmlTransformResult {
  html: string;
  changed: boolean;
  errors: string[];
}

export function clearNodeShader(
  html: string,
  nodeId: string,
  mode?: GlslShaderMode,
): HtmlTransformResult {
  const located = locateNodeTag(html, nodeId);
  if (!located) {
    return {
      html,
      changed: false,
      errors: [`no element with data-agent-native-node-id="${nodeId}" found`],
    };
  }
  let tagText = located.tagText;
  if (mode !== "effect") {
    tagText = removeAttr(tagText, SHADER_FILL_ATTR);
    tagText = removeAttr(tagText, SHADER_UNIFORMS_ATTR);
  }
  if (mode !== "fill") {
    tagText = removeAttr(tagText, SHADER_EFFECT_ATTR);
    tagText = removeAttr(tagText, SHADER_EFFECT_UNIFORMS_ATTR);
  }
  const nextHtml =
    html.slice(0, located.start) + tagText + html.slice(located.end);
  return { html: nextHtml, changed: nextHtml !== html, errors: [] };
}

export function listShaderMounts(html: string): GlslShaderMountRef[] {
  const mounts: GlslShaderMountRef[] = [];
  if (typeof html !== "string" || html.length === 0) return mounts;
  const refRe = new RegExp(
    "\\s(" +
      SHADER_FILL_ATTR +
      "|" +
      SHADER_EFFECT_ATTR +
      ')\\s*=\\s*"([^"]*)"',
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = refRe.exec(html))) {
    const bounds = findTagBounds(html, match.index + 1);
    if (!bounds) continue;
    const tagText = html.slice(bounds.start, bounds.end);
    const shaderId = unescapeAttr(match[2]);
    if (!ID_RE.test(shaderId)) continue;
    const mode: GlslShaderMode =
      match[1] === SHADER_EFFECT_ATTR ? "effect" : "fill";
    const valuesRaw = readAttrFrom(
      tagText,
      mode === "effect" ? SHADER_EFFECT_UNIFORMS_ATTR : SHADER_UNIFORMS_ATTR,
    );
    let values: Record<string, GlslUniformValue> | undefined;
    if (valuesRaw) {
      try {
        const parsed = JSON.parse(valuesRaw) as Record<
          string,
          GlslUniformValue
        >;
        if (parsed && typeof parsed === "object") values = parsed;
      } catch {
        values = undefined;
      }
    }
    mounts.push({
      nodeId: readAttrFrom(tagText, "data-agent-native-node-id"),
      shaderId,
      mode,
      values,
    });
  }
  return mounts;
}

export function removeShaderFromNode(
  html: string,
  nodeId: string,
  mode?: GlslShaderMode,
): HtmlTransformResult {
  const cleared = clearNodeShader(html, nodeId, mode);
  if (cleared.errors.length > 0) return cleared;
  const pruned = pruneUnusedShaders(cleared.html);
  return { html: pruned, changed: pruned !== html, errors: [] };
}

/**
 * Removes a node's fill, not just its shader: the shader, the static
 * `background` that applying it wrote as the no-JS fallback, and any
 * `background-color` that fallback was covering. `removeShaderFromNode` keeps
 * the fallback so the element falls back to a solid color; this is for a fill
 * that is taken away altogether. Gradient and image layers are other fills and
 * stay.
 */
export function removeShaderFill(
  html: string,
  nodeId: string,
): HtmlTransformResult {
  const removed = removeShaderFromNode(html, nodeId, "fill");
  if (removed.errors.length > 0) return removed;
  const located = locateNodeTag(removed.html, nodeId);
  if (!located) return removed;
  const tagText = ["background", "background-color"].reduce(
    removeStyleProperty,
    located.tagText,
  );
  const nextHtml =
    removed.html.slice(0, located.start) +
    tagText +
    removed.html.slice(located.end);
  return { html: nextHtml, changed: nextHtml !== html, errors: [] };
}
