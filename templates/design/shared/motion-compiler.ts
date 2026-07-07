/**
 * Pure, side-effect-free motion compiler for the Design Studio (§6.3).
 *
 * Converts a `MotionTimeline` (JSON tracks) into a single managed
 * `<style data-agent-native-motion>` block and back again.
 *
 * Guarantees:
 * - **Deterministic**: given the same input, output is byte-identical.
 * - **Targets by node id**: rules use `[data-agent-native-node-id="<id>"]`
 *   selectors — no class/id coupling.
 * - **Reduced-motion safe**: always emits an
 *   `@media (prefers-reduced-motion: reduce)` block that disables every
 *   generated animation.
 * - **No dependencies**: uses djb2 (not crypto) for hashing.
 */

import { motionEaseToCss } from "./motion-easing";
import type {
  MotionEase,
  MotionKeyframe,
  MotionPlaybackMode,
  MotionTimeline,
  MotionTrack,
} from "./motion-timeline";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  getMotionTrackTiming,
  readTimelinePlaybackMode,
} from "./motion-timeline";

// ─── Public API ───────────────────────────────────────────────────────────────

/** Result of {@link compile}. */
export interface CompileResult {
  /**
   * Full CSS string — the body of the managed `<style data-agent-native-motion>`
   * block (no enclosing tag).
   */
  css: string;
  /**
   * djb2 decimal hash of `css`. Stored in `motion_timeline.compiled_hash` so
   * `apply-motion-edit` can detect drift between the JSON tracks and the CSS.
   */
  hash: string;
}

/**
 * Compile a `MotionTimeline` into the CSS body of the managed style block.
 *
 * Output order (deterministic):
 * 1. `@keyframes` blocks, sorted by animation name.
 * 2. Element animation rules, sorted by node id then property.
 * 3. `@media (prefers-reduced-motion: reduce)` block.
 */
