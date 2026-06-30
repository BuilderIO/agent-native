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

import type {
  MotionEase,
  MotionKeyframe,
  MotionTimeline,
  MotionTrack,
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

  if (!tracks || tracks.length === 0) {
    const css = reducedMotionBlock([]);
    return { css, hash: djb2(css) };
  }

  const animNames: string[] = [];
  const kfBlocks: string[] = [];
  const ruleBlocks: string[] = [];

  // Sort tracks for determinism: targetNodeId ASC, property ASC.
  const sorted = [...tracks].sort((a, b) => {
    const cmp = a.targetNodeId.localeCompare(b.targetNodeId);
    return cmp !== 0 ? cmp : a.property.localeCompare(b.property);
  });

  for (const track of sorted) {
    const { targetNodeId, property, keyframes } = track;
    if (!keyframes || keyframes.length === 0) continue;

    const name = animationName(targetNodeId, property);
    animNames.push(name);
    kfBlocks.push(keyframesBlock(name, property, keyframes, defaultEase));

    const dur = formatDuration(durationMs);
    const ease = keyframes[0]?.ease ?? defaultEase;
    ruleBlocks.push(
      `[data-agent-native-node-id="${escAttr(targetNodeId)}"] {\n` +
        `  animation-name: ${name};\n` +
        `  animation-duration: ${dur};\n` +
        `  animation-timing-function: ${ease};\n` +
        `  animation-fill-mode: both;\n` +
        `}`,
    );
  }

  const css = [...kfBlocks, ...ruleBlocks, reducedMotionBlock(animNames)].join(
    "\n\n",
  );
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
  const kfRe = /@keyframes\s+(an-motion-[^\s{]+)\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = kfRe.exec(css)) !== null) {
    const fullName = m[1];
    const decoded = decodeAnimationName(fullName);
    if (!decoded) continue;

    const bodyStart = m.index + m[0].length;
    const body = extractBlock(css, bodyStart);
    if (body === null) continue;

    tracks.push({
      targetNodeId: decoded.targetNodeId,
      property: decoded.property,
      keyframes: parseKeyframeBody(body),
    });
  }

  return tracks;
}

/**
 * Return the djb2 hash of a CSS string — useful for verifying stored
 * `compiled_hash` values without re-compiling a full timeline.
 */
export function hashCss(css: string): string {
  return djb2(css);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a deterministic CSS animation name from a node id and CSS property.
 * Non-ident characters are replaced with `_`.
 *
 * Format: `an-motion-<nodeId>--<property>`
 */
function animationName(nodeId: string, property: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "_");
  return `an-motion-${safe(nodeId)}--${safe(property)}`;
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
    return (
      `  ${pct} {\n` +
      `    ${property}: ${kf.value};\n` +
      `    animation-timing-function: ${ease};\n` +
      `  }`
    );
  });
  return `@keyframes ${name} {\n${stops.join("\n")}\n}`;
}

/**
 * Build the `@media (prefers-reduced-motion: reduce)` block.
 * Always emitted so managed blocks are easily identified by parsers.
 */
function reducedMotionBlock(names: string[]): string {
  if (names.length === 0) {
    return `@media (prefers-reduced-motion: reduce) {\n  /* no animations */\n}`;
  }
  // Disable every named animation on any element that carries it.
  const selector = names.map((n) => `[style*="${n}"]`).join(",\n  ");
  return (
    `@media (prefers-reduced-motion: reduce) {\n` +
    `  ${selector},\n` +
    `  [data-agent-native-node-id] {\n` +
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

/** Format a normalised time `t ∈ [0, 1]` as a CSS percentage string. */
function formatPercent(t: number): string {
  if (t <= 0) return "0%";
  if (t >= 1) return "100%";
  const pct = Math.round(t * 10000) / 100;
  return `${pct}%`;
}

/**
 * Escape a string for safe use as a CSS attribute selector value.
 * Escapes `\` and `"`.
 */
function escAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
function parseKeyframeBody(body: string): MotionKeyframe[] {
  const frames: MotionKeyframe[] = [];
  const stopRe = /([\d.]+%|from|to)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;

  while ((m = stopRe.exec(body)) !== null) {
    const pctStr = m[1];
    const content = m[2];
    const t =
      pctStr === "from" ? 0 : pctStr === "to" ? 1 : parseFloat(pctStr) / 100;

    const easeMatch = content.match(/animation-timing-function\s*:\s*([^;]+)/);
    const ease = easeMatch ? (easeMatch[1].trim() as MotionEase) : undefined;

    // Extract the first non-timing property as the animated value.
    const propMatch = content.match(
      /^(?!.*animation-timing-function)[a-zA-Z-]+\s*:\s*([^;]+)/m,
    );
    const value = propMatch ? propMatch[1].trim() : "";

    frames.push({ t, value, ...(ease !== undefined ? { ease } : {}) });
  }

  return frames;
}

/**
 * djb2 string hash — deterministic, no crypto dependency.
 * Returns a 32-bit unsigned integer as a decimal string.
 */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(10);
}
