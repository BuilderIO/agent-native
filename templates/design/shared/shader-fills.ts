/**
 * Code-backed GLSL shader fills + effects — canonical persisted format.
 *
 * Unlike the preset-only `shader-presets.ts` catalog (which approximates
 * shaders as CSS gradients when persisting), this module defines a fully
 * code-backed representation: the GLSL fragment source lives IN the screen
 * HTML, readable and editable in the Code panel, and a small self-contained
 * WebGL runtime (embedded in the same HTML) renders it live — in the editor,
 * in shared links, and in exported standalone HTML.
 *
 * ── Persisted format (v1) ────────────────────────────────────────────────
 *
 * 1. One definition block per shader, anywhere in the document (by
 *    convention just before `</body>`):
 *
 *    <script type="application/x-agent-native-shader"
 *            data-shader-id="an-shader-x1y2z3"
 *            data-shader-name="Water Caustics"
 *            data-shader-mode="fill">
 *    (leading GLSL block comment opened with slash-star-bang)
 *    an-shader v1
 *    { "uniforms": { "u_speed": { "type": "float", "value": 1,
 *      "min": 0, "max": 4, "step": 0.01, "label": "Speed" } } }
 *    (star-slash closes the comment)
 *    precision highp float;
 *    uniform vec2 u_resolution;
 *    uniform float u_time;
 *    uniform float u_speed;
 *    void main() { ... gl_FragColor = vec4(...); }
 *    </script>
 *
 *    The uniforms manifest rides inside a leading GLSL block comment — valid
 *    GLSL, so the whole block body is directly compilable, and the Code panel
 *    shows one readable, self-documenting artifact.
 *
 * 2. Elements reference a shader by id:
 *      data-an-shader-fill="an-shader-x1y2z3"      (canvas behind content)
 *      data-an-shader-effect="an-shader-x1y2z3"    (overlay above content)
 *    Optional per-element uniform overrides (Figma's paint-instance
 *    properties): data-an-shader-uniforms='{"u_speed":2}'
 *    For fills, the element's inline `background` holds a static fallback
 *    color so the artifact still renders without JS/WebGL.
 *
 * 3. The runtime is embedded once per document:
 *      <script data-agent-native-shader-runtime data-runtime-version="1">…
 *    (source of truth: app/components/design/bridge/shader-runtime.bridge.ts,
 *    compiled by bridge/codegen.ts — `ensureShaderRuntime()` injects/upgrades
 *    it.)
 *
 * Built-in uniforms every shader may declare (auto-driven by the runtime):
 *   uniform float u_time;        // seconds, 0 under prefers-reduced-motion
 *   uniform vec2  u_resolution;  // canvas size in physical pixels
 *
 * Keep the manifest parsing in shader-runtime.bridge.ts in sync with this
 * module.
 */

import { shaderRuntimeBridgeScript } from "../.generated/bridge/shader-runtime.generated";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GlslUniformType = "float" | "vec2" | "color";

export type GlslUniformValue = number | [number, number] | string;

export interface GlslUniformDef {
  type: GlslUniformType;
  /** float → number; vec2 → [x, y]; color → "#rrggbb". */
  value: GlslUniformValue;
  /** Knob range — only for type "float". */
  min?: number;
  max?: number;
  step?: number;
  /** Human-readable knob label shown in the inspector. */
  label?: string;
}

export type GlslUniformManifest = Record<string, GlslUniformDef>;

export type GlslShaderMode = "fill" | "effect";

/** One code-backed shader as persisted in the screen HTML. */
export interface GlslShaderDef {
  id: string;
  name: string;
  mode: GlslShaderMode;
  glsl: string;
  uniforms: GlslUniformManifest;
}