export function compile(timeline: MotionTimeline): CompileResult {
  const { tracks, durationMs, defaultEase } = timeline;
  assertSafeMotionCssToken(defaultEase, "defaultEase");

  if (!tracks || tracks.length === 0) {
    const css = reducedMotionBlock([]);
    return { css, hash: djb2(css) };
  }

  // Timeline-level playback mode: explicit field first, then the stamp
  // persisted in the tracks JSON, then the legacy default ("once").
  const playbackMode: MotionPlaybackMode =
    timeline.playbackMode ??
    readTimelinePlaybackMode(tracks) ??
    MOTION_DEFAULT_PLAYBACK_MODE;

  const kfBlocks: string[] = [];
  const rulesByTarget = new Map<
    string,
    {
      names: string[];
      durations: string[];
      timings: string[];
      fillModes: string[];
      delays: string[];
      hasDelay: boolean;
    }
  >();

  // Sort tracks for determinism: targetNodeId ASC, property ASC.
  const sorted = [...tracks].sort((a, b) => {
    const cmp = a.targetNodeId.localeCompare(b.targetNodeId);
    return cmp !== 0 ? cmp : a.property.localeCompare(b.property);
  });

  for (const track of sorted) {
    const { targetNodeId, property, keyframes } = track;
    if (!keyframes || keyframes.length === 0) continue;
    assertSafeMotionCssProperty(property, "track.property");

    // Sort ONCE per track: the editor may hand us keyframes in drag order, and
    // both the stop list and the element-rule ease must read time order.
    const sortedKeyframes = [...keyframes].sort((a, b) => a.t - b.t);

    const name = animationName(targetNodeId, property);
    kfBlocks.push(keyframesBlock(name, property, sortedKeyframes, defaultEase));

    const timing = getMotionTrackTiming(track, durationMs);
    const dur = formatDuration(timing.durationMs);
    const ease = sortedKeyframes[0]?.ease ?? defaultEase;
    assertSafeMotionCssToken(ease, "track ease");
    const targetRule = rulesByTarget.get(targetNodeId) ?? {
      names: [],
      durations: [],
      timings: [],
      fillModes: [],
      delays: [],
      hasDelay: false,
    };
    targetRule.names.push(name);
    targetRule.durations.push(dur);
    targetRule.timings.push(cssEase(ease));
    targetRule.fillModes.push("both");
    targetRule.delays.push(formatDuration(timing.startMs));
    if (timing.startMs > 0) targetRule.hasDelay = true;
    rulesByTarget.set(targetNodeId, targetRule);
  }

  const sortedTargets = [...rulesByTarget.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const ruleBlocks = sortedTargets.map(([targetNodeId, rule]) => {
    const lines = [
      `  animation-name: ${rule.names.join(", ")};`,
      `  animation-duration: ${rule.durations.join(", ")};`,
      `  animation-timing-function: ${rule.timings.join(", ")};`,
      `  animation-fill-mode: ${rule.fillModes.join(", ")};`,
    ];
    // Emit optional lines only when used, keeping legacy timelines
    // byte-identical to the previous compiler output.
    if (rule.hasDelay) {
      lines.push(`  animation-delay: ${rule.delays.join(", ")};`);
    }
    if (playbackMode !== "once") {
      lines.push(
        `  animation-iteration-count: ${rule.names
          .map(() => "infinite")
          .join(", ")};`,
      );
      if (playbackMode === "ping-pong") {
        lines.push(
          `  animation-direction: ${rule.names
            .map(() => "alternate")
            .join(", ")};`,
        );
      }
    }
    return (
      `[data-agent-native-node-id="${escAttr(targetNodeId)}"] {\n` +
      `${lines.join("\n")}\n` +
      `}`
    );
  });

  const css = [
    ...kfBlocks,
    ...ruleBlocks,
    reducedMotionBlock(sortedTargets.map(([targetNodeId]) => targetNodeId)),
  ].join("\n\n");
  return { css, hash: djb2(css) };
}

/**
 * Parse the CSS body of a managed `<style data-agent-native-motion>` block
 * back into `MotionTrack[]`.
 *
 * Best-effort round-trip. Does not recover `durationMs` or `defaultEase`
 * (those live on the DB row). Sufficient for drift detection and basic
 * editing recovery.
 */
export function parse(css: string): MotionTrack[] {
  const tracks: MotionTrack[] = [];
  const rules = parseAnimationRules(css);
  const timelineDurationMs = timelineSpanFromRules(rules);
  const kfRe = /@keyframes\s+(an-motion-[^\s{]+)\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = kfRe.exec(css)) !== null) {
    const fullName = m[1];
    const decoded = decodeAnimationName(fullName);
    if (!decoded) continue;

    const bodyStart = m.index + m[0].length;
    const body = extractBlock(css, bodyStart);
    if (body === null) continue;

    const info = rules.byName.get(fullName);
    const track: MotionTrack = {
      targetNodeId: info?.targetNodeId ?? decoded.targetNodeId,
      property: decoded.property,
      keyframes: parseKeyframeBody(body, decoded.property),
    };
    if (info?.delayMs !== undefined && info.delayMs > 0) {
      track.delayMs = info.delayMs;
    }
    // Only surface an explicit per-track duration when it differs from the
    // timeline duration (the first animation-duration in the CSS, which
    // CSS-recovery also uses as the recovered timeline duration).
    if (
      info?.durationMs !== undefined &&
      timelineDurationMs !== null &&
      info.durationMs !== timelineDurationMs
    ) {
      track.durationMs = info.durationMs;
    }
    tracks.push(track);
  }

  if (
    tracks.length > 0 &&
    rules.playbackMode &&
    rules.playbackMode !== "once"
  ) {
    tracks[0] = { ...tracks[0], timelinePlaybackMode: rules.playbackMode };
  }

  return tracks;
}

/**
 * Recover the timeline playback mode from a managed motion CSS body:
 * `animation-iteration-count: infinite` + `animation-direction: alternate`
 * → "ping-pong"; infinite alone → "loop"; finite/absent → "once". Returns
 * `null` when the CSS contains no element animation rules at all.
 */
export function parsePlaybackMode(css: string): MotionPlaybackMode | null {
  return parseAnimationRules(css).playbackMode;
}

/**
 * Recover the timeline's total span from a managed motion CSS body: the
 * maximum `animation-delay + animation-duration` across all compiled rules
 * (i.e. when the last track finishes). More robust than the first
 * `animation-duration` when tracks carry per-track offsets/durations.
 * Returns `null` when the CSS has no parsable durations.
 */
export function parseTimelineSpanMs(css: string): number | null {
  return timelineSpanFromRules(parseAnimationRules(css));
}

