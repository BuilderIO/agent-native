
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


export interface CompileResult {
  css: string;
  hash: string;
}

export function compile(timeline: MotionTimeline): CompileResult {
  const { tracks, durationMs, defaultEase } = timeline;
  assertSafeMotionCssToken(defaultEase, "defaultEase");

  if (!tracks || tracks.length === 0) {
    const css = reducedMotionBlock([]);
    return { css, hash: djb2(css) };
  }

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

  const sorted = [...tracks].sort((a, b) => {
    const cmp = a.targetNodeId.localeCompare(b.targetNodeId);
    return cmp !== 0 ? cmp : a.property.localeCompare(b.property);
  });

  for (const track of sorted) {
    const { targetNodeId, property, keyframes } = track;
    if (!keyframes || keyframes.length === 0) continue;
    assertSafeMotionCssProperty(property, "track.property");

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

export function parsePlaybackMode(css: string): MotionPlaybackMode | null {
  return parseAnimationRules(css).playbackMode;
}

export function parseTimelineSpanMs(css: string): number | null {
  return timelineSpanFromRules(parseAnimationRules(css));
}

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

export function hashCss(css: string): string {
  return djb2(css);
}

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


const CSS_TOKEN_BREAKOUT_RE = /[;{}<>]|\/\*|\*\/|\burl\s*\(/i;
const CSS_TOKEN_CONTROL_RE = /[\u0000-\u001f\u007f]/;

function animationName(nodeId: string, property: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "_");
  const safeNode = safe(nodeId);
  const suffix =
    safeNode === nodeId ? "" : `_${djb2Num(nodeId).toString(36).slice(-4)}`;
  return `an-motion-${safeNode}${suffix}--${safe(property)}`;
}

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

function cssEase(ease: MotionEase): string {
  const raw = String(ease);
  const converted = motionEaseToCss(raw);
  if (converted !== raw) {
    assertSafeMotionCssToken(converted, "compiled spring ease");
  }
  return converted;
}

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

function formatDuration(ms: number): string {
  const s = (ms / 1000).toFixed(3).replace(/\.?0+$/, "");
  return `${s}s`;
}

function formatPercent(t: number): string {
  if (t <= 0) return "0%";
  if (t >= 1) return "100%";
  const pct = Math.round(t * 10000) / 100;
  if (pct >= 100) return "99.99%";
  if (pct <= 0) return "0.01%";
  return `${pct}%`;
}

function escAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescAttr(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

interface ParsedAnimationRuleEntry {
  targetNodeId: string;
  delayMs?: number;
  durationMs?: number;
}

interface ParsedAnimationRules {
  byName: Map<string, ParsedAnimationRuleEntry>;
  playbackMode: MotionPlaybackMode | null;
}

function parseCssTimeMs(value: string): number | null {
  const m = /^([\d.]+)(ms|s)$/.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(m[2] === "ms" ? n : n * 1000);
}

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

    const propMatch = content.match(propRe);
    const value = propMatch ? propMatch[1].trim() : "";

    frames.push({ t, value, ...(ease !== undefined ? { ease } : {}) });
  }

  return frames;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function djb2Num(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function djb2(str: string): string {
  return djb2Num(str).toString(10);
}