/** One element ↔ shader reference parsed back out of the HTML. */
export interface GlslShaderMountRef {
  nodeId: string | null;
  shaderId: string;
  mode: GlslShaderMode;
  /** Per-element uniform value overrides, when present. */
  values?: Record<string, GlslUniformValue>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SHADER_SCRIPT_TYPE = "application/x-agent-native-shader";
export const SHADER_FILL_ATTR = "data-an-shader-fill";
export const SHADER_EFFECT_ATTR = "data-an-shader-effect";
export const SHADER_UNIFORMS_ATTR = "data-an-shader-uniforms";
/**
 * Per-element uniform overrides for the EFFECT mount. Fills and effects can
 * coexist on one element (Figma stacks them), so each mode gets its own
 * override attribute.
 */
export const SHADER_EFFECT_UNIFORMS_ATTR = "data-an-shader-effect-uniforms";
export const SHADER_RUNTIME_ATTR = "data-agent-native-shader-runtime";
export const SHADER_RUNTIME_VERSION = "1";
export const SHADER_MANIFEST_VERSION = 1;

/** Uniform names the runtime provides automatically — reserved. */
export const SHADER_BUILTIN_UNIFORMS = ["u_time", "u_resolution"] as const;

const MAX_GLSL_LENGTH = 20000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UNIFORM_NAME_RE = /^u_[A-Za-z0-9_]{1,48}$/;
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

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

/** Generate a fresh shader id: an-shader-<8 base36 chars>. */
export function newShaderId(): string {
  let suffix = "";
  while (suffix.length < 8) {
    suffix += Math.random().toString(36).slice(2);
  }
  return "an-shader-" + suffix.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const GLSL_TYPE_FOR_UNIFORM: Record<GlslUniformType, string> = {
  float: "float",
  vec2: "vec2",
  color: "vec3",
};

const SAFE_COLOR_RE =
  /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([\d.,\s%/]*\)|hsla?\([\d.,\s%/deg]*\)|oklch\([\d.,\s%/deg]*\)|[a-zA-Z]{3,25})$/;

/** True when a CSS color literal is safe to embed in an inline style. */
export function isSafeShaderFallbackColor(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;
  if (/[;{}<>]|url\s*\(/i.test(trimmed)) return false;
  return SAFE_COLOR_RE.test(trimmed);
}

/** Neutralize an unsafe fallback color instead of failing the whole apply. */
export function sanitizeShaderFallbackColor(value: string | undefined): string {
  if (value && isSafeShaderFallbackColor(value)) return value.trim();
  return "#808080";
}

export interface ShaderValidationResult {
  valid: boolean;
  errors: string[];
}

/** String-level sanity checks on a GLSL fragment source. */
export function validateGlslSource(glsl: string): ShaderValidationResult {
  const errors: string[] = [];
  if (typeof glsl !== "string" || glsl.trim().length === 0) {
    return { valid: false, errors: ["GLSL source is empty"] };
  }
  if (glsl.length > MAX_GLSL_LENGTH) {
    errors.push(
      `GLSL source is ${glsl.length} chars — max is ${MAX_GLSL_LENGTH}`,
    );
  }
  if (!/void\s+main\s*\(/.test(glsl)) {
    errors.push("GLSL source must define void main()");
  }
  if (!/gl_FragColor/.test(glsl)) {
    errors.push("GLSL source must write gl_FragColor");
  }
  // An opening `<script` tag is a real injection vector (it starts a brand
  // new, arbitrary script rather than merely closing the current block), so
  // it stays a hard rejection. A closing `</script` on its own — e.g. inside
  // a GLSL line comment describing script-tag breakouts — is no longer
  // rejected here: serializeShaderScriptBlock escapes it
  // (escapeShaderScriptBreakout) before embedding, and parseShaderBlockBody
  // reverses that escape, so the literal sequence never reaches the emitted
  // HTML unescaped.
  if (/<script/i.test(glsl)) {
    errors.push("GLSL source must not contain an opening script tag");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(glsl)) {
    errors.push("GLSL source contains control characters");
  }
  return { valid: errors.length === 0, errors };
}

/** Validate a uniforms manifest (names, types, values, ranges). */
export function validateUniformManifest(
  uniforms: GlslUniformManifest,
): ShaderValidationResult {
  const errors: string[] = [];
  if (!uniforms || typeof uniforms !== "object") {
    return { valid: false, errors: ["uniforms manifest must be an object"] };
  }
  const names = Object.keys(uniforms);
  if (names.length > 16) {
    errors.push(`too many uniforms (${names.length}) — max is 16`);
  }
  for (const name of names) {
    const def = uniforms[name];
    if (!UNIFORM_NAME_RE.test(name)) {
      errors.push(
        `uniform "${name}" must match u_[A-Za-z0-9_]+ (max 50 chars)`,
      );
      continue;
    }
    if ((SHADER_BUILTIN_UNIFORMS as readonly string[]).includes(name)) {
      errors.push(
        `uniform "${name}" is a built-in provided by the runtime — ` +
          "do not declare it in the manifest",
      );
      continue;
    }
    if (!def || typeof def !== "object") {
      errors.push(`uniform "${name}" definition must be an object`);
      continue;
    }
    if (def.type === "float") {
      if (typeof def.value !== "number" || !isFinite(def.value)) {
        errors.push(`uniform "${name}" value must be a finite number`);
      } else {
        if (def.min !== undefined && def.value < def.min) {
          errors.push(`uniform "${name}" value is below its min`);
        }
        if (def.max !== undefined && def.value > def.max) {
          errors.push(`uniform "${name}" value is above its max`);
        }
      }
      if (
        def.min !== undefined &&
        def.max !== undefined &&
        !(def.min < def.max)
      ) {
        errors.push(`uniform "${name}" needs min < max`);
      }
      if (def.step !== undefined && !(def.step > 0)) {
        errors.push(`uniform "${name}" step must be > 0`);
      }
    } else if (def.type === "vec2") {
      const v = def.value;
      if (
        !Array.isArray(v) ||
        v.length !== 2 ||
        typeof v[0] !== "number" ||
        typeof v[1] !== "number" ||
        !isFinite(v[0]) ||
        !isFinite(v[1])
      ) {
        errors.push(`uniform "${name}" value must be [x, y] finite numbers`);
      }
    } else if (def.type === "color") {
      if (
        typeof def.value !== "string" ||
        !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(def.value)
      ) {
        errors.push(
          `uniform "${name}" value must be a hex color like "#1a2b3c"`,
        );
      }
    } else {
      errors.push(
        `uniform "${name}" has unknown type "${String(
          (def as { type?: unknown }).type,
        )}" — use float, vec2, or color`,
      );
    }
    if (def.label !== undefined) {
      if (typeof def.label !== "string" || def.label.length > 40) {
        errors.push(`uniform "${name}" label must be a string ≤ 40 chars`);
      } else if (def.label.includes("*/") || /<\/?script/i.test(def.label)) {
        errors.push(`uniform "${name}" label contains forbidden sequences`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a full shader definition, including the cross-check that every
 * manifest uniform is actually declared in the GLSL with the matching type
 * (float → float, vec2 → vec2, color → vec3) so every knob provably drives
 * the shader.
 */
export function validateShaderDef(def: GlslShaderDef): ShaderValidationResult {
  const errors: string[] = [];
  if (!def || typeof def !== "object") {
    return { valid: false, errors: ["shader definition must be an object"] };
  }
  if (typeof def.id !== "string" || !ID_RE.test(def.id)) {
    errors.push(
      'shader id must match [A-Za-z0-9_-]{1,64} (e.g. "an-shader-x1y2z3")',
    );
  }
  if (
    typeof def.name !== "string" ||
    def.name.trim().length === 0 ||
    def.name.length > 80
  ) {
    errors.push("shader name must be a non-empty string ≤ 80 chars");
  } else if (def.name.includes("*/") || /<\/?script/i.test(def.name)) {
    errors.push("shader name contains forbidden sequences");
  }
  if (def.mode !== "fill" && def.mode !== "effect") {
    errors.push('shader mode must be "fill" or "effect"');
  }
  const glslResult = validateGlslSource(def.glsl);
  errors.push(...glslResult.errors);
  const manifestResult = validateUniformManifest(def.uniforms ?? {});
  errors.push(...manifestResult.errors);

  if (glslResult.valid && manifestResult.valid) {
    for (const [name, u] of Object.entries(def.uniforms ?? {})) {
      const glslType = GLSL_TYPE_FOR_UNIFORM[u.type];
      const declRe = new RegExp(
        "uniform\\s+(?:lowp\\s+|mediump\\s+|highp\\s+)?" +
          glslType +
          "\\s+" +
          escapeRegExp(name) +
          "\\s*;",
      );
      if (!declRe.test(def.glsl)) {
        errors.push(
          `uniform "${name}" (${u.type}) is not declared in the GLSL as ` +
            `"uniform ${glslType} ${name};" — every knob must drive the shader`,
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Manifest comment + script block serialization
// ---------------------------------------------------------------------------

const MANIFEST_COMMENT_RE = /^\s*\/\*!\s*an-shader\s+v(\d+)\s*([\s\S]*?)\*\//;

/** Serialize the manifest as the leading GLSL block comment. */
export function serializeManifestComment(
  uniforms: GlslUniformManifest,
): string {
  const json = JSON.stringify({ uniforms }, null, 2);
  if (json.includes("*/")) {
    throw new Error("uniforms manifest must not contain */");
  }
  return "/*! an-shader v" + SHADER_MANIFEST_VERSION + "\n" + json + "\n*/";
}

/**
 * Escape/unescape pair guarding against a `</script` breakout inside a
 * serialized GLSL body.
 *
 * `def.glsl` is caller-controlled (agent/user-edited GLSL source) and is
 * embedded RAW inside a `<script type="application/x-agent-native-shader">`
 * block. `validateGlslSource` already rejects a literal `</script` at the
 * point a shader definition is validated/applied — but `serializeShaderScriptBlock`
 * is also reachable with defs that were constructed without going through
 * that validation (e.g. directly in tests, or future callers), and stored
 * legacy content may already contain the substring. Escaping here is
 * defense in depth: even if an unescaped `</script` reaches this function,
 * the emitted HTML never contains a literal closing-script-tag sequence
 * inside the block body, so the surrounding document can't be corrupted.
 *
 * Approach: replace `</script` (case-insensitive) with `<\/script` — the
 * same backslash-escape idiom used for embedding JS strings inside
 * `<script>` blocks. It's a minimal, transform-invariant edit (inserts one
 * `\` character) that is trivial to reverse exactly on parse.
 */
export function escapeShaderScriptBreakout(glsl: string): string {
  return glsl.replace(
    /<\/script/gi,
    (match) => match.slice(0, 1) + "\\" + match.slice(1),
  );
}

/** Reverse {@link escapeShaderScriptBreakout} — restores the original GLSL. */
export function unescapeShaderScriptBreakout(glsl: string): string {
  return glsl.replace(
    /<\\\/script/gi,
    (match) => match.slice(0, 1) + match.slice(2),
  );
}

/**
 * Split a script-block body into { uniforms, glsl }. Missing/malformed
 * manifests degrade to an empty manifest with the full body as GLSL — the
 * shader still renders, it just has no knobs.
 *
 * The raw captured body may contain an escaped `</script` breakout marker
 * (see {@link escapeShaderScriptBreakout}); it is unescaped here, after
 * manifest-comment splitting, so callers always get back the original,
 * editable GLSL source.
 */
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

/** Serialize a full `<script type="application/x-agent-native-shader">` block. */
export function serializeShaderScriptBlock(def: GlslShaderDef): string {
  const validation = validateShaderDef(def);
  if (!validation.valid) {
    throw new Error(
      "Invalid shader definition: " + validation.errors.join("; "),
    );
  }
  return (
    `<script type="${SHADER_SCRIPT_TYPE}"` +
    ` data-shader-id="${escapeAttr(def.id)}"` +
    ` data-shader-name="${escapeAttr(def.name)}"` +
    ` data-shader-mode="${def.mode}">\n` +
    serializeManifestComment(def.uniforms) +
    "\n" +
    escapeShaderScriptBreakout(def.glsl.trim()) +
    "\n</script>"
  );
}

const SHADER_BLOCK_RE = new RegExp(
  '<script\\b([^>]*type\\s*=\\s*"' +
    escapeRegExp(SHADER_SCRIPT_TYPE) +
    '"[^>]*)>([\\s\\S]*?)<\\/script\\s*>',
  "gi",
);

function readAttrFrom(attrs: string, name: string): string | null {
  const match = new RegExp(name + '\\s*=\\s*"([^"]*)"', "i").exec(attrs);
  return match ? unescapeAttr(match[1]) : null;
}

/** Parse every shader definition block out of a screen HTML document. */
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

/** Find one shader definition by id. */
export function getShaderFromHtml(
  html: string,
  id: string,
): GlslShaderDef | undefined {
  return listShadersInHtml(html).find((def) => def.id === id);
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

/** Insert or replace a shader definition block in the document. */
export function upsertShaderInHtml(html: string, def: GlslShaderDef): string {
  const block = serializeShaderScriptBlock(def);
  const existing = findShaderBlockSpan(html, def.id);
  if (existing) {
    return html.slice(0, existing.start) + block + html.slice(existing.end);
  }
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + block + "\n" + html.slice(bodyClose);
  }
  const htmlClose = html.toLowerCase().lastIndexOf("</html>");
  if (htmlClose !== -1) {
    return html.slice(0, htmlClose) + block + "\n" + html.slice(htmlClose);
  }
  return html + "\n" + block + "\n";
}

/** Remove a shader definition block (references are left untouched). */
export function removeShaderFromHtml(html: string, id: string): string {
  const span = findShaderBlockSpan(html, id);
  if (!span) return html;
  let start = span.start;
  // Also consume the preceding line's indentation/newline for tidiness.
  while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) {
    start--;
  }
  let end = span.end;
  if (html[end] === "\r") end++;
  if (html[end] === "\n") end++;
  return html.slice(0, start) + html.slice(end);
}

// ---------------------------------------------------------------------------
// Runtime embedding
// ---------------------------------------------------------------------------

/** The compiled, self-contained WebGL runtime (see shader-runtime.bridge.ts). */
export const SHADER_RUNTIME_SOURCE: string = shaderRuntimeBridgeScript;

export function buildShaderRuntimeScriptTag(): string {
  return (
    `<script ${SHADER_RUNTIME_ATTR} data-runtime-version="${SHADER_RUNTIME_VERSION}">\n` +
    SHADER_RUNTIME_SOURCE +
    "\n</script>"
  );
}

const RUNTIME_BLOCK_RE = new RegExp(
  "<script\\s+" + SHADER_RUNTIME_ATTR + "[^>]*>[\\s\\S]*?<\\/script\\s*>",
  "i",
);

/**
 * Ensure the document embeds the current shader runtime exactly once,
 * upgrading any previously-embedded copy in place. Idempotent.
 */
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

/** True when the document has no shader references left. */
export function htmlHasShaderReferences(html: string): boolean {
  return (
    html.includes(SHADER_FILL_ATTR + '="') ||
    html.includes(SHADER_EFFECT_ATTR + '="')
  );
}

/** Remove definition blocks that no element references any more. */
export function pruneUnusedShaders(html: string): string {
  let out = html;
  for (const def of listShadersInHtml(html)) {
    const fillRef = `${SHADER_FILL_ATTR}="${escapeAttr(def.id)}"`;
    const effectRef = `${SHADER_EFFECT_ATTR}="${escapeAttr(def.id)}"`;
    if (!out.includes(fillRef) && !out.includes(effectRef)) {
      out = removeShaderFromHtml(out, def.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Element annotation (pure string transforms, no DOM)
// ---------------------------------------------------------------------------

/**
 * Locate the bounds of the open tag containing the given index. Scans
 * backward for "<" and forward for ">" while respecting quoted attribute
 * values. Returns null when the index isn't inside a plausible tag.
 */
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

function tagNameOf(tagText: string): string {
  const match = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tagText);
  return match ? match[1].toLowerCase() : "";
}

function removeAttr(tagText: string, name: string): string {
  return tagText.replace(
    new RegExp("\\s+" + name + "\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s/>]+)", "gi"),
    "",
  );
}

/** Upsert one declaration inside an inline style attribute. */
function upsertStyleProperty(
  tagText: string,
  property: string,
  value: string,
): string {
  const styleRe = /(\sstyle\s*=\s*")([^"]*)(")/i;
  const styleMatch = styleRe.exec(tagText);
  const decl = `${property}: ${value}`;
  if (!styleMatch) {
    const insertAt = tagText.endsWith("/>")
      ? tagText.length - 2
      : tagText.length - 1;
    return (
      tagText.slice(0, insertAt) +
      ` style="${escapeAttr(decl)}"` +
      tagText.slice(insertAt)
    );
  }
  const existing = unescapeAttr(styleMatch[2]);
  const kept = existing
    .split(";")
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        !new RegExp("^" + escapeRegExp(property) + "\\s*:", "i").test(part),
    );
  kept.push(decl);
  const next = kept.join("; ");
  return (
    tagText.slice(0, styleMatch.index) +
    styleMatch[1] +
    escapeAttr(next) +
    styleMatch[3] +
    tagText.slice(styleMatch.index + styleMatch[0].length)
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

export interface AnnotateShaderNodeOptions {
  nodeId: string;
  shaderId: string;
  mode: GlslShaderMode;
  /** Per-element uniform overrides serialized to data-an-shader-uniforms. */
  values?: Record<string, GlslUniformValue>;
  /**
   * Static fallback background written to the element's inline style
   * (fill mode only). Unsafe values are neutralized to #808080. When
   * omitted, the element's existing background is left untouched — pass it
   * on the initial apply, omit it for knob-value-only updates.
   */
  fallbackColor?: string;
}

export interface HtmlTransformResult {
  html: string;
  changed: boolean;
  errors: string[];
}

/**
 * Point an element (located by its stable data-agent-native-node-id) at a
 * shader definition. Replaces any previous shader annotation OF THE SAME
 * MODE on the node — a fill and an effect can coexist on one element,
 * mirroring Figma's paint/effect stacking.
 */
export function annotateNodeWithShader(
  html: string,
  options: AnnotateShaderNodeOptions,
): HtmlTransformResult {
  const errors: string[] = [];
  if (!ID_RE.test(options.shaderId)) {
    return { html, changed: false, errors: ["invalid shader id"] };
  }
  const located = locateNodeTag(html, options.nodeId);
  if (!located) {
    return {
      html,
      changed: false,
      errors: [
        `no element with data-agent-native-node-id="${options.nodeId}" found`,
      ],
    };
  }
  const tagName = tagNameOf(located.tagText);
  if (VOID_TAGS.has(tagName)) {
    return {
      html,
      changed: false,
      errors: [
        `<${tagName}> cannot host a shader canvas — wrap it in a container ` +
          "element and apply the shader there",
      ],
    };
  }

  const isEffect = options.mode === "effect";
  const refAttr = isEffect ? SHADER_EFFECT_ATTR : SHADER_FILL_ATTR;
  const valuesAttr = isEffect
    ? SHADER_EFFECT_UNIFORMS_ATTR
    : SHADER_UNIFORMS_ATTR;

  let tagText = located.tagText;
  tagText = removeAttr(tagText, refAttr);
  tagText = removeAttr(tagText, valuesAttr);

  let insertion = ` ${refAttr}="${escapeAttr(options.shaderId)}"`;
  if (options.values && Object.keys(options.values).length > 0) {
    const json = JSON.stringify(options.values);
    insertion += ` ${valuesAttr}="${escapeAttr(json)}"`;
  }

  const selfClosing = tagText.endsWith("/>");
  const insertAt = selfClosing ? tagText.length - 2 : tagText.length - 1;
  tagText = tagText.slice(0, insertAt) + insertion + tagText.slice(insertAt);

  if (options.mode === "fill" && options.fallbackColor !== undefined) {
    tagText = upsertStyleProperty(
      tagText,
      "background",
      sanitizeShaderFallbackColor(options.fallbackColor),
    );
  }

  const nextHtml =
    html.slice(0, located.start) + tagText + html.slice(located.end);
  return { html: nextHtml, changed: nextHtml !== html, errors };
}

/**
 * Remove shader annotations from an element (fallback background stays).
 * Pass `mode` to clear only the fill or only the effect; omit to clear both.
 */
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

/** Parse every element ↔ shader reference out of the document. */
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

// ---------------------------------------------------------------------------
// High-level apply (the one-call transform the inspector + agent use)
// ---------------------------------------------------------------------------

export interface ApplyShaderOptions {
  nodeId: string;
  def: GlslShaderDef;
  /** Per-element uniform value overrides. */
  values?: Record<string, GlslUniformValue>;
  /** Fill-mode static fallback background color. */
  fallbackColor?: string;
}

/**
 * The complete persistence transform: upsert the definition block, embed or
 * upgrade the runtime, and annotate the target element. Pure string → string;
 * callers persist the result through their normal write path
 * (apply-source-edit / edit-design / collab).
 */
export function applyShaderToHtml(
  html: string,
  options: ApplyShaderOptions,
): HtmlTransformResult {
  const validation = validateShaderDef(options.def);
  if (!validation.valid) {
    return { html, changed: false, errors: validation.errors };
  }
  let next = upsertShaderInHtml(html, options.def);
  next = ensureShaderRuntime(next);
  const annotated = annotateNodeWithShader(next, {
    nodeId: options.nodeId,
    shaderId: options.def.id,
    mode: options.def.mode,
    values: options.values,
    fallbackColor: options.fallbackColor,
  });
  if (annotated.errors.length > 0) {
    return { html, changed: false, errors: annotated.errors };
  }
  return {
    html: annotated.html,
    changed: annotated.html !== html,
    errors: [],
  };
}

/**
 * Remove a shader from an element and garbage-collect any now-unreferenced
 * definition blocks (the runtime tag stays — it is inert without mounts).
 * Pass `mode` to remove only the fill or only the effect; omit for both.
 */
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

/** Default uniform values (manifest values) for fresh knob state. */
export function defaultUniformValues(
  def: GlslShaderDef,
): Record<string, GlslUniformValue> {
  const out: Record<string, GlslUniformValue> = {};
  for (const [name, u] of Object.entries(def.uniforms)) {
    out[name] = u.value;
  }
  return out;
}