/**
 * Extract the CSS body from a managed `<style data-agent-native-motion>` block
 * inside an HTML document. Returns `null` when the document has no managed block
 * or the block is malformed.
 */
export function extractManagedMotionCss(html: string): string | null {
  const openRe = /<style\b(?=[^>]*\bdata-agent-native-motion\b)[^>]*>/i;
  const openMatch = openRe.exec(html);
  if (!openMatch) return null;

  const bodyStart = openMatch.index + openMatch[0].length;
  const afterOpen = html.slice(bodyStart);
  const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
  if (!closeMatch) return null;

  return afterOpen.slice(0, closeMatch.index).trim();
}

/**
 * Inject or replace the managed `<style data-agent-native-motion>` block in an
 * HTML document. Inserts before `</head>` when no managed block exists, or at
 * the top of the document when there is no `<head>`.
 */
export function injectManagedMotionCss(html: string, css: string): string {
  const openRe = /<style\b(?=[^>]*\bdata-agent-native-motion\b)[^>]*>/i;
  const openMatch = openRe.exec(html);
  const block = `<style data-agent-native-motion>\n${css}\n</style>`;

  if (openMatch) {
    const bodyStart = openMatch.index + openMatch[0].length;
    const afterOpen = html.slice(bodyStart);
    const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
    if (closeMatch) {
      const closeEnd = bodyStart + closeMatch.index + closeMatch[0].length;
      return html.slice(0, openMatch.index) + block + html.slice(closeEnd);
    }
  }

  const headClose = html.lastIndexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + block + "\n" + html.slice(headClose);
  }
  return block + "\n" + html;
}

/**
 * Return the djb2 hash of a CSS string — useful for verifying stored
 * `compiled_hash` values without re-compiling a full timeline.
 */
export function hashCss(css: string): string {
  return djb2(css);
}

/**
 * Parse the first `animation-duration` declaration in a managed motion CSS
 * body and return it in milliseconds, or `null` when absent/unparsable. Used
 * by CSS-recovery so a recovered timeline keeps the compiled duration instead
 * of inventing a default that the next save would then persist.
 */
export function parseFirstAnimationDurationMs(css: string): number | null {
  const m = /animation-duration\s*:\s*([^;]+)/.exec(css);
  if (!m) return null;
  const first = m[1].split(",")[0].trim();
  const value = /^([\d.]+)(ms|s)$/.exec(first);
  if (!value) return null;
  const n = parseFloat(value[1]);
  if (!Number.isFinite(n)) return null;
  const ms = value[2] === "ms" ? n : n * 1000;
  return ms > 0 ? Math.round(ms) : null;
}

/**
 * Reject caller-supplied CSS declaration values before interpolation into the
 * managed motion stylesheet. Motion values still allow useful CSS functions
 * such as `translateY(...)`, `calc(...)`, `cubic-bezier(...)`, and `var(...)`,
 * but block declaration/rule/style breakouts and remote-resource hooks.
 */
export function assertSafeMotionCssToken(value: string, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${field}: expected a CSS string value.`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Invalid ${field}: motion CSS values cannot be empty.`);
  }
  if (CSS_TOKEN_CONTROL_RE.test(value) || CSS_TOKEN_BREAKOUT_RE.test(value)) {
    throw new Error(
      `Invalid ${field}: semicolons, braces, comments, angle brackets, control characters, and url(...) are not allowed in motion CSS values.`,
    );
  }
  return value;
}

/**
 * Validate that a CSS property name is a safe CSS identifier.
 *
 * Accepts standard and vendor-prefixed property names (e.g. "opacity",
 * "transform", "-webkit-transform") and nothing else.
 */
