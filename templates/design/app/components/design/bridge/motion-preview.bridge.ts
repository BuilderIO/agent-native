/**
 * Motion-preview bridge — injected into every Edit canvas iframe. Interact's document carries only the theme and links bridges.
 *
 * Allows the MotionDock's scrubbing preview to animate elements in ALL editor
 * modes without writing anything to the DB, Yjs state, or source files.
 *
 * Protocol (parent → iframe):
 *
 *   { type: 'motion-load-tracks', tracks: Array<{
 *       targetNodeId: string,
 *       property: string,
 *       keyframes: Array<{
 *         t: number, value: string, ease?: string,
 *         motionPath?: { version: 1, type: "cubic", control1: {x,y}, control2: {x,y} }
 *       }>,
 *       delayMs?: number,      // track start offset within the timeline
 *       durationMs?: number    // per-track span; omitted = whole timeline
 *     }>, defaultEase?: string, durationMs?: number }
 *     Load (or replace) the track list. Keyframe t ∈ [0, 1] is normalised to
 *     the TRACK's own span. defaultEase is the timeline-level fallback easing
 *     applied to any keyframe that omits its own `ease` (mirrors the compiled
 *     stylesheet); defaults to "ease". durationMs is the timeline duration,
 *     needed to map offset tracks; also refreshed by each motion-preview tick.
 *
 *   { type: 'motion-preview', t, durationMs }
 *     Seek all loaded tracks to normalised TIMELINE position t ∈ [0, 1] and
 *     apply interpolated CSS property values as inline styles on the matching
 *     [data-agent-native-node-id="…"] elements. Tracks with delayMs /
 *     durationMs map the timeline time into their own span, clamping outside
 *     it (animation-fill-mode: both semantics). Never writes to storage.
 *
 *   { type: 'motion-preview-clear' }
 *     Remove all motion-preview inline-style overrides and the in-memory
 *     track list. Called when the dock is closed or the timeline is discarded.
 *
 *   { type: 'motion-audio-load', clips: MotionAudioClip[] }
 *     Load durable audio URLs and their timeline, trim, volume, and mute data.
 *     Audio bytes stay in external file storage.
 *
 *   { type: 'motion-audio-state', timelineTimeMs, isPlaying }
 *     Seek or play loaded clips against the current timeline position. Seeking
 *     never starts playback; only an explicit play state does.
 *
 *   { type: 'motion-audio-clear' }
 *     Stop and release loaded audio elements when the dock is removed.
 *
 *   { type: 'motion-path-editing', enabled, targetNodeId }
 *     Show editable Position path geometry for the selected target.
 *
 *   { type: 'motion-origin-editing', enabled, targetNodeId }
 *     Show and drag the selected element's CSS transform-origin on the canvas.
 *
 * Iframe → parent: { type: 'motion-path-edit', targetNodeId, edits }
 *   Each edit identifies a Position keyframe and/or its outgoing segment.
 *   Endpoint values and changed cubic control offsets share one atomic gesture.
 *
 * Per-segment easing reads the ease of the keyframe LEAVING each interval,
 * following CSS keyframe timing semantics. Supported forms: CSS keywords, cubic-bezier(...),
 * steps(...), CSS linear(...) stop lists, and real spring physics via
 * spring(bounce[, settle]) tokens — keep the samplers in sync with
 * shared/motion-easing.ts. Playback modes (loop/once/ping-pong) live in the
 * MotionDock's rAF driver, which shapes the `t` values it sends here.
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  type MotionPathPoint = { x: number; y: number };
  type MotionPathSegment = {
    version: 1;
    type: "cubic";
    control1: MotionPathPoint;
    control2: MotionPathPoint;
  };
  type PreviewKeyframe = {
    t: number;
    value: string;
    ease?: string;
    motionPath?: MotionPathSegment;
  };
  type PreviewTrack = {
    targetNodeId: string;
    property: string;
    keyframes: PreviewKeyframe[];
    enabled?: boolean;
    delayMs?: number;
    durationMs?: number;
  };
  type PreviewEasingVariable = { id: string; value: string };
  type PreviewAudioClip = {
    id: string;
    sourceUrl: string;
    timelineStartMs: number;
    sourceTrimStartMs: number;
    durationMs: number;
    volume: number;
    muted: boolean;
  };
  type LoadedAudioClip = {
    clip: PreviewAudioClip;
    element: HTMLAudioElement;
    failed: boolean;
    pendingTime: number | null;
  };
  type PathDrag = {
    pointerId: number;
    kind: "endpoint" | "control1" | "control2";
    targetNodeId: string;
    keyframeIndex: number;
    startClientX: number;
    startClientY: number;
    keyframes: PreviewKeyframe[];
  };
  type MotionPoint = { x: number; y: number };
  type MotionOriginBox = {
    origin: MotionPoint;
    corners: [MotionPoint, MotionPoint, MotionPoint, MotionPoint];
    width: number;
    height: number;
  };
  type OriginDrag = {
    pointerId: number;
    targetNodeId: string;
    element: HTMLElement;
    corners: MotionOriginBox["corners"];
    originalValue: string;
    originalPriority: string;
    depth: string;
    value: string;
    pointer: MotionPoint;
    startPointer: MotionPoint;
  };
  var loadedTracks: PreviewTrack[] = [];
  var loadedAudioClips: LoadedAudioClip[] = [];
  var audioPlaybackActive = false;
  var loadedEasingVariables: PreviewEasingVariable[] = [];
  var loadedDefaultEase = "ease";
  var loadedTimelineDurationMs: number | null = null;
  var touchedProps: Record<string, string[]> = {};
  var originalInlineValues: Record<string, Record<string, string>> = {};
  var touchedAttributes: Record<string, string[]> = {};
  var originalAttributes: Record<string, Record<string, string | null>> = {};
  var elementCache: Record<string, HTMLElement | null> = {};
  var pathEditingEnabled = false;
  var pathEditingTargetNodeId: string | null = null;
  var pathOverlay: SVGSVGElement | null = null;
  var activePathDrag: PathDrag | null = null;
  var originEditingEnabled = false;
  var originEditingTargetNodeId: string | null = null;
  var originOverlay: SVGSVGElement | null = null;
  var activeOriginDrag: OriginDrag | null = null;
  var originPointerListenersInstalled = false;
  var lastOriginMarkerPositionSignature: string | null = "hidden";
  var pathOverlayNs = "http://www.w3.org/2000/svg";
  var pathOverlayAccentColor = "var(--design-editor-accent-color, Highlight)";
  var pathOverlaySurfaceColor = "Canvas";
  var pathPointerListenersInstalled = false;
  (window as unknown as Record<string, unknown>).__designMotionPreviewBridge =
    true;

  function resolveTrackElement(nodeId: string): HTMLElement | null {
    var cached = elementCache[nodeId];
    if (cached && document.contains(cached)) return cached;
    var el = document.querySelector(
      '[data-agent-native-node-id="' + nodeId + '"]',
    ) as HTMLElement | null;
    elementCache[nodeId] = el;
    return el;
  }

  function camelizeProp(prop: string): string {
    return String(prop).replace(/-([a-z])/g, function (_m: string, c: string) {
      return c.toUpperCase();
    });
  }

  function formatNum(n: number): string {
    if (!Number.isFinite(n)) return "0";
    return (Math.round(n * 10000) / 10000).toString();
  }

  function clamp255(x: number): number {
    return x < 0 ? 0 : x > 255 ? 255 : x;
  }
  function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  function parseAlpha(s: string): number {
    if (typeof s === "string" && s.indexOf("%") >= 0)
      return parseFloat(s) / 100;
    return parseFloat(s);
  }

  function hueToRgb(p: number, q: number, h: number): number {
    if (h < 0) h += 1;
    if (h > 1) h -= 1;
    if (h < 1 / 6) return p + (q - p) * 6 * h;
    if (h < 1 / 2) return q;
    if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
    return p;
  }

  function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    h = (((h % 360) + 360) % 360) / 360;
    s = clamp01(s);
    l = clamp01(l);
    if (s === 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [
      hueToRgb(p, q, h + 1 / 3) * 255,
      hueToRgb(p, q, h) * 255,
      hueToRgb(p, q, h - 1 / 3) * 255,
    ];
  }

  function parseColor(str: string): [number, number, number, number] | null {
    if (typeof str !== "string") return null;
    var s = str.trim();
    var hex = /^#([0-9a-fA-F]{3,8})$/.exec(s);
    if (hex) {
      var h = hex[1];
      if (h.length === 3 || h.length === 4) {
        return [
          parseInt(h.charAt(0) + h.charAt(0), 16),
          parseInt(h.charAt(1) + h.charAt(1), 16),
          parseInt(h.charAt(2) + h.charAt(2), 16),
          h.length === 4 ? parseInt(h.charAt(3) + h.charAt(3), 16) / 255 : 1,
        ];
      }
      if (h.length === 6 || h.length === 8) {
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
          h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
        ];
      }
      return null;
    }
    var rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (rgb) {
      var rp = rgb[1].split(/[\s,\/]+/).filter(function (x: string) {
        return x.length;
      });
      if (rp.length >= 3) {
        return [
          parseFloat(rp[0]),
          parseFloat(rp[1]),
          parseFloat(rp[2]),
          rp.length >= 4 ? parseAlpha(rp[3]) : 1,
        ];
      }
      return null;
    }
    var hsl = /^hsla?\(([^)]+)\)$/i.exec(s);
    if (hsl) {
      var hp = hsl[1].split(/[\s,\/]+/).filter(function (x: string) {
        return x.length;
      });
      if (hp.length >= 3) {
        var c = hslToRgb(
          parseFloat(hp[0]),
          parseFloat(hp[1]) / 100,
          parseFloat(hp[2]) / 100,
        );
        return [c[0], c[1], c[2], hp.length >= 4 ? parseAlpha(hp[3]) : 1];
      }
      return null;
    }
    return null;
  }

  function lerpColorArr(
    a: [number, number, number, number],
    b: [number, number, number, number],
    ratio: number,
  ): [number, number, number, number] {
    return [
      a[0] + (b[0] - a[0]) * ratio,
      a[1] + (b[1] - a[1]) * ratio,
      a[2] + (b[2] - a[2]) * ratio,
      a[3] + (b[3] - a[3]) * ratio,
    ];
  }

  function formatColor(c: [number, number, number, number]): string {
    var r = Math.round(clamp255(c[0]));
    var g = Math.round(clamp255(c[1]));
    var b = Math.round(clamp255(c[2]));
    var a = clamp01(c[3]);
    if (a >= 1) return "rgb(" + r + ", " + g + ", " + b + ")";
    return (
      "rgba(" +
      r +
      ", " +
      g +
      ", " +
      b +
      ", " +
      Math.round(a * 1000) / 1000 +
      ")"
    );
  }

  type Segment =
    | { lit: string }
    | { type: "color"; value: [number, number, number, number] }
    | { type: "num"; value: number; unit: string };

  function tokenizeSegments(str: string): Segment[] | null {
    if (typeof str !== "string") return null;
    var segs: Segment[] = [];
    var i = 0;
    var n = str.length;
    var litStart = 0;
    var colorRe = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/i;
    var numRe = /^[+-]?(?:\d+\.?\d*|\.\d+)/;
    while (i < n) {
      var rest = str.slice(i);
      var cm = colorRe.exec(rest);
      if (cm) {
        var parsed = parseColor(cm[0]);
        if (parsed) {
          if (i > litStart) segs.push({ lit: str.slice(litStart, i) });
          segs.push({ type: "color", value: parsed });
          i += cm[0].length;
          litStart = i;
          continue;
        }
      }
      var prevCh = i > 0 ? str.charAt(i - 1) : "";
      if (!/[a-zA-Z]/.test(prevCh)) {
        var nm = numRe.exec(rest);
        if (nm) {
          var numText = nm[0];
          var unit = "";
          var um = /^[a-z%]+/i.exec(str.slice(i + numText.length));
          if (um) unit = um[0];
          if (i > litStart) segs.push({ lit: str.slice(litStart, i) });
          segs.push({ type: "num", value: parseFloat(numText), unit: unit });
          i += numText.length + unit.length;
          litStart = i;
          continue;
        }
      }
      i++;
    }
    if (n > litStart) segs.push({ lit: str.slice(litStart, n) });
    return segs;
  }

  function segShape(segs: Segment[]): string {
    var parts: string[] = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      parts.push("lit" in s ? "L" + s.lit : "T" + s.type);
    }
    return parts.join("\x1f");
  }

  function cubicBezierY(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x: number,
  ): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var cx = 3 * x1;
    var bx = 3 * (x2 - x1) - cx;
    var ax = 1 - cx - bx;
    var cy = 3 * y1;
    var by = 3 * (y2 - y1) - cy;
    var ay = 1 - cy - by;
    function sampleX(u: number): number {
      return ((ax * u + bx) * u + cx) * u;
    }
    function sampleY(u: number): number {
      return ((ay * u + by) * u + cy) * u;
    }
    function sampleDX(u: number): number {
      return (3 * ax * u + 2 * bx) * u + cx;
    }
    var u = x;
    for (var i = 0; i < 8; i++) {
      var err = sampleX(u) - x;
      if (Math.abs(err) < 1e-6) return sampleY(u);
      var d = sampleDX(u);
      if (Math.abs(d) < 1e-6) break;
      u = Math.min(1, Math.max(0, u - err / d));
    }
    var lo = 0;
    var hi = 1;
    u = x;
    while (hi - lo > 1e-6) {
      u = (lo + hi) / 2;
      if (sampleX(u) < x) lo = u;
      else hi = u;
    }
    return sampleY(u);
  }

  function evalEase(ease: string | undefined, x: number): number {
    var clamped = x <= 0 ? 0 : x >= 1 ? 1 : x;
    var raw = String(ease == null ? "ease" : ease)
      .trim()
      .toLowerCase();
    var variableReference =
      /^var\(--an-motion-ease-([a-z0-9][a-z0-9-]{0,63})\)$/.exec(raw);
    if (variableReference) {
      var variableId = variableReference[1];
      var definition = loadedEasingVariables.find(function (candidate) {
        return candidate.id === variableId;
      });
      if (!definition) {
        throw new Error(
          "Motion preview easing variable is not defined: " + variableId,
        );
      }
      raw = definition.value.trim().toLowerCase();
    }
    if (raw === "linear") return clamped;
    if (raw === "step-start") return clamped > 0 ? 1 : 0;
    if (raw === "step-end") return clamped >= 1 ? 1 : 0;
    if (raw === "ease") return cubicBezierY(0.25, 0.1, 0.25, 1, clamped);
    if (raw === "ease-in") return cubicBezierY(0.42, 0, 1, 1, clamped);
    if (raw === "ease-out") return cubicBezierY(0, 0, 0.58, 1, clamped);
    if (raw === "ease-in-out") return cubicBezierY(0.42, 0, 0.58, 1, clamped);
    var bezier = /^cubic-bezier\(([^)]+)\)$/.exec(raw);
    if (bezier) {
      var parts = bezier[1].split(",");
      if (parts.length === 4) {
        var p0 = parseFloat(parts[0]);
        var p1 = parseFloat(parts[1]);
        var p2 = parseFloat(parts[2]);
        var p3 = parseFloat(parts[3]);
        if (
          Number.isFinite(p0) &&
          Number.isFinite(p1) &&
          Number.isFinite(p2) &&
          Number.isFinite(p3)
        ) {
          return cubicBezierY(
            Math.min(1, Math.max(0, p0)),
            p1,
            Math.min(1, Math.max(0, p2)),
            p3,
            clamped,
          );
        }
      }
    }
    var steps = /^steps\(([^)]+)\)$/.exec(raw);
    if (steps) {
      var stepArgs = steps[1].split(",");
      var count = parseInt(stepArgs[0], 10);
      if (Number.isFinite(count) && count > 0) {
        if (clamped >= 1) return 1;
        var pos = (stepArgs[1] || "").trim();
        var jumpStart = pos === "start" || pos === "jump-start";
        return Math.min(
          1,
          (Math.floor(clamped * count) + (jumpStart ? 1 : 0)) / count,
        );
      }
    }
    if (raw.indexOf("spring") === 0) {
      var spr = parseSpringEase(raw);
      if (spr) return sampleSpringAt(spr[0], spr[1], clamped);
      return clamped;
    }
    if (raw.indexOf("linear(") === 0) {
      var lin = evalCssLinear(raw, clamped);
      if (lin !== null) return lin;
    }
    return clamped;
  }

  function parseSpringEase(raw: string): [number, number] | null {
    if (/^spring$/.test(raw)) return [0.25, 1];
    var m = /^spring\(\s*([+-]?[\d.]+)\s*(?:,\s*([+-]?[\d.]+)\s*)?\)$/.exec(
      raw,
    );
    if (!m) return null;
    var bounce = parseFloat(m[1]);
    if (!Number.isFinite(bounce)) return null;
    var settle = m[2] === undefined ? 1 : parseFloat(m[2]);
    if (!Number.isFinite(settle)) return null;
    if (settle < 0.05) settle = 0.05;
    if (settle > 1) settle = 1;
    return [clamp01(bounce), settle];
  }

  function sampleSpringAt(bounce: number, settle: number, x: number): number {
    if (x <= 0) return 0;
    var u = x / settle;
    if (u >= 1) return 1;
    var zeta = 1 - clamp01(bounce);
    if (zeta < 0.02) zeta = 0.02;
    if (zeta > 1) zeta = 1;
    var omega = Math.log(1 / 0.001) / zeta;
    if (zeta >= 1) {
      return 1 - Math.exp(-omega * u) * (1 + omega * u);
    }
    var omegaD = omega * Math.sqrt(1 - zeta * zeta);
    var decay = Math.exp(-zeta * omega * u);
    return (
      1 -
      decay *
        (Math.cos(omegaD * u) +
          ((zeta * omega) / omegaD) * Math.sin(omegaD * u))
    );
  }

  function evalCssLinear(raw: string, x: number): number | null {
    var m = /^linear\(([^)]*)\)$/.exec(raw);
    if (!m) return null;
    var entries = m[1].split(",");
    var values: number[] = [];
    var positions: Array<number | null> = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i].trim();
      if (!entry) continue;
      var parts = entry.split(/\s+/);
      var value = parseFloat(parts[0]);
      if (!Number.isFinite(value)) return null;
      var found = 0;
      for (var j = 1; j < parts.length && j <= 2; j++) {
        if (!/%$/.test(parts[j])) return null;
        var pct = parseFloat(parts[j]);
        if (!Number.isFinite(pct)) return null;
        values.push(value);
        positions.push(pct / 100);
        found++;
      }
      if (found === 0) {
        values.push(value);
        positions.push(null);
      }
    }
    if (values.length < 2) return null;
    if (positions[0] === null) positions[0] = 0;
    if (positions[positions.length - 1] === null) {
      positions[positions.length - 1] = 1;
    }
    var runningMax = positions[0] as number;
    for (var k = 0; k < positions.length; k++) {
      var pos = positions[k];
      if (pos !== null) {
        var clampedPos = pos < runningMax ? runningMax : pos;
        positions[k] = clampedPos;
        runningMax = clampedPos;
        continue;
      }
      var nextIdx = k + 1;
      while (nextIdx < positions.length && positions[nextIdx] === null) {
        nextIdx++;
      }
      var prevPos = runningMax;
      var nextPosRaw = positions[nextIdx] as number;
      var nextPos = nextPosRaw < prevPos ? prevPos : nextPosRaw;
      var span = nextIdx - (k - 1);
      for (var q = k; q < nextIdx; q++) {
        positions[q] = prevPos + ((q - (k - 1)) / span) * (nextPos - prevPos);
      }
      k = nextIdx - 1;
      runningMax = nextPos;
    }
    var cx = clamp01(x);
    if (cx <= (positions[0] as number)) return values[0];
    for (var p = 0; p < values.length - 1; p++) {
      var aPos = positions[p] as number;
      var bPos = positions[p + 1] as number;
      if (cx > bPos) continue;
      if (bPos === aPos) return values[p + 1];
      return (
        values[p] + ((values[p + 1] - values[p]) * (cx - aPos)) / (bPos - aPos)
      );
    }
    return values[values.length - 1];
  }

  function identityForFunctions(value: string): string | null {
    var fnRe = /([a-zA-Z][a-zA-Z0-9]*)\(([^)]*)\)/g;
    var out = "";
    var lastIndex = 0;
    var matched = false;
    var m: RegExpExecArray | null;
    while ((m = fnRe.exec(value)) !== null) {
      if (value.slice(lastIndex, m.index).trim() !== "") return null;
      var fn = m[1].toLowerCase();
      var args = m[2];
      var identity: string | null = null;
      if (/^translate/.test(fn) || /^skew/.test(fn)) {
        identity = args.replace(/[+-]?(?:\d+\.?\d*|\.\d+)([a-z%]*)/gi, "0$1");
      } else if (/^scale/.test(fn)) {
        identity = args.replace(/[+-]?(?:\d+\.?\d*|\.\d+)/g, "1");
      } else if (/^rotate/.test(fn) || fn === "hue-rotate") {
        identity = args.replace(/[+-]?(?:\d+\.?\d*|\.\d+)([a-z%]*)/gi, "0$1");
      } else if (fn === "matrix") {
        identity = "1, 0, 0, 1, 0, 0";
      } else if (
        fn === "blur" ||
        fn === "grayscale" ||
        fn === "sepia" ||
        fn === "invert"
      ) {
        identity = args.replace(/[+-]?(?:\d+\.?\d*|\.\d+)([a-z%]*)/gi, "0$1");
      } else if (
        fn === "brightness" ||
        fn === "contrast" ||
        fn === "saturate" ||
        fn === "opacity"
      ) {
        identity = args.indexOf("%") >= 0 ? "100%" : "1";
      } else {
        return null;
      }
      out += (out ? " " : "") + m[1] + "(" + identity + ")";
      lastIndex = m.index + m[0].length;
      matched = true;
    }
    if (!matched) return null;
    if (value.slice(lastIndex).trim() !== "") return null;
    return out;
  }

  function lerp(a: string, b: string, ratio: number): string {
    a = a == null ? "" : String(a);
    b = b == null ? "" : String(b);
    if (a === b) return a;
    if (a.trim() === "none") {
      var identA = identityForFunctions(b);
      if (identA) a = identA;
    } else if (b.trim() === "none") {
      var identB = identityForFunctions(a);
      if (identB) b = identB;
    }
    if (a === b) return a;
    var ca = parseColor(a);
    var cb = parseColor(b);
    if (ca && cb) return formatColor(lerpColorArr(ca, cb, ratio));
    var aSegs = tokenizeSegments(a);
    var bSegs = tokenizeSegments(b);
    if (
      aSegs &&
      bSegs &&
      aSegs.length === bSegs.length &&
      segShape(aSegs) === segShape(bSegs)
    ) {
      var out = "";
      var ok = true;
      var touched = false;
      for (var k = 0; k < aSegs.length; k++) {
        var seg = aSegs[k];
        if ("lit" in seg) {
          out += seg.lit;
          continue;
        }
        var other = bSegs[k];
        if (!other || !("type" in other) || other.type !== seg.type) {
          ok = false;
          break;
        }
        touched = true;
        if (seg.type === "color" && "value" in seg && "value" in other) {
          out += formatColor(
            lerpColorArr(
              seg.value as [number, number, number, number],
              other.value as [number, number, number, number],
              ratio,
            ),
          );
        } else if ("value" in seg && "value" in other) {
          var unit =
            ("unit" in seg ? seg.unit : "") ||
            ("unit" in other ? other.unit : "") ||
            "";
          out +=
            formatNum(
              (seg.value as number) +
                ((other.value as number) - (seg.value as number)) * ratio,
            ) + unit;
        }
      }
      if (ok && touched) return out;
    }
    return ratio < 0.5 ? a : b;
  }

  function parsePosition(value: string): MotionPathPoint | null {
    if (typeof value !== "string") return null;
    if (value.trim().toLowerCase() === "none") return { x: 0, y: 0 };
    var number = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+))";
    var match = new RegExp(
      "^\\s*" + number + "(px)?(?:\\s+" + number + "(px)?)?\\s*$",
      "i",
    ).exec(value);
    if (!match) return null;
    var x = Number(match[1]);
    var y = match[3] === undefined ? 0 : Number(match[3]);
    if ((match[2] == null && x !== 0) || (match[4] == null && y !== 0)) {
      return null;
    }
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > 1000000 ||
      Math.abs(y) > 1000000
    ) {
      return null;
    }
    return { x: x, y: y };
  }

  function formatPosition(point: MotionPathPoint): string {
    return formatNum(point.x) + "px " + formatNum(point.y) + "px";
  }

  function validPathSegment(value: unknown): value is MotionPathSegment {
    if (!value || typeof value !== "object") return false;
    var segment = value as Record<string, unknown>;
    function validPoint(point: unknown): point is MotionPathPoint {
      if (!point || typeof point !== "object") return false;
      var coordinates = point as Record<string, unknown>;
      return (
        Object.keys(coordinates).every(function (key) {
          return key === "x" || key === "y";
        }) &&
        typeof coordinates.x === "number" &&
        Number.isFinite(coordinates.x) &&
        Math.abs(coordinates.x) <= 100000 &&
        typeof coordinates.y === "number" &&
        Number.isFinite(coordinates.y) &&
        Math.abs(coordinates.y) <= 100000
      );
    }
    return (
      segment.version === 1 &&
      segment.type === "cubic" &&
      Object.keys(segment).every(function (key) {
        return ["version", "type", "control1", "control2"].indexOf(key) >= 0;
      }) &&
      validPoint(segment.control1) &&
      validPoint(segment.control2)
    );
  }

  function cubicPoints(
    start: MotionPathPoint,
    end: MotionPathPoint,
    segment?: MotionPathSegment,
  ) {
    var dx = end.x - start.x;
    var dy = end.y - start.y;
    return {
      start: start,
      control1: segment
        ? {
            x: start.x + segment.control1.x,
            y: start.y + segment.control1.y,
          }
        : { x: start.x + dx / 3, y: start.y + dy / 3 },
      control2: segment
        ? { x: end.x + segment.control2.x, y: end.y + segment.control2.y }
        : { x: end.x - dx / 3, y: end.y - dy / 3 },
      end: end,
    };
  }

  function cubicPoint(points: ReturnType<typeof cubicPoints>, t: number) {
    var inverse = 1 - t;
    var startWeight = inverse * inverse * inverse;
    var control1Weight = 3 * inverse * inverse * t;
    var control2Weight = 3 * inverse * t * t;
    var endWeight = t * t * t;
    return {
      x:
        points.start.x * startWeight +
        points.control1.x * control1Weight +
        points.control2.x * control2Weight +
        points.end.x * endWeight,
      y:
        points.start.y * startWeight +
        points.control1.y * control1Weight +
        points.control2.y * control2Weight +
        points.end.y * endWeight,
    };
  }

  function sampleCubicByDistance(
    points: ReturnType<typeof cubicPoints>,
    progress: number,
  ): MotionPathPoint {
    var samples: MotionPathPoint[] = [points.start];
    var cumulative: number[] = [0];
    for (var step = 1; step <= 512; step++) {
      var point = cubicPoint(points, step / 512);
      var previous = samples[step - 1];
      samples.push(point);
      cumulative.push(
        cumulative[step - 1] +
          Math.hypot(point.x - previous.x, point.y - previous.y),
      );
    }
    var total = cumulative[cumulative.length - 1];
    if (total === 0) return points.end;
    if (progress === 0) return points.start;
    if (progress === 1) return points.end;
    if (progress < 0 || progress > 1) {
      var atStart = progress < 0;
      var tangent = atStart
        ? {
            x:
              points.control1.x - points.start.x ||
              points.control2.x - points.start.x ||
              points.end.x - points.start.x,
            y:
              points.control1.y - points.start.y ||
              points.control2.y - points.start.y ||
              points.end.y - points.start.y,
          }
        : {
            x:
              points.end.x - points.control2.x ||
              points.end.x - points.control1.x ||
              points.end.x - points.start.x,
            y:
              points.end.y - points.control2.y ||
              points.end.y - points.control1.y ||
              points.end.y - points.start.y,
          };
      var magnitude = Math.hypot(tangent.x, tangent.y);
      if (magnitude === 0) return atStart ? points.start : points.end;
      var origin = atStart ? points.start : points.end;
      var distance = total * (progress - (atStart ? 0 : 1));
      return {
        x: origin.x + (tangent.x / magnitude) * distance,
        y: origin.y + (tangent.y / magnitude) * distance,
      };
    }
    var target = total * progress;
    var upper = 1;
    while (upper < cumulative.length && cumulative[upper] < target) upper++;
    var lower = upper - 1;
    var length = cumulative[upper] - cumulative[lower];
    var local = length > 0 ? (target - cumulative[lower]) / length : 0;
    return cubicPoint(points, (lower + local) / 512);
  }

  function interpolate(keyframes: PreviewKeyframe[], t: number): string {
    if (!keyframes || keyframes.length === 0) return "";
    if (keyframes.length === 1) return keyframes[0].value;
    var prev = keyframes[0];
    var next = keyframes[keyframes.length - 1];
    for (var i = 0; i < keyframes.length - 1; i++) {
      if (t >= keyframes[i].t && t <= keyframes[i + 1].t) {
        prev = keyframes[i];
        next = keyframes[i + 1];
        break;
      }
    }
    var span = next.t - prev.t;
    if (span <= 0) return prev.value;
    var ratio = Math.max(0, Math.min(1, (t - prev.t) / span));
    var kfEase = prev.ease == null ? loadedDefaultEase : prev.ease;
    var eased = evalEase(kfEase, ratio);
    if (prev.motionPath && validPathSegment(prev.motionPath)) {
      var start = parsePosition(prev.value);
      var end = parsePosition(next.value);
      if (start && end) {
        return formatPosition(
          sampleCubicByDistance(
            cubicPoints(start, end, prev.motionPath),
            eased,
          ),
        );
      }
    }
    return lerp(prev.value, next.value, eased);
  }

  function trackLocalT(
    track: { delayMs?: number; durationMs?: number },
    t: number,
  ): number {
    var delay =
      typeof track.delayMs === "number" && track.delayMs > 0
        ? track.delayMs
        : 0;
    var dur =
      typeof track.durationMs === "number" && track.durationMs > 0
        ? track.durationMs
        : null;
    if (loadedTimelineDurationMs === null || (delay === 0 && dur === null)) {
      return t;
    }
    var timeMs = t * loadedTimelineDurationMs;
    var span = dur === null ? loadedTimelineDurationMs : dur;
    if (span <= 0) return 0;
    var local = (timeMs - delay) / span;
    return local < 0 ? 0 : local > 1 ? 1 : local;
  }

  function pathTrackForTarget(targetNodeId: string): PreviewTrack | null {
    for (var i = 0; i < loadedTracks.length; i++) {
      var track = loadedTracks[i];
      if (
        track.targetNodeId === targetNodeId &&
        track.property === "translate" &&
        track.enabled !== false &&
        track.keyframes.length >= 2
      ) {
        return track;
      }
    }
    return null;
  }

  function positionAtKeyframe(
    keyframe: PreviewKeyframe,
  ): MotionPathPoint | null {
    return parsePosition(keyframe.value);
  }

  function positionTrackElement(track: PreviewTrack): HTMLElement | null {
    return resolveTrackElement(track.targetNodeId);
  }

  function elementPathOrigin(
    track: PreviewTrack,
    element: HTMLElement,
  ): MotionPathPoint | null {
    if (typeof element.getBoundingClientRect !== "function") return null;
    var rect = element.getBoundingClientRect();
    var currentPosition: MotionPathPoint | null = null;
    if (lastPreviewT !== null) {
      currentPosition = parsePosition(
        interpolate(track.keyframes, trackLocalT(track, lastPreviewT)),
      );
    }
    if (!currentPosition && typeof window.getComputedStyle === "function") {
      var computed = window.getComputedStyle(element);
      currentPosition = parsePosition(computed.translate || "none");
    }
    if (!currentPosition) currentPosition = { x: 0, y: 0 };
    return {
      x: rect.left + rect.width / 2 - currentPosition.x,
      y: rect.top + rect.height / 2 - currentPosition.y,
    };
  }

  function svgElement<K extends keyof SVGElementTagNameMap>(
    tag: K,
  ): SVGElementTagNameMap[K] {
    return document.createElementNS(
      pathOverlayNs,
      tag,
    ) as SVGElementTagNameMap[K];
  }

  function setSvgPoint(
    element: SVGCircleElement | SVGRectElement,
    point: MotionPathPoint,
  ): void {
    if (element.tagName.toLowerCase() === "rect") {
      var rect = element as SVGRectElement;
      rect.setAttribute("x", formatNum(point.x - 5));
      rect.setAttribute("y", formatNum(point.y - 5));
      rect.setAttribute("width", "10");
      rect.setAttribute("height", "10");
      rect.setAttribute("rx", "1");
    } else {
      element.setAttribute("cx", formatNum(point.x));
      element.setAttribute("cy", formatNum(point.y));
      element.setAttribute("r", "4");
    }
  }

  function appendPathLine(
    svg: SVGSVGElement,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    var line = svgElement("line");
    line.setAttribute("x1", formatNum(x1));
    line.setAttribute("y1", formatNum(y1));
    line.setAttribute("x2", formatNum(x2));
    line.setAttribute("y2", formatNum(y2));
    line.setAttribute("stroke", pathOverlayAccentColor);
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-dasharray", "3 3");
    line.setAttribute("pointer-events", "none");
    svg.appendChild(line);
  }

  function pathSegmentForFrame(
    keyframes: PreviewKeyframe[],
    index: number,
    positions: MotionPathPoint[],
  ) {
    var segment = keyframes[index]?.motionPath;
    if (segment && !validPathSegment(segment)) return null;
    return cubicPoints(positions[index]!, positions[index + 1]!, segment);
  }

  function ensurePathOverlay(): SVGSVGElement | null {
    if (pathOverlay && document.contains(pathOverlay)) return pathOverlay;
    if (!document.body || typeof document.createElementNS !== "function") {
      return null;
    }
    pathOverlay = svgElement("svg");
    pathOverlay.setAttribute("data-motion-path-overlay", "");
    pathOverlay.setAttribute("aria-hidden", "true");
    pathOverlay.style.position = "fixed";
    pathOverlay.style.inset = "0";
    pathOverlay.style.width = "100vw";
    pathOverlay.style.height = "100vh";
    pathOverlay.style.overflow = "visible";
    pathOverlay.style.pointerEvents = "none";
    pathOverlay.style.zIndex = "2147483646";
    pathOverlay.style.userSelect = "none";
    pathOverlay.style.touchAction = "none";
    document.body.appendChild(pathOverlay);
    if (!pathPointerListenersInstalled) {
      window.addEventListener("pointerdown", onPathPointerDown, true);
      window.addEventListener("pointermove", onPathPointerMove, true);
      window.addEventListener("pointerup", finishPathPointer, true);
      window.addEventListener("pointercancel", finishPathPointer, true);
      pathPointerListenersInstalled = true;
    }
    return pathOverlay;
  }

  function removePathOverlay(): void {
    if (pathOverlay?.parentNode)
      pathOverlay.parentNode.removeChild(pathOverlay);
    pathOverlay = null;
  }

  function originBoxForElement(element: HTMLElement): MotionOriginBox | null {
    var rect = element.getBoundingClientRect();
    var width = element.offsetWidth || rect.width;
    var height = element.offsetHeight || rect.height;
    if (!(width > 0) || !(height > 0)) return null;
    var corners: MotionOriginBox["corners"] = [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];
    var getBoxQuads = (
      element as unknown as {
        getBoxQuads?: () => Array<{
          p1: MotionPoint;
          p2: MotionPoint;
          p3: MotionPoint;
          p4: MotionPoint;
        }>;
      }
    ).getBoxQuads;
    if (typeof getBoxQuads === "function") {
      var quads = getBoxQuads.call(element);
      var quad = quads && quads[0];
      if (quad) corners = [quad.p1, quad.p2, quad.p3, quad.p4];
    }

    var tokens = (
      window.getComputedStyle(element).transformOrigin || "50% 50%"
    ).split(/\s+/);
    var coordinate = function (token: string | undefined, size: number) {
      var value = String(token ?? "center").toLowerCase();
      if (value === "left" || value === "top") return 0;
      if (value === "right" || value === "bottom") return size;
      if (value === "center") return size / 2;
      var parsed = Number.parseFloat(value);
      if (!Number.isFinite(parsed)) return size / 2;
      return value.endsWith("%") ? (parsed / 100) * size : parsed;
    };
    return {
      origin: {
        x: coordinate(tokens[0], width),
        y: coordinate(tokens[1], height),
      },
      corners,
      width,
      height,
    };
  }

  function originScreenPoint(
    box: MotionOriginBox,
    x: number,
    y: number,
  ): MotionPoint {
    var horizontal = x / box.width;
    var vertical = y / box.height;
    var topLeft = box.corners[0];
    var topRight = box.corners[1];
    var bottomLeft = box.corners[3];
    return {
      x:
        topLeft.x +
        (topRight.x - topLeft.x) * horizontal +
        (bottomLeft.x - topLeft.x) * vertical,
      y:
        topLeft.y +
        (topRight.y - topLeft.y) * horizontal +
        (bottomLeft.y - topLeft.y) * vertical,
    };
  }

  function originPercentAtPoint(
    corners: MotionOriginBox["corners"],
    point: MotionPoint,
  ): MotionPoint | null {
    var topLeft = corners[0];
    var horizontal = {
      x: corners[1].x - topLeft.x,
      y: corners[1].y - topLeft.y,
    };
    var vertical = {
      x: corners[3].x - topLeft.x,
      y: corners[3].y - topLeft.y,
    };
    var relative = { x: point.x - topLeft.x, y: point.y - topLeft.y };
    var determinant = horizontal.x * vertical.y - horizontal.y * vertical.x;
    if (Math.abs(determinant) < 0.0001) return null;
    var localX =
      (relative.x * vertical.y - relative.y * vertical.x) / determinant;
    var localY =
      (horizontal.x * relative.y - horizontal.y * relative.x) / determinant;
    return {
      x: Math.max(0, Math.min(100, localX * 100)),
      y: Math.max(0, Math.min(100, localY * 100)),
    };
  }

  function ensureOriginOverlay(): SVGSVGElement | null {
    if (originOverlay && document.contains(originOverlay)) return originOverlay;
    if (!document.body || typeof document.createElementNS !== "function") {
      return null;
    }
    originOverlay = svgElement("svg");
    originOverlay.setAttribute("data-motion-origin-overlay", "");
    originOverlay.setAttribute("aria-hidden", "true");
    originOverlay.style.position = "fixed";
    originOverlay.style.inset = "0";
    originOverlay.style.width = "100vw";
    originOverlay.style.height = "100vh";
    originOverlay.style.overflow = "visible";
    originOverlay.style.pointerEvents = "none";
    originOverlay.style.zIndex = "2147483647";
    originOverlay.style.userSelect = "none";
    originOverlay.style.touchAction = "none";
    document.body.appendChild(originOverlay);
    if (!originPointerListenersInstalled) {
      window.addEventListener("pointerdown", onOriginPointerDown, true);
      window.addEventListener("pointermove", onOriginPointerMove, true);
      window.addEventListener("pointerup", finishOriginPointer, true);
      window.addEventListener("pointercancel", cancelOriginPointer, true);
      window.addEventListener("scroll", renderOriginOverlay, true);
      window.addEventListener("resize", renderOriginOverlay);
      originPointerListenersInstalled = true;
    }
    return originOverlay;
  }

  function removeOriginOverlay(): void {
    if (originOverlay?.parentNode)
      originOverlay.parentNode.removeChild(originOverlay);
    originOverlay = null;
  }

  function publishOriginMarkerPosition(
    targetNodeId: string | null,
    point?: MotionPoint,
  ): void {
    var visible = Boolean(targetNodeId && point);
    var signature = visible
      ? [
          targetNodeId,
          point!.x,
          point!.y,
          window.innerWidth,
          window.innerHeight,
        ].join(":")
      : "hidden";
    if (signature === lastOriginMarkerPositionSignature) return;
    lastOriginMarkerPositionSignature = signature;
    window.parent.postMessage(
      {
        type: "motion-origin-marker-position",
        visible,
        targetNodeId,
        x: visible ? point!.x : null,
        y: visible ? point!.y : null,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      },
      "*",
    );
  }

  function renderOriginOverlay(): void {
    if (!originEditingEnabled || !originEditingTargetNodeId) {
      publishOriginMarkerPosition(null);
      if (!originEditingEnabled) removeOriginOverlay();
      return;
    }
    if (activeOriginDrag) {
      var dragOverlay = ensureOriginOverlay();
      if (!dragOverlay) return;
      publishOriginMarkerPosition(
        originEditingTargetNodeId,
        activeOriginDrag.pointer,
      );
      dragOverlay.setAttribute(
        "data-motion-origin-target",
        originEditingTargetNodeId,
      );
      dragOverlay.setAttribute(
        "viewBox",
        "0 0 " + window.innerWidth + " " + window.innerHeight,
      );
      while (dragOverlay.firstChild)
        dragOverlay.removeChild(dragOverlay.firstChild);
      appendOriginMarker(dragOverlay, activeOriginDrag.pointer);
      return;
    }
    var element = resolveTrackElement(originEditingTargetNodeId);
    var box = element ? originBoxForElement(element) : null;
    if (!element || !box) {
      publishOriginMarkerPosition(null);
      removeOriginOverlay();
      return;
    }
    var point = originScreenPoint(box, box.origin.x, box.origin.y);
    var svg = ensureOriginOverlay();
    if (!svg) return;
    publishOriginMarkerPosition(originEditingTargetNodeId, point);
    svg.setAttribute("data-motion-origin-target", originEditingTargetNodeId);
    svg.setAttribute(
      "viewBox",
      "0 0 " + window.innerWidth + " " + window.innerHeight,
    );
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    appendOriginMarker(svg, point);
  }

  function appendOriginMarker(svg: SVGSVGElement, point: MotionPoint): void {
    var marker = svgElement("g");
    marker.setAttribute("data-motion-origin-marker", "");
    marker.setAttribute(
      "transform",
      "translate(" + formatNum(point.x) + " " + formatNum(point.y) + ")",
    );
    marker.setAttribute("pointer-events", "all");
    marker.style.cursor = "move";
    marker.style.touchAction = "none";
    var ring = svgElement("circle");
    ring.setAttribute("r", "7");
    ring.setAttribute("fill", pathOverlaySurfaceColor);
    ring.setAttribute("stroke", pathOverlayAccentColor);
    ring.setAttribute("stroke-width", "2");
    var center = svgElement("circle");
    center.setAttribute("r", "2");
    center.setAttribute("fill", pathOverlayAccentColor);
    var horizontal = svgElement("line");
    horizontal.setAttribute("x1", "-4");
    horizontal.setAttribute("x2", "4");
    horizontal.setAttribute("y1", "0");
    horizontal.setAttribute("y2", "0");
    horizontal.setAttribute("stroke", pathOverlayAccentColor);
    var vertical = svgElement("line");
    vertical.setAttribute("x1", "0");
    vertical.setAttribute("x2", "0");
    vertical.setAttribute("y1", "-4");
    vertical.setAttribute("y2", "4");
    vertical.setAttribute("stroke", pathOverlayAccentColor);
    [ring, center, horizontal, vertical].forEach(function (shape) {
      shape.setAttribute("pointer-events", "none");
      marker.appendChild(shape);
    });
    svg.appendChild(marker);
  }

  function originMarkerAtPoint(clientX: number, clientY: number): boolean {
    var marker = originOverlay?.querySelector<SVGElement>(
      "[data-motion-origin-marker]",
    );
    var rect = marker?.getBoundingClientRect();
    if (!rect) return false;
    var centerX = (rect.left + rect.right) / 2;
    var centerY = (rect.top + rect.bottom) / 2;
    return (clientX - centerX) ** 2 + (clientY - centerY) ** 2 <= 144;
  }

  function originValue(x: number, y: number, depth: string): string {
    var horizontal = formatNum(x) + "%";
    var vertical = formatNum(y) + "%";
    return [horizontal, vertical, depth].filter(Boolean).join(" ");
  }

  function setOriginInlineStyle(
    element: HTMLElement,
    value: string,
    priority: string,
  ): void {
    element.style.setProperty("transform-origin", value, priority);
  }

  function restoreOriginInlineStyle(drag: OriginDrag): void {
    if (drag.originalValue) {
      setOriginInlineStyle(
        drag.element,
        drag.originalValue,
        drag.originalPriority,
      );
    } else {
      drag.element.style.removeProperty("transform-origin");
    }
  }

  function beginOriginDrag(
    pointerId: number,
    clientX: number,
    clientY: number,
  ): void {
    if (!originEditingEnabled || !originEditingTargetNodeId) return;
    var element = resolveTrackElement(originEditingTargetNodeId);
    var box = element ? originBoxForElement(element) : null;
    if (!element || !box) return;
    var tokens = (
      window.getComputedStyle(element).transformOrigin || "50% 50%"
    ).split(/\s+/);
    activeOriginDrag = {
      pointerId,
      targetNodeId: originEditingTargetNodeId,
      element,
      corners: box.corners,
      originalValue: element.style.getPropertyValue("transform-origin"),
      originalPriority: element.style.getPropertyPriority("transform-origin"),
      depth: tokens[2] ?? "",
      value: "",
      pointer: { x: clientX, y: clientY },
      startPointer: { x: clientX, y: clientY },
    };
  }

  function onOriginPointerDown(event: PointerEvent): void {
    if (
      event.button !== 0 ||
      !originMarkerAtPoint(event.clientX, event.clientY)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    beginOriginDrag(event.pointerId, event.clientX, event.clientY);
  }

  function moveOriginDrag(
    pointerId: number,
    clientX: number,
    clientY: number,
  ): void {
    var drag = activeOriginDrag;
    if (!drag || drag.pointerId !== pointerId) return;
    var percent = originPercentAtPoint(drag.corners, {
      x: clientX,
      y: clientY,
    });
    if (!percent) return;
    drag.pointer = { x: clientX, y: clientY };
    drag.value = originValue(percent.x, percent.y, drag.depth);
    setOriginInlineStyle(drag.element, drag.value, drag.originalPriority);
    renderOriginOverlay();
  }

  function onOriginPointerMove(event: PointerEvent): void {
    moveOriginDrag(event.pointerId, event.clientX, event.clientY);
  }

  function finishOriginDrag(
    pointerId: number,
    clientX: number,
    clientY: number,
  ): void {
    var drag = activeOriginDrag;
    if (!drag || drag.pointerId !== pointerId) return;
    moveOriginDrag(pointerId, clientX, clientY);
    drag = activeOriginDrag;
    if (!drag) return;
    activeOriginDrag = null;
    var moved =
      Math.abs(drag.pointer.x - drag.startPointer.x) > 0.5 ||
      Math.abs(drag.pointer.y - drag.startPointer.y) > 0.5;
    if (!moved || !drag.value) {
      restoreOriginInlineStyle(drag);
      renderOriginOverlay();
      return;
    }
    window.parent.postMessage(
      {
        type: "visual-style-change",
        selector:
          '[data-agent-native-node-id="' +
          drag.targetNodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
          '"]',
        styles: { "transform-origin": drag.value },
        originalStyles: { "transform-origin": drag.originalValue },
        phase: "commit",
        preserveSelection: true,
      },
      "*",
    );
    renderOriginOverlay();
  }

  function finishOriginPointer(event: PointerEvent): void {
    finishOriginDrag(event.pointerId, event.clientX, event.clientY);
  }

  function cancelOriginDrag(pointerId: number): void {
    var drag = activeOriginDrag;
    if (!drag || drag.pointerId !== pointerId) return;
    activeOriginDrag = null;
    restoreOriginInlineStyle(drag);
    renderOriginOverlay();
  }

  function cancelOriginPointer(event: PointerEvent): void {
    cancelOriginDrag(event.pointerId);
  }

  function renderPathOverlay(): void {
    if (!pathEditingEnabled || !pathEditingTargetNodeId || activePathDrag) {
      if (!pathEditingEnabled) removePathOverlay();
      return;
    }
    var track = pathTrackForTarget(pathEditingTargetNodeId);
    var element = track ? positionTrackElement(track) : null;
    if (!track || !element) {
      removePathOverlay();
      return;
    }
    var keyframes = [...track.keyframes].sort(function (a, b) {
      return a.t - b.t;
    });
    var positions = keyframes.map(positionAtKeyframe);
    if (
      positions.some(function (point) {
        return point === null;
      })
    ) {
      removePathOverlay();
      return;
    }
    var origin = elementPathOrigin(track, element);
    if (!origin) {
      removePathOverlay();
      return;
    }
    var absolutePositions = (positions as MotionPathPoint[]).map(
      function (point) {
        return { x: origin!.x + point.x, y: origin!.y + point.y };
      },
    );
    var svg = ensurePathOverlay();
    if (!svg) return;
    svg.setAttribute("data-motion-path-target", track.targetNodeId);
    svg.setAttribute(
      "viewBox",
      "0 0 " + window.innerWidth + " " + window.innerHeight,
    );
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var pathCommands: string[] = [];
    for (var i = 0; i < keyframes.length - 1; i++) {
      var points = pathSegmentForFrame(
        keyframes,
        i,
        positions as MotionPathPoint[],
      );
      if (!points) continue;
      var start = absolutePositions[i]!;
      var control1 = {
        x: origin.x + points.control1.x,
        y: origin.y + points.control1.y,
      };
      var control2 = {
        x: origin.x + points.control2.x,
        y: origin.y + points.control2.y,
      };
      var end = absolutePositions[i + 1]!;
      pathCommands.push(
        (i === 0 ? "M " + formatNum(start.x) + " " + formatNum(start.y) : "") +
          " C " +
          formatNum(control1.x) +
          " " +
          formatNum(control1.y) +
          " " +
          formatNum(control2.x) +
          " " +
          formatNum(control2.y) +
          " " +
          formatNum(end.x) +
          " " +
          formatNum(end.y),
      );
    }
    var curve = svgElement("path");
    curve.setAttribute("data-motion-path-curve", "");
    curve.setAttribute("fill", "none");
    curve.setAttribute("stroke", pathOverlayAccentColor);
    curve.setAttribute("stroke-width", "2");
    curve.setAttribute("d", pathCommands.join(" "));
    curve.setAttribute("pointer-events", "none");
    svg.appendChild(curve);

    for (
      var segmentIndex = 0;
      segmentIndex < keyframes.length - 1;
      segmentIndex++
    ) {
      var segmentPoints = pathSegmentForFrame(
        keyframes,
        segmentIndex,
        positions as MotionPathPoint[],
      );
      if (!segmentPoints) continue;
      var segmentStart = absolutePositions[segmentIndex]!;
      var segmentEnd = absolutePositions[segmentIndex + 1]!;
      var handle1 = {
        x: origin.x + segmentPoints.control1.x,
        y: origin.y + segmentPoints.control1.y,
      };
      var handle2 = {
        x: origin.x + segmentPoints.control2.x,
        y: origin.y + segmentPoints.control2.y,
      };
      appendPathLine(svg, segmentStart.x, segmentStart.y, handle1.x, handle1.y);
      appendPathLine(svg, handle2.x, handle2.y, segmentEnd.x, segmentEnd.y);

      var ease = keyframes[segmentIndex]!.ease ?? loadedDefaultEase;
      for (var dotIndex = 1; dotIndex < 8; dotIndex++) {
        var progress = evalEase(ease, dotIndex / 8);
        var dotPosition = sampleCubicByDistance(segmentPoints, progress);
        var dot = svgElement("circle");
        dot.setAttribute("data-motion-path-easing-dot", String(dotIndex));
        dot.setAttribute(
          "data-motion-path-segment-start",
          String(keyframes[segmentIndex]!.t),
        );
        setSvgPoint(dot, {
          x: origin.x + dotPosition.x,
          y: origin.y + dotPosition.y,
        });
        dot.setAttribute("r", "2");
        dot.setAttribute("fill", pathOverlaySurfaceColor);
        dot.setAttribute("stroke", pathOverlayAccentColor);
        dot.setAttribute("stroke-width", "1.5");
        dot.setAttribute("pointer-events", "none");
        svg.appendChild(dot);
      }

      appendPathHandle(svg, "control1", keyframes[segmentIndex]!.t, handle1);
      appendPathHandle(svg, "control2", keyframes[segmentIndex]!.t, handle2);
    }
    for (
      var keyframeIndex = 0;
      keyframeIndex < keyframes.length;
      keyframeIndex++
    ) {
      var marker = svgElement("rect");
      marker.setAttribute(
        "data-motion-path-keyframe",
        String(keyframes[keyframeIndex]!.t),
      );
      marker.setAttribute("data-motion-path-target", track.targetNodeId);
      setSvgPoint(marker, absolutePositions[keyframeIndex]!);
      marker.setAttribute("fill", pathOverlaySurfaceColor);
      marker.setAttribute("stroke", pathOverlayAccentColor);
      marker.setAttribute("stroke-width", "2");
      marker.setAttribute("pointer-events", "all");
      marker.style.cursor = "move";
      marker.style.touchAction = "none";
      svg.appendChild(marker);
    }
  }

  function appendPathHandle(
    svg: SVGSVGElement,
    handle: "control1" | "control2",
    segmentStartT: number,
    point: MotionPathPoint,
  ): void {
    var marker = svgElement("circle");
    marker.setAttribute("data-motion-path-handle", handle);
    marker.setAttribute(
      "data-motion-path-segment-start",
      String(segmentStartT),
    );
    setSvgPoint(marker, point);
    marker.setAttribute("r", "5");
    marker.setAttribute("fill", pathOverlayAccentColor);
    marker.setAttribute("stroke", pathOverlaySurfaceColor);
    marker.setAttribute("stroke-width", "1.5");
    marker.setAttribute("pointer-events", "all");
    marker.style.cursor = "crosshair";
    marker.style.touchAction = "none";
    svg.appendChild(marker);
  }

  function pathMessage(
    targetNodeId: string,
    edits: Array<{
      keyframeT: number;
      value?: string;
      segmentStartT?: number;
      motionPath?: MotionPathSegment;
    }>,
  ): void {
    if (edits.length === 0) return;
    window.parent.postMessage(
      { type: "motion-path-edit", targetNodeId: targetNodeId, edits: edits },
      "*",
    );
  }

  function pathForEdit(
    keyframes: PreviewKeyframe[],
    index: number,
  ): MotionPathSegment | null {
    var start = parsePosition(keyframes[index]?.value ?? "");
    var end = parsePosition(keyframes[index + 1]?.value ?? "");
    if (!start || !end) return null;
    var points = cubicPoints(start, end, keyframes[index]?.motionPath);
    return {
      version: 1,
      type: "cubic",
      control1: {
        x: Number(formatNum(points.control1.x - start.x)),
        y: Number(formatNum(points.control1.y - start.y)),
      },
      control2: {
        x: Number(formatNum(points.control2.x - end.x)),
        y: Number(formatNum(points.control2.y - end.y)),
      },
    };
  }

  function applyLocalPathEdits(
    track: PreviewTrack,
    edits: Array<{
      keyframeT: number;
      value?: string;
      segmentStartT?: number;
      motionPath?: MotionPathSegment;
    }>,
  ): void {
    edits.forEach(function (edit) {
      var valueFrame = track.keyframes.find(function (frame) {
        return frame.t === edit.keyframeT;
      });
      if (valueFrame && edit.value !== undefined) valueFrame.value = edit.value;
      if (edit.segmentStartT !== undefined && edit.motionPath) {
        var segmentFrame = track.keyframes.find(function (frame) {
          return frame.t === edit.segmentStartT;
        });
        if (segmentFrame) segmentFrame.motionPath = edit.motionPath;
      }
    });
  }

  function onPathPointerDown(event: PointerEvent): void {
    if (!pathEditingEnabled || !pathEditingTargetNodeId) return;
    var target = event.target as SVGElement | null;
    if (
      !target ||
      typeof target.getAttribute !== "function" ||
      (!target.getAttribute("data-motion-path-handle") &&
        target.getAttribute("data-motion-path-keyframe") === null)
    ) {
      target = pathTargetAtPoint(
        event.clientX,
        event.clientY,
        event.ctrlKey || event.metaKey,
      );
    }
    if (!target) return;
    var handle = target.getAttribute("data-motion-path-handle");
    var keyframeAttribute = target.getAttribute("data-motion-path-keyframe");
    var kind: PathDrag["kind"] | null = null;
    var keyframeT: number | null = null;
    var segmentStartT: number | null = null;
    if (handle === "control1" || handle === "control2") {
      if (!event.ctrlKey && !event.metaKey) return;
      kind = handle;
      segmentStartT = Number(
        target.getAttribute("data-motion-path-segment-start"),
      );
      keyframeT = segmentStartT;
    } else if (keyframeAttribute !== null) {
      kind = "endpoint";
      keyframeT = Number(keyframeAttribute);
    } else {
      return;
    }
    if (keyframeT === null || !Number.isFinite(keyframeT)) return;
    var track = pathTrackForTarget(pathEditingTargetNodeId);
    if (!track) return;
    var keyframes = [...track.keyframes].sort(function (a, b) {
      return a.t - b.t;
    });
    var keyframeIndex = keyframes.findIndex(function (frame) {
      return frame.t === keyframeT;
    });
    if (keyframeIndex < 0) return;
    if (segmentStartT !== null) {
      keyframeIndex = keyframes.findIndex(function (frame) {
        return frame.t === segmentStartT;
      });
      if (keyframeIndex < 0 || keyframeIndex >= keyframes.length - 1) return;
    }
    event.preventDefault();
    event.stopPropagation();
    activePathDrag = {
      pointerId: event.pointerId,
      kind: kind,
      targetNodeId: track.targetNodeId,
      keyframeIndex: keyframeIndex,
      startClientX: event.clientX,
      startClientY: event.clientY,
      keyframes: keyframes.map(function (frame) {
        return {
          ...frame,
          ...(frame.motionPath
            ? {
                motionPath: {
                  ...frame.motionPath,
                  control1: { ...frame.motionPath.control1 },
                  control2: { ...frame.motionPath.control2 },
                },
              }
            : {}),
        };
      }),
    };
  }

  // The editor's full-frame selection shield paints above body-appended SVG nodes.
  function pathTargetAtPoint(
    clientX: number,
    clientY: number,
    preferHandles: boolean,
  ): SVGElement | null {
    if (!pathOverlay) return null;
    var selectors = preferHandles
      ? ["[data-motion-path-handle]", "[data-motion-path-keyframe]"]
      : ["[data-motion-path-keyframe]", "[data-motion-path-handle]"];
    for (
      var selectorIndex = 0;
      selectorIndex < selectors.length;
      selectorIndex++
    ) {
      var targets = pathOverlay.querySelectorAll<SVGElement>(
        selectors[selectorIndex]!,
      );
      var nearestTarget: SVGElement | null = null;
      var nearestDistance = Number.POSITIVE_INFINITY;
      for (var index = 0; index < targets.length; index++) {
        var candidate = targets[index]!;
        var rect = candidate.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          var deltaX = clientX - (rect.left + rect.right) / 2;
          var deltaY = clientY - (rect.top + rect.bottom) / 2;
          var distance = deltaX * deltaX + deltaY * deltaY;
          if (distance <= nearestDistance) {
            nearestTarget = candidate;
            nearestDistance = distance;
          }
        }
      }
      if (nearestTarget) return nearestTarget;
    }
    return null;
  }

  function onPathPointerMove(event: PointerEvent): void {
    var drag = activePathDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    var dx = event.clientX - drag.startClientX;
    var dy = event.clientY - drag.startClientY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    var edits: Array<{
      keyframeT: number;
      value?: string;
      segmentStartT?: number;
      motionPath?: MotionPathSegment;
    }> = [];

    if (drag.kind === "control1" || drag.kind === "control2") {
      var path = pathForEdit(drag.keyframes, drag.keyframeIndex);
      if (!path) return;
      var control = path[drag.kind];
      path[drag.kind] = {
        x: Number(formatNum(control.x + dx)),
        y: Number(formatNum(control.y + dy)),
      };
      if (
        Math.abs(path.control1.x) > 100000 ||
        Math.abs(path.control1.y) > 100000 ||
        Math.abs(path.control2.x) > 100000 ||
        Math.abs(path.control2.y) > 100000
      ) {
        return;
      }
      var segmentFrame = drag.keyframes[drag.keyframeIndex]!;
      edits.push({
        keyframeT: segmentFrame.t,
        segmentStartT: segmentFrame.t,
        motionPath: path,
      });
    } else {
      var originalValue = parsePosition(
        drag.keyframes[drag.keyframeIndex]!.value,
      );
      if (!originalValue) return;
      var movedPosition = { x: originalValue.x + dx, y: originalValue.y + dy };
      if (
        Math.abs(movedPosition.x) > 1000000 ||
        Math.abs(movedPosition.y) > 1000000
      ) {
        return;
      }
      var movedFrame = drag.keyframes[drag.keyframeIndex]!;
      edits.push({
        keyframeT: movedFrame.t,
        value: formatPosition(movedPosition),
      });

      var delta = { x: dx, y: dy };
      if (drag.keyframeIndex > 0) {
        var previousIndex = drag.keyframeIndex - 1;
        var previousPath = pathForEdit(drag.keyframes, previousIndex);
        if (!previousPath) return;
        previousPath.control2 = {
          x: Number(formatNum(previousPath.control2.x - delta.x)),
          y: Number(formatNum(previousPath.control2.y - delta.y)),
        };
        if (
          Math.abs(previousPath.control2.x) > 100000 ||
          Math.abs(previousPath.control2.y) > 100000
        ) {
          return;
        }
        edits.push({
          keyframeT: movedFrame.t,
          segmentStartT: drag.keyframes[previousIndex]!.t,
          motionPath: previousPath,
        });
      }
      if (drag.keyframeIndex < drag.keyframes.length - 1) {
        var outgoingPath = pathForEdit(drag.keyframes, drag.keyframeIndex);
        if (!outgoingPath) return;
        outgoingPath.control1 = {
          x: Number(formatNum(outgoingPath.control1.x - delta.x)),
          y: Number(formatNum(outgoingPath.control1.y - delta.y)),
        };
        if (
          Math.abs(outgoingPath.control1.x) > 100000 ||
          Math.abs(outgoingPath.control1.y) > 100000
        ) {
          return;
        }
        edits.push({
          keyframeT: movedFrame.t,
          segmentStartT: movedFrame.t,
          motionPath: outgoingPath,
        });
      }
    }

    event.preventDefault();
    var currentTrack = pathTrackForTarget(drag.targetNodeId);
    if (!currentTrack) return;
    applyLocalPathEdits(currentTrack, edits);
    pathMessage(drag.targetNodeId, edits);
    if (lastPreviewT !== null) applyPreview(lastPreviewT);
    renderOriginOverlay();
  }

  function finishPathPointer(event: PointerEvent): void {
    if (!activePathDrag || activePathDrag.pointerId !== event.pointerId) return;
    activePathDrag = null;
    renderPathOverlay();
    renderOriginOverlay();
  }

  function writePreviewStyle(
    targetNodeId: string,
    element: HTMLElement,
    property: string,
    value: string,
  ): void {
    if (!originalInlineValues[targetNodeId]) {
      originalInlineValues[targetNodeId] = {};
    }
    if (!(property in originalInlineValues[targetNodeId]!)) {
      originalInlineValues[targetNodeId] = {
        ...originalInlineValues[targetNodeId],
        [property]:
          (element.style as unknown as Record<string, string>)[property] || "",
      };
    }
    (element.style as unknown as Record<string, string>)[property] = value;
    if (!touchedProps[targetNodeId]) touchedProps[targetNodeId] = [];
    if (touchedProps[targetNodeId]!.indexOf(property) === -1) {
      touchedProps[targetNodeId]!.push(property);
    }
  }

  function writePreviewAttribute(
    targetNodeId: string,
    element: HTMLElement,
    attribute: string,
    value: string,
  ): void {
    if (!originalAttributes[targetNodeId]) {
      originalAttributes[targetNodeId] = {};
    }
    if (!(attribute in originalAttributes[targetNodeId]!)) {
      originalAttributes[targetNodeId] = {
        ...originalAttributes[targetNodeId],
        [attribute]: element.getAttribute(attribute),
      };
    }
    element.setAttribute(attribute, value);
    if (!touchedAttributes[targetNodeId]) touchedAttributes[targetNodeId] = [];
    if (touchedAttributes[targetNodeId]!.indexOf(attribute) === -1) {
      touchedAttributes[targetNodeId]!.push(attribute);
    }
  }

  function applyPreview(t: number): void {
    for (var i = 0; i < loadedTracks.length; i++) {
      var track = loadedTracks[i];
      if (track.enabled === false) continue;
      var el = resolveTrackElement(track.targetNodeId);
      if (!el) continue;
      var value = interpolate(track.keyframes, trackLocalT(track, t));
      if (value === "") continue;
      if (track.property === "path-trim") {
        var trim = parsePathTrimValue(value);
        if (!trim) continue;
        var dashLength =
          trim.end >= trim.start
            ? trim.end - trim.start
            : 100 - trim.start + trim.end;
        writePreviewAttribute(track.targetNodeId, el, "pathLength", "100");
        writePreviewStyle(
          track.targetNodeId,
          el,
          "strokeDasharray",
          formatPathTrimNumber(dashLength) +
            " " +
            formatPathTrimNumber(100 - dashLength),
        );
        writePreviewStyle(
          track.targetNodeId,
          el,
          "strokeDashoffset",
          formatPathTrimNumber(-trim.start),
        );
        continue;
      }
      var prop = camelizeProp(track.property);
      if (
        track.property === "translate" &&
        track.keyframes.some(function (keyframe) {
          return Boolean(keyframe.motionPath);
        })
      ) {
        writePreviewStyle(track.targetNodeId, el, "offsetPath", "none");
      }
      writePreviewStyle(track.targetNodeId, el, prop, value);
    }
    renderPathOverlay();
    renderOriginOverlay();
  }

  function postAudioPlaybackError(clipId: string): void {
    window.parent.postMessage(
      { type: "motion-audio-playback-error", clipId: clipId },
      "*",
    );
  }

  function setAudioPosition(
    loaded: LoadedAudioClip,
    positionMs: number,
    force: boolean,
  ): void {
    var audio = loaded.element;
    var target = Math.max(0, positionMs / 1000);
    if (audio.readyState === 0) {
      loaded.pendingTime = target;
      return;
    }
    if (
      !Number.isFinite(audio.currentTime) ||
      Math.abs(audio.currentTime - target) > (force ? 0.025 : 0.15)
    ) {
      try {
        audio.currentTime = target;
        loaded.pendingTime = null;
      } catch (_error) {
        loaded.pendingTime = target;
      }
    }
  }

  function clearAudioClips(): void {
    for (var i = 0; i < loadedAudioClips.length; i++) {
      var audio = loadedAudioClips[i]!.element;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    loadedAudioClips = [];
    audioPlaybackActive = false;
  }

  function attachAudioMetadataListener(
    audio: HTMLAudioElement,
    loaded: LoadedAudioClip,
  ): void {
    audio.addEventListener("loadedmetadata", function () {
      var pending = loaded.pendingTime;
      if (pending === null) return;
      try {
        audio.currentTime = pending;
        loaded.pendingTime = null;
      } catch (_error) {
        loaded.pendingTime = pending;
      }
    });
  }

  function reportAudioPlayFailure(loaded: LoadedAudioClip): void {
    loaded.failed = true;
    postAudioPlaybackError(loaded.clip.id);
  }

  function startAudioPlayback(loaded: LoadedAudioClip): void {
    try {
      var playback = loaded.element.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(function () {
          reportAudioPlayFailure(loaded);
        });
      }
    } catch (_error) {
      reportAudioPlayFailure(loaded);
    }
  }

  function loadAudioClips(rawClips: unknown): void {
    if (!Array.isArray(rawClips)) return;
    var clips = rawClips;
    var next: LoadedAudioClip[] = [];
    for (var i = 0; i < clips.length; i++) {
      var clip = clips[i] as PreviewAudioClip;
      if (
        !clip ||
        typeof clip.id !== "string" ||
        typeof clip.sourceUrl !== "string" ||
        !clip.sourceUrl ||
        !Number.isFinite(clip.timelineStartMs) ||
        !Number.isFinite(clip.sourceTrimStartMs) ||
        !Number.isFinite(clip.durationMs) ||
        clip.durationMs <= 0 ||
        !Number.isFinite(clip.volume) ||
        typeof clip.muted !== "boolean"
      ) {
        continue;
      }
      var loaded = loadedAudioClips.find(function (candidate) {
        return (
          candidate.clip.id === clip.id &&
          candidate.clip.sourceUrl === clip.sourceUrl
        );
      });
      if (!loaded) {
        var audio = new Audio(clip.sourceUrl);
        audio.preload = "auto";
        loaded = {
          clip: clip,
          element: audio,
          failed: false,
          pendingTime: null,
        };
        attachAudioMetadataListener(audio, loaded);
      }
      loaded.clip = clip;
      loaded.element.volume = clamp01(clip.volume);
      loaded.element.muted = clip.muted;
      next.push(loaded);
    }
    for (
      var previousIndex = 0;
      previousIndex < loadedAudioClips.length;
      previousIndex++
    ) {
      var previous = loadedAudioClips[previousIndex]!;
      if (next.indexOf(previous) === -1) {
        previous.element.pause();
        previous.element.removeAttribute("src");
        previous.element.load();
      }
    }
    loadedAudioClips = next;
  }

  function syncAudio(timelineTimeMs: number, isPlaying: boolean): void {
    if (isPlaying && !audioPlaybackActive) {
      for (
        var resetIndex = 0;
        resetIndex < loadedAudioClips.length;
        resetIndex++
      ) {
        loadedAudioClips[resetIndex]!.failed = false;
      }
    }
    audioPlaybackActive = isPlaying;
    for (var i = 0; i < loadedAudioClips.length; i++) {
      var loaded = loadedAudioClips[i]!;
      var clip = loaded.clip;
      var offsetMs = timelineTimeMs - clip.timelineStartMs;
      var active = offsetMs >= 0 && offsetMs < clip.durationMs;
      var sourcePositionMs =
        clip.sourceTrimStartMs +
        Math.max(0, Math.min(clip.durationMs, offsetMs));
      setAudioPosition(loaded, sourcePositionMs, !isPlaying || !active);

      if (!isPlaying || !active) {
        if (!loaded.element.paused) loaded.element.pause();
        continue;
      }
      if (loaded.element.paused && !loaded.failed) {
        startAudioPlayback(loaded);
      }
    }
  }

  function clearPreview(): void {
    var nodeIds = Object.keys(touchedProps);
    for (var i = 0; i < nodeIds.length; i++) {
      var el = resolveTrackElement(nodeIds[i]);
      if (!el) continue;
      var props = touchedProps[nodeIds[i]];
      for (var j = 0; j < props.length; j++) {
        var originals = originalInlineValues[nodeIds[i]] || {};
        (el.style as unknown as Record<string, string>)[props[j]] =
          Object.prototype.hasOwnProperty.call(originals, props[j])
            ? originals[props[j]]
            : "";
      }
    }
    var attributeNodeIds = Object.keys(touchedAttributes);
    for (var i = 0; i < attributeNodeIds.length; i++) {
      var attributeNodeId = attributeNodeIds[i]!;
      var attributeElement = resolveTrackElement(attributeNodeId);
      if (!attributeElement) continue;
      var attributes = touchedAttributes[attributeNodeId];
      var original = originalAttributes[attributeNodeId] || {};
      for (var j = 0; j < attributes.length; j++) {
        var attributeName = attributes[j]!;
        var originalValue = original[attributeName];
        if (originalValue === null || originalValue === undefined) {
          attributeElement.removeAttribute(attributeName);
        } else {
          attributeElement.setAttribute(attributeName, originalValue);
        }
      }
    }
    touchedProps = {};
    originalInlineValues = {};
    touchedAttributes = {};
    originalAttributes = {};
    loadedTracks = [];
    loadedEasingVariables = [];
    loadedDefaultEase = "ease";
    loadedTimelineDurationMs = null;
    elementCache = {};
  }

  function parsePathTrimValue(
    value: string,
  ): { start: number; end: number } | null {
    var match =
      /^\s*((?:\d+(?:\.\d*)?|\.\d+))%\s+((?:\d+(?:\.\d*)?|\.\d+))%\s*$/.exec(
        value,
      );
    if (!match) return null;
    var start = Number(match[1]);
    var end = Number(match[2]);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start > 100 || // i18n-ignore: numeric Path trim bounds are not UI copy.
      end < 0 ||
      end > 100
    ) {
      return null;
    }
    return { start: start, end: end };
  }

  function formatPathTrimNumber(value: number): string {
    return String(Math.round(value * 1000) / 1000);
  }

  var lastPreviewT: number | null = null;

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    if (!e.data || typeof e.data.type !== "string") return;
    if (e.data.type === "motion-origin-pointer") {
      var phase = e.data.phase;
      var pointerId = Number(e.data.pointerId);
      var clientX = Number(e.data.x);
      var clientY = Number(e.data.y);
      if (
        !Number.isSafeInteger(pointerId) ||
        !Number.isFinite(clientX) ||
        !Number.isFinite(clientY)
      ) {
        return;
      }
      if (phase === "down") {
        beginOriginDrag(pointerId, clientX, clientY);
      } else if (phase === "move") {
        moveOriginDrag(pointerId, clientX, clientY);
      } else if (phase === "up") {
        finishOriginDrag(pointerId, clientX, clientY);
      } else if (phase === "cancel") {
        cancelOriginDrag(pointerId);
      }
      return;
    }
    if (e.data.type === "motion-audio-load") {
      loadAudioClips(e.data.clips);
      return;
    }
    if (e.data.type === "motion-audio-state") {
      var audioTime = Number(e.data.timelineTimeMs);
      if (!Number.isFinite(audioTime) || audioTime < 0) return;
      syncAudio(audioTime, e.data.isPlaying === true);
      return;
    }
    if (e.data.type === "motion-audio-clear") {
      clearAudioClips();
      return;
    }
    if (e.data.type === "motion-load-tracks") {
      clearPreview();
      loadedTracks = Array.isArray(e.data.tracks) ? e.data.tracks : [];
      loadedEasingVariables = Array.isArray(e.data.easingVariables)
        ? e.data.easingVariables
        : [];
      loadedDefaultEase =
        typeof e.data.defaultEase === "string" && e.data.defaultEase
          ? e.data.defaultEase
          : "ease";
      var loadDur = Number(e.data.durationMs);
      if (Number.isFinite(loadDur) && loadDur > 0) {
        loadedTimelineDurationMs = loadDur;
      }
      for (var i = 0; i < loadedTracks.length; i++) {
        var kfs = loadedTracks[i] && loadedTracks[i].keyframes;
        if (Array.isArray(kfs)) {
          kfs.sort(function (a, b) {
            return (a && a.t) - (b && b.t);
          });
        }
      }
      if (lastPreviewT !== null && loadedTracks.length > 0) {
        applyPreview(lastPreviewT);
      } else {
        renderPathOverlay();
        renderOriginOverlay();
      }
      return;
    }
    if (e.data.type === "motion-preview") {
      var t = Number(e.data.t);
      if (!Number.isFinite(t)) return;
      t = Math.max(0, Math.min(1, t));
      var tickDur = Number(e.data.durationMs);
      if (Number.isFinite(tickDur) && tickDur > 0) {
        loadedTimelineDurationMs = tickDur;
      }
      lastPreviewT = t;
      applyPreview(t);
      return;
    }
    if (e.data.type === "motion-path-editing") {
      pathEditingEnabled = e.data.enabled === true;
      pathEditingTargetNodeId =
        pathEditingEnabled && typeof e.data.targetNodeId === "string"
          ? e.data.targetNodeId
          : null;
      if (!pathEditingEnabled) activePathDrag = null;
      renderPathOverlay();
      return;
    }
    if (e.data.type === "motion-origin-editing") {
      var enabled = e.data.enabled === true;
      var targetNodeId =
        enabled && typeof e.data.targetNodeId === "string"
          ? e.data.targetNodeId
          : null;
      if (
        activeOriginDrag &&
        (!enabled || targetNodeId !== activeOriginDrag.targetNodeId)
      ) {
        restoreOriginInlineStyle(activeOriginDrag);
        activeOriginDrag = null;
      }
      originEditingEnabled = enabled;
      originEditingTargetNodeId = targetNodeId;
      renderOriginOverlay();
      return;
    }
    if (e.data.type === "motion-preview-clear") {
      clearPreview();
      clearAudioClips();
      lastPreviewT = null;
      pathEditingEnabled = false;
      pathEditingTargetNodeId = null;
      activePathDrag = null;
      if (activeOriginDrag) restoreOriginInlineStyle(activeOriginDrag);
      originEditingEnabled = false;
      originEditingTargetNodeId = null;
      activeOriginDrag = null;
      removePathOverlay();
      removeOriginOverlay();
      return;
    }
  });
})();
