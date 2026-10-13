import {
  assertValidMotionEasingVariables,
  isMotionEaseVariableReference,
  motionEaseToCss,
  motionEaseVariableId,
  motionEaseVariableName,
  motionEaseVariableToken,
  resolveMotionEase,
} from "./motion-easing";
import type { MotionEasingVariable } from "./motion-easing";
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
  formatMotionPosition,
  isMotionPathSegmentV1,
  motionPathCubicPoints,
  motionPathSegmentLength,
  motionTimelineDurationForTracks,
  parseMotionPosition,
  readTimelinePlaybackMode,
  type MotionPathPoint,
} from "./motion-timeline";

export interface CompileResult {
  css: string;
  hash: string;
}

export class MotionCssSourceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MotionCssSourceParseError";
  }
}

export interface MotionCompileOptions {
  easingVariables?: readonly MotionEasingVariable[];
}

export function compile(
  timeline: MotionTimeline,
  options: MotionCompileOptions = {},
): CompileResult {
  const { defaultEase } = timeline;
  const tracks = timeline.tracks.filter((track) => track.enabled !== false);
  const easingVariables = options.easingVariables ?? [];
  assertValidMotionEasingVariables(easingVariables);
  assertSafeMotionCssToken(defaultEase, "defaultEase");
  assertMotionEase(defaultEase, "defaultEase", easingVariables);
  const easingVariablesCss = compileEasingVariables(easingVariables);
  const durationMs = motionTimelineDurationForTracks(
    timeline.durationMs,
    tracks,
  );

  if (!tracks || tracks.length === 0) {
    const css = [easingVariablesCss, reducedMotionBlock([])]
      .filter(Boolean)
      .join("\n\n");
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
      pathDeclarations?: string[];
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
    const spatialPath = compileSpatialPath(property, sortedKeyframes);
    kfBlocks.push(
      property === "path-trim"
        ? pathTrimKeyframesBlock(
            name,
            sortedKeyframes,
            defaultEase,
            easingVariables,
          )
        : keyframesBlock(
            name,
            spatialPath ? "offset-distance" : property,
            sortedKeyframes,
            defaultEase,
            spatialPath?.keyframeValues,
            easingVariables,
          ),
    );

    const timing = getMotionTrackTiming(track, durationMs);
    const dur = formatDuration(timing.durationMs);
    const ease = sortedKeyframes[0]?.ease ?? defaultEase;
    assertSafeMotionCssToken(ease, "track ease");
    assertMotionEase(ease, "track ease", easingVariables);
    const targetRule = rulesByTarget.get(targetNodeId) ?? {
      names: [],
      durations: [],
      timings: [],
      fillModes: [],
      delays: [],
      hasDelay: false,
      pathDeclarations: [],
    };
    targetRule.names.push(name);
    targetRule.durations.push(dur);
    targetRule.timings.push(cssEase(ease, easingVariables));
    targetRule.fillModes.push("both");
    targetRule.delays.push(formatDuration(timing.startMs));
    if (spatialPath) {
      targetRule.pathDeclarations!.push(
        `  offset-path: path("${spatialPath.pathData}");`,
        "  offset-anchor: 0px 0px;",
        "  offset-rotate: 0deg;",
        `  translate: ${spatialPath.baseValue};`,
      );
    }
    if (timing.startMs > 0) targetRule.hasDelay = true;
    rulesByTarget.set(targetNodeId, targetRule);
  }

  const sortedTargets = [...rulesByTarget.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const ruleBlocks = sortedTargets.map(([targetNodeId, rule]) => {
    const lines = [
      ...(rule.pathDeclarations ?? []),
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
    ...(easingVariablesCss ? [easingVariablesCss] : []),
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
    const keyframes =
      decoded.property === "translate" && info?.offsetPath
        ? parseSpatialPathKeyframes(body, info)
        : decoded.property === "path-trim"
          ? parsePathTrimKeyframeBody(body)
          : parseKeyframeBody(body, decoded.property);
    if (!keyframes) {
      throw new MotionCssSourceParseError(
        `Motion CSS for "${decoded.targetNodeId}" contains a path animation that cannot be read losslessly.`,
      );
    }
    const track: MotionTrack = {
      targetNodeId: info?.targetNodeId ?? decoded.targetNodeId,
      property: decoded.property,
      keyframes,
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
  values?: string[],
  easingVariables: readonly MotionEasingVariable[] = [],
): string {
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);
  const stops = sorted.map((kf, index) => {
    const pct = formatPercent(kf.t);
    const ease = kf.ease ?? defaultEase;
    assertSafeMotionCssToken(kf.value, "keyframe value");
    assertSafeMotionCssToken(ease, "keyframe ease");
    assertMotionEase(ease, "keyframe ease", easingVariables);
    return (
      `  ${pct} {\n` +
      `    ${property}: ${values?.[index] ?? kf.value};\n` +
      `    animation-timing-function: ${cssEase(ease, easingVariables)};\n` +
      `  }`
    );
  });
  return `@keyframes ${name} {\n${stops.join("\n")}\n}`;
}

function pathTrimKeyframesBlock(
  name: string,
  keyframes: MotionKeyframe[],
  defaultEase: MotionEase,
  easingVariables: readonly MotionEasingVariable[],
): string {
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);
  const stops = sorted.map((keyframe) => {
    const value = parsePathTrimValue(keyframe.value);
    if (!value) {
      throw new Error(
        'Motion Path trim values must be two percentages between 0 and 100, formatted as "start% end%".',
      );
    }
    const pct = formatPercent(keyframe.t);
    const ease = keyframe.ease ?? defaultEase;
    assertSafeMotionCssToken(keyframe.value, "Path trim keyframe value");
    assertSafeMotionCssToken(ease, "keyframe ease");
    assertMotionEase(ease, "keyframe ease", easingVariables);
    const length =
      value.end >= value.start
        ? value.end - value.start
        : 100 - value.start + value.end;
    return (
      `  ${pct} {\n` +
      `    --an-motion-path-trim: ${keyframe.value};\n` +
      `    stroke-dasharray: ${formatPathTrimNumber(length)} ${formatPathTrimNumber(100 - length)};\n` +
      `    stroke-dashoffset: ${formatPathTrimNumber(-value.start)};\n` +
      `    animation-timing-function: ${cssEase(ease, easingVariables)};\n` +
      `  }`
    );
  });
  return `@keyframes ${name} {\n${stops.join("\n")}\n}`;
}

function parsePathTrimKeyframeBody(body: string): MotionKeyframe[] | null {
  const frames: MotionKeyframe[] = [];
  const stopRe = /([\d.]+%|from|to)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = stopRe.exec(body)) !== null) {
    const content = match[2];
    const valueMatch = /^\s*--an-motion-path-trim\s*:\s*([^;]+)\s*;/m.exec(
      content,
    );
    if (!valueMatch || !parsePathTrimValue(valueMatch[1]!.trim())) return null;
    const pct = match[1];
    const t = pct === "from" ? 0 : pct === "to" ? 1 : parseFloat(pct) / 100;
    const easeMatch = content.match(/animation-timing-function\s*:\s*([^;]+)/);
    frames.push({
      t,
      value: valueMatch[1]!.trim(),
      ...(easeMatch ? { ease: easeMatch[1]!.trim() as MotionEase } : {}),
    });
  }
  return frames.length > 0 ? frames : null;
}

function parsePathTrimValue(
  value: string,
): { start: number; end: number } | null {
  const match =
    /^\s*((?:\d+(?:\.\d*)?|\.\d+))%\s+((?:\d+(?:\.\d*)?|\.\d+))%\s*$/.exec(
      value,
    );
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 0 || start > 100 || end < 0 || end > 100) return null;
  return { start, end };
}

function formatPathTrimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function cssEase(
  ease: MotionEase,
  easingVariables: readonly MotionEasingVariable[] = [],
): string {
  const raw = String(ease);
  if (isMotionEaseVariableReference(raw)) {
    const id = motionEaseVariableId(raw);
    if (id === null) {
      throw new Error(`Invalid motion easing variable reference: "${raw}".`);
    }
    resolveMotionEase(raw, easingVariables);
    return motionEaseVariableToken(id);
  }
  const converted = motionEaseToCss(resolveMotionEase(raw, easingVariables));
  if (converted !== raw) {
    assertSafeMotionCssToken(converted, "compiled spring ease");
  }
  return converted;
}

function assertMotionEase(
  ease: MotionEase,
  field: string,
  easingVariables: readonly MotionEasingVariable[],
): void {
  try {
    resolveMotionEase(ease, easingVariables);
  } catch (error) {
    throw new Error(
      `Invalid ${field}: it is not a valid timing function. ${error instanceof Error ? error.message : "Unsupported timing function."}`,
    );
  }
}

function compileEasingVariables(
  variables: readonly MotionEasingVariable[],
): string {
  if (variables.length === 0) return "";
  const declarations = variables.map((variable) => {
    const value = motionEaseToCss(variable.value);
    assertSafeMotionCssToken(value, `easing variable "${variable.id}"`);
    return `  ${motionEaseVariableName(variable.id)}: ${value};`;
  });
  return `:root {\n${declarations.join("\n")}\n}`;
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
  offsetPath?: string;
  translate?: string;
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
  const declarationOf = (body: string, prop: string): string | undefined => {
    const match = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(
      body,
    );
    return match?.[1]?.trim();
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
      const offsetPath = declarationOf(body, "offset-path");
      const translate = declarationOf(body, "translate");
      if (offsetPath) entry.offsetPath = offsetPath;
      if (translate) entry.translate = translate;
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

interface CompiledSpatialPath {
  baseValue: string;
  pathData: string;
  keyframeValues: string[];
}

function compileSpatialPath(
  property: string,
  keyframes: MotionKeyframe[],
): CompiledSpatialPath | null {
  const hasSpatialPath = keyframes.some((keyframe) => keyframe.motionPath);
  if (!hasSpatialPath) return null;
  if (property !== "translate") {
    throw new Error(
      'Cubic motion paths are only supported for the "translate" Position property.',
    );
  }
  if (keyframes.length < 2) {
    throw new Error(
      "Cubic motion paths require at least two Position keyframes.",
    );
  }
  if (keyframes[keyframes.length - 1]?.motionPath) {
    throw new Error(
      "The final Position keyframe cannot own an outgoing motion path.",
    );
  }

  const positions = keyframes.map((keyframe) => {
    if (keyframe.motionPath && !isMotionPathSegmentV1(keyframe.motionPath)) {
      throw new Error(
        "Position motion paths must use the version 1 cubic format.",
      );
    }
    const position = parseMotionPosition(keyframe.value);
    if (!position) {
      throw new Error(
        "Cubic Position motion paths require finite px values or unitless zero; calc(), percentages, and other units are not supported.",
      );
    }
    return position;
  });
  const first = positions[0]!;
  const pathCommands = [`M 0 0`];
  const segmentLengths: number[] = [];
  const segmentPoints: ReturnType<typeof motionPathCubicPoints>[] = [];
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const points = motionPathCubicPoints(
      positions[index]!,
      positions[index + 1]!,
      keyframes[index]!.motionPath,
    );
    segmentPoints.push(points);
    segmentLengths.push(motionPathSegmentLength(points));
    const relative = (point: MotionPathPoint) => ({
      x: point.x - first.x,
      y: point.y - first.y,
    });
    const control1 = relative(points.control1);
    const control2 = relative(points.control2);
    const end = relative(points.end);
    pathCommands.push(
      `C ${formatPathNumber(control1.x)} ${formatPathNumber(control1.y)} ` +
        `${formatPathNumber(control2.x)} ${formatPathNumber(control2.y)} ` +
        `${formatPathNumber(end.x)} ${formatPathNumber(end.y)}`,
    );
  }

  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  let distance = 0;
  const keyframeValues = ["0%"];
  for (let index = 0; index < segmentLengths.length; index += 1) {
    distance += segmentLengths[index]!;
    keyframeValues.push(
      totalLength > 0
        ? `${formatPathNumber((distance / totalLength) * 100)}%`
        : "0%",
    );
  }

  return {
    baseValue: formatMotionPosition(first),
    pathData: pathCommands.join(" "),
    keyframeValues,
  };
}

function formatPathNumber(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}

interface ParsedPathCubic {
  start: MotionPathPoint;
  control1: MotionPathPoint;
  control2: MotionPathPoint;
  end: MotionPathPoint;
}

function parseSpatialPathKeyframes(
  body: string,
  info: ParsedAnimationRuleEntry,
): MotionKeyframe[] | null {
  if (!info.offsetPath || !info.translate) return null;
  const pathMatch = /^path\((['"])([\s\S]*)\1\)$/i.exec(info.offsetPath);
  if (!pathMatch) return null;
  const baseValue = parseMotionPosition(info.translate);
  if (!baseValue) return null;
  const segments = parseCubicPath(pathMatch[2]!);
  if (!segments || segments.length === 0) return null;

  const rawFrames = parseKeyframeBody(body, "offset-distance");
  if (rawFrames.length !== segments.length + 1) return null;
  const lengths = segments.map((segment) => motionPathSegmentLength(segment));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  let cumulative = 0;
  const frames: MotionKeyframe[] = [];
  for (let index = 0; index < rawFrames.length; index += 1) {
    const rawDistance = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/.exec(
      rawFrames[index]!.value,
    );
    const expectedDistance =
      totalLength > 0 ? (cumulative / totalLength) * 100 : 0;
    if (
      !rawDistance ||
      Math.abs(Number(rawDistance[1]) - expectedDistance) > 0.02
    ) {
      return null;
    }
    const position =
      index === 0 ? segments[0]!.start : segments[index - 1]!.end;
    const frame: MotionKeyframe = {
      t: rawFrames[index]!.t,
      value: formatMotionPosition({
        x: baseValue.x + position.x,
        y: baseValue.y + position.y,
      }),
      ...(rawFrames[index]!.ease !== undefined
        ? { ease: rawFrames[index]!.ease }
        : {}),
    };
    if (index < segments.length) {
      const segment = segments[index]!;
      const dx = segment.end.x - segment.start.x;
      const dy = segment.end.y - segment.start.y;
      const control1 = {
        x: segment.control1.x - segment.start.x,
        y: segment.control1.y - segment.start.y,
      };
      const control2 = {
        x: segment.control2.x - segment.end.x,
        y: segment.control2.y - segment.end.y,
      };
      if (
        Math.hypot(control1.x - dx / 3, control1.y - dy / 3) > 0.0001 ||
        Math.hypot(control2.x + dx / 3, control2.y + dy / 3) > 0.0001
      ) {
        frame.motionPath = {
          version: 1,
          type: "cubic",
          control1,
          control2,
        };
      }
    }
    frames.push(frame);
    if (index < lengths.length) cumulative += lengths[index]!;
  }
  return frames;
}

function parseCubicPath(pathData: string): ParsedPathCubic[] | null {
  const tokens = pathData.trim().split(/\s+/);
  if (tokens[0] !== "M" || tokens.length < 3) return null;
  const number = (token: string | undefined) => {
    if (!token || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) return null;
    const value = Number(token);
    return Number.isFinite(value) ? value : null;
  };
  let cursor: MotionPathPoint = {
    x: number(tokens[1]!) ?? Number.NaN,
    y: number(tokens[2]!) ?? Number.NaN,
  };
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
  const segments: ParsedPathCubic[] = [];
  let index = 3;
  while (index < tokens.length) {
    if (tokens[index] !== "C" || index + 6 >= tokens.length) return null;
    const values = tokens.slice(index + 1, index + 7).map(number);
    if (values.some((value) => value === null)) return null;
    const [x1, y1, x2, y2, x, y] = values as number[];
    const end = { x, y };
    segments.push({
      start: cursor,
      control1: { x: x1, y: y1 },
      control2: { x: x2, y: y2 },
      end,
    });
    cursor = end;
    index += 7;
  }
  return segments;
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