export function assertSafeMotionCssProperty(
  property: string,
  field: string,
): string {
  if (!/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(property)) {
    throw new Error(
      `Invalid ${field}: "${property}" is not a valid CSS property identifier. ` +
        "Only ASCII letters, digits, hyphens, and an optional leading hyphen are allowed.",
    );
  }
  return property;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const CSS_TOKEN_BREAKOUT_RE = /[;{}<>]|\/\*|\*\/|\burl\s*\(/i;
const CSS_TOKEN_CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * Build a deterministic CSS animation name from a node id and CSS property.
 * Non-ident characters are replaced with `_`; when sanitisation changed the
 * node id, a short hash of the RAW id is appended so distinct ids that
 * sanitise identically (e.g. "a:b" vs "a_b") never collide.
 *
 * Format: `an-motion-<nodeId>[_<hash>]--<property>`
 */
function animationName(nodeId: string, property: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "_");
  const safeNode = safe(nodeId);
  const suffix =
    safeNode === nodeId ? "" : `_${djb2Num(nodeId).toString(36).slice(-4)}`;
  return `an-motion-${safeNode}${suffix}--${safe(property)}`;
}

/** Reverse `animationName` — returns `null` when the name doesn't match. */
function decodeAnimationName(
  name: string,
): { targetNodeId: string; property: string } | null {
  const prefix = "an-motion-";
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const sep = rest.indexOf("--");
  if (sep === -1) return null;
  return { targetNodeId: rest.slice(0, sep), property: rest.slice(sep + 2) };
}

/**
 * Build a `@keyframes` block for one (property, keyframes) pair.
 * Each stop sets `animation-timing-function` to control easing to the NEXT
 * stop (standard CSS keyframe easing semantics).
 */
function keyframesBlock(
  name: string,
  property: string,
  keyframes: MotionKeyframe[],
  defaultEase: MotionEase,
): string {
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);
  const stops = sorted.map((kf) => {
    const pct = formatPercent(kf.t);
    const ease = kf.ease ?? defaultEase;
    assertSafeMotionCssToken(kf.value, "keyframe value");
    assertSafeMotionCssToken(ease, "keyframe ease");
    return (
      `  ${pct} {\n` +
      `    ${property}: ${kf.value};\n` +
      `    animation-timing-function: ${cssEase(ease)};\n` +
      `  }`
    );
  });
  return `@keyframes ${name} {\n${stops.join("\n")}\n}`;
}

/**
 * Convert a model ease token to its CSS form for emission. `spring(...)`
 * tokens (not valid CSS) compile to sampled `linear(...)` stop lists; all
 * other tokens pass through unchanged. The converted output is re-validated
 * so nothing unsafe can enter the managed stylesheet.
 */
function cssEase(ease: MotionEase): string {
  const raw = String(ease);
  const converted = motionEaseToCss(raw);
  if (converted !== raw) {
    assertSafeMotionCssToken(converted, "compiled spring ease");
  }
  return converted;
}

/**
 * Build the `@media (prefers-reduced-motion: reduce)` block.
 * Always emitted so managed blocks are easily identified by parsers.
 *
 * Selects ONLY the node ids that carry compiled motion rules — a blanket
 * `[data-agent-native-node-id]` selector would disable every animation on
 * every stamped node, including ones this compiler does not manage.
 */
function reducedMotionBlock(targetNodeIds: string[]): string {
  if (targetNodeIds.length === 0) {
    return `@media (prefers-reduced-motion: reduce) {\n  /* no animations */\n}`;
  }
  const selector = targetNodeIds
    .map((id) => `[data-agent-native-node-id="${escAttr(id)}"]`)
    .join(",\n  ");
  return (
    `@media (prefers-reduced-motion: reduce) {\n` +
    `  ${selector} {\n` +
    `    animation: none !important;\n` +
    `  }\n` +
    `}`
  );
}

/** Format a millisecond duration as a CSS `<time>` value with trailing zeros stripped. */
function formatDuration(ms: number): string {
  const s = (ms / 1000).toFixed(3).replace(/\.?0+$/, "");
  return `${s}s`;
}

/**
 * Format a normalised time `t ∈ [0, 1]` as a CSS percentage string.
 * Interior stops are clamped away from 0% / 100% so a stop at e.g.
 * t = 0.99997 never rounds onto a real t = 1 stop (duplicate keyframe
 * selectors silently drop one of the two values).
 */
function formatPercent(t: number): string {
  if (t <= 0) return "0%";
  if (t >= 1) return "100%";
  const pct = Math.round(t * 10000) / 100;
  if (pct >= 100) return "99.99%";
  if (pct <= 0) return "0.01%";
  return `${pct}%`;
}

/**
 * Escape a string for safe use as a CSS attribute selector value.
 * Escapes `\` and `"`.
 */
function escAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescAttr(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

interface ParsedAnimationRuleEntry {
  targetNodeId: string;
  /** Recovered `animation-delay` for this animation name, ms. */
  delayMs?: number;
  /** Recovered `animation-duration` for this animation name, ms. */
  durationMs?: number;
}

interface ParsedAnimationRules {
  byName: Map<string, ParsedAnimationRuleEntry>;
  /** Recovered playback mode, or null when no element rules exist. */
  playbackMode: MotionPlaybackMode | null;
}

/** Parse a CSS `<time>` (e.g. "0.4s", "250ms") into milliseconds, or null. */
function parseCssTimeMs(value: string): number | null {
  const m = /^([\d.]+)(ms|s)$/.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(m[2] === "ms" ? n : n * 1000);
}

/** Max (delay + duration) across all parsed rules, or null when none. */
function timelineSpanFromRules(rules: ParsedAnimationRules): number | null {
  let span: number | null = null;
  for (const entry of rules.byName.values()) {
    if (entry.durationMs === undefined) continue;
    const end = (entry.delayMs ?? 0) + entry.durationMs;
    if (span === null || end > span) span = end;
  }
  return span !== null && span > 0 ? span : null;
}

function parseAnimationRules(css: string): ParsedAnimationRules {
  const byName = new Map<string, ParsedAnimationRuleEntry>();
  let playbackMode: MotionPlaybackMode | null = null;
  const ruleRe =
    /\[data-agent-native-node-id="((?:\\.|[^"\\])*)"\]\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;

  const listOf = (body: string, prop: string): string[] => {
    const match = body.match(
      new RegExp(`${prop.replace(/-/g, "\\-")}\\s*:\\s*([^;]+)`),
    );
    if (!match) return [];
    return match[1].split(",").map((part) => part.trim());
  };

  while ((m = ruleRe.exec(css)) !== null) {
    const targetNodeId = unescAttr(m[1]);
    const body = m[2];
    const names = listOf(body, "animation-name");
    if (names.length === 0) continue;
    const durations = listOf(body, "animation-duration");
    const delays = listOf(body, "animation-delay");
    const iterations = listOf(body, "animation-iteration-count");
    const directions = listOf(body, "animation-direction");

    if (playbackMode === null) {
      const infinite = iterations[0] === "infinite";
      const alternate = directions[0] === "alternate";
      playbackMode = infinite ? (alternate ? "ping-pong" : "loop") : "once";
    }

    names.forEach((name, index) => {
      if (!name) return;
      const entry: ParsedAnimationRuleEntry = { targetNodeId };
      const duration = parseCssTimeMs(durations[index] ?? durations[0] ?? "");
      if (duration !== null) entry.durationMs = duration;
      const delay = parseCssTimeMs(delays[index] ?? delays[0] ?? "");
      if (delay !== null) entry.delayMs = delay;
      byName.set(name, entry);
    });
  }

  return { byName, playbackMode };
}

/**
 * Find the content of the CSS block that starts just after position `start`
 * (i.e., just after the opening `{`). Returns `null` on unbalanced braces.
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

/** Parse the interior of a `@keyframes` block into `MotionKeyframe[]`. */
function parseKeyframeBody(body: string, property: string): MotionKeyframe[] {
  const frames: MotionKeyframe[] = [];
  const stopRe = /([\d.]+%|from|to)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  const propRe = new RegExp(
    `^\\s*${escapeRegExp(property)}\\s*:\\s*([^;]+)`,
    "m",
  );

  while ((m = stopRe.exec(body)) !== null) {
    const pctStr = m[1];
    const content = m[2];
    const t =
      pctStr === "from" ? 0 : pctStr === "to" ? 1 : parseFloat(pctStr) / 100;

    const easeMatch = content.match(/animation-timing-function\s*:\s*([^;]+)/);
    const ease = easeMatch ? (easeMatch[1].trim() as MotionEase) : undefined;

    // Extract the animated property's value. The compiler emits the same
    // property for every stop, so parsing by the decoded property avoids
    // confusing `animation-timing-function` with the animated value.
    const propMatch = content.match(propRe);
    const value = propMatch ? propMatch[1].trim() : "";

    frames.push({ t, value, ...(ease !== undefined ? { ease } : {}) });
  }

  return frames;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * djb2 string hash — deterministic, no crypto dependency.
 * Returns a 32-bit unsigned integer.
 */
function djb2Num(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** {@link djb2Num} as a decimal string (stored `compiled_hash` format). */
function djb2(str: string): string {
  return djb2Num(str).toString(10);
}
