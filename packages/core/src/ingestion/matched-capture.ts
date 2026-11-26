import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { loadOptionalPeer } from "../shared/optional-peer.js";

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BreakpointRecord {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  /** Effect bounds in CSS px. Omit to compare the whole viewport. */
  crop?: CropRect;
  reducedMotion?: "no-preference" | "reduce";
  colorSpace?: string;
  orientation?: string;
}

export const BREAKPOINT_PRESETS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  tablet: { width: 900, height: 1200, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
} as const;

export type BreakpointPresetName = keyof typeof BREAKPOINT_PRESETS;

export type BreakpointInput =
  | BreakpointRecord
  | ({ preset: BreakpointPresetName } & Partial<BreakpointRecord>);

export function resolveBreakpoint(input: BreakpointInput): BreakpointRecord {
  if ("preset" in input) {
    const preset = (
      BREAKPOINT_PRESETS as Record<
        string,
        { width: number; height: number; deviceScaleFactor: number } | undefined
      >
    )[input.preset];
    if (!preset)
      throw new Error(`Unknown breakpoint preset "${input.preset}".`);
    const { preset: name, ...overrides } = input;
    return { ...preset, ...overrides, name: overrides.name ?? name };
  }
  return input;
}

export type ClockStrategy =
  | { kind: "unpinned" }
  | { kind: "playwright-clock"; timeMs: number }
  | {
      kind: "hook";
      timeMs: number;
      setter: string;
      readback: string;
    };

export interface SideCapture {
  image: Uint8Array;
  observed: {
    viewport: { width: number; height: number };
    devicePixelRatio: number;
    reducedMotion: boolean;
    timeMs: number | null;
  };
  clock: {
    kind: ClockStrategy["kind"];
    requestedTimeMs: number | null;
    pinned: boolean;
    reason?: string;
  };
  motion?: MotionObservation;
}

export interface MotionObservation {
  frames: number;
  distinctFrames: number;
  changed: boolean;
  frameSha256: string[];
}

export interface SideCaptureRequest {
  side: "source" | "destination";
  target: string;
  breakpoint: BreakpointRecord;
  clock: ClockStrategy;
  motion?: MotionOptions | undefined;
}

export interface MotionOptions {
  frames: number;
  intervalMs: number;
}

export type SideCapturer = (
  request: SideCaptureRequest,
) => Promise<SideCapture>;

export type CheckStatus = "pass" | "fail" | "could-not-run";

export interface CheckEntry {
  id: string;
  breakpoint: string;
  status: CheckStatus;
  detail: string;
}

export interface ArtifactHandle {
  side: "source" | "destination";
  handle: string;
  sha256: string;
  width: number;
  height: number;
}

export interface Fidelity {
  rmsePercent: number;
  meanAbsolutePercent: number;
  width: number;
  height: number;
  threshold: number | null;
  /** null when the caller supplied no threshold. */
  pass: boolean | null;
}

export type Validity = "valid" | "invalid" | "unverified" | "could-not-run";

export interface BreakpointResult {
  breakpoint: string;
  validity: Validity;
  checks: CheckEntry[];
  /** Present only when every validity check passed. */
  fidelity?: Fidelity;
  artifacts: ArtifactHandle[];
  alphaNormalization?: {
    /** "none" when both images were opaque and no background was supplied. */
    background: string;
    sourceHadAlpha: boolean;
    destinationHadAlpha: boolean;
  };
  motion?: {
    source?: MotionObservation | undefined;
    destination?: MotionObservation | undefined;
    note: string;
  };
  diagnostics: string[];
}

export interface MatchedCheckReport {
  results: BreakpointResult[];
  totals: {
    breakpoints: number;
    checks: number;
    pass: number;
    fail: number;
    couldNotRun: number;
  };
}

export interface MatchedCheckInput {
  source: { target: string; clock: ClockStrategy };
  destination: { target: string; clock: ClockStrategy };
  breakpoints: BreakpointInput[];
  /** Opaque background (#rrggbb) both sides are flattened onto. */
  background?: string;
  /** Allowed |observed - requested| and source/destination skew, in ms. */
  clockToleranceMs?: number;
  /** Optional caller-owned RMSE threshold in percent. */
  maxRmsePercent?: number;
  motion?: MotionOptions | undefined;
  concurrency?: number;
  capture: SideCapturer;
  storeArtifact?: (name: string, bytes: Uint8Array) => string | Promise<string>;
}

interface Pipeline {
  metadata(): Promise<{
    width?: number;
    height?: number;
    hasAlpha?: boolean;
    space?: string;
    orientation?: number;
  }>;
  flatten(options: {
    background: { r: number; g: number; b: number };
  }): Pipeline;
  removeAlpha(): Pipeline;
  toColourspace(space: string): Pipeline;
  raw(): Pipeline;
  toBuffer(options: {
    resolveWithObject: true;
  }): Promise<{ data: Uint8Array; info: { channels: number } }>;
}

type SharpFactory = (data: Buffer, options: { failOn: "none" }) => Pipeline;

async function loadSharp(): Promise<SharpFactory> {
  const specifier = "sharp";
  const module = (await loadOptionalPeer(
    "sharp",
    () => import(/* @vite-ignore */ specifier),
  )) as { default?: SharpFactory };
  return module.default ?? (module as unknown as SharpFactory);
}

const MAX_CONCURRENCY = 4;
const MAX_MOTION_FRAMES = 6;
const MAX_MOTION_INTERVAL_MS = 1000;

function parseBackground(
  value: string | undefined,
): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? "");
  const hex = match?.[1];
  if (!hex) return null;
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function check(
  breakpoint: string,
  id: string,
  status: CheckStatus,
  detail: string,
): CheckEntry {
  return { id, breakpoint, status, detail };
}

const SAFE_BREAKPOINT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function validateBreakpointRecord(bp: BreakpointRecord): string | null {
  if (typeof bp.name !== "string" || !SAFE_BREAKPOINT_NAME.test(bp.name)) {
    return "name must be 1-64 letters, digits, dashes or underscores, starting with a letter or digit";
  }
  const ints = [bp.width, bp.height];
  if (!ints.every((n) => Number.isInteger(n) && n > 0)) {
    return "width and height must be positive integers";
  }
  if (!(bp.deviceScaleFactor > 0)) return "deviceScaleFactor must be positive";
  const reducedMotion: unknown = bp.reducedMotion;
  if (
    reducedMotion !== undefined &&
    reducedMotion !== "reduce" &&
    reducedMotion !== "no-preference"
  )
    return "unsupported reducedMotion";
  if (bp.colorSpace && bp.colorSpace !== "srgb") {
    return `unsupported colorSpace "${bp.colorSpace}"`;
  }
  if (bp.orientation && bp.orientation !== "normal") {
    return `unsupported orientation "${bp.orientation}"`;
  }
  if (bp.crop) {
    const { left, top, width, height } = bp.crop;
    if (
      left < 0 ||
      top < 0 ||
      !(width > 0) ||
      !(height > 0) ||
      left + width > bp.width ||
      top + height > bp.height
    ) {
      return "crop must lie inside the viewport";
    }
  }
  return null;
}

function expectedPixels(bp: BreakpointRecord): {
  width: number;
  height: number;
} {
  const w = bp.crop?.width ?? bp.width;
  const h = bp.crop?.height ?? bp.height;
  return {
    width: Math.round(w * bp.deviceScaleFactor),
    height: Math.round(h * bp.deviceScaleFactor),
  };
}

function clockCheck(
  bp: string,
  side: "source" | "destination",
  capture: SideCapture,
  tolerance: number,
  requested: ClockStrategy,
): CheckEntry {
  const id = `clock-${side}`;
  if (!capture.clock.pinned || capture.clock.requestedTimeMs === null) {
    return check(
      bp,
      id,
      "could-not-run",
      capture.clock.reason ??
        `${side} clock could not be pinned (${capture.clock.kind}); comparison is unverified`,
    );
  }
  if (
    requested.kind === "unpinned" ||
    capture.clock.kind !== requested.kind ||
    capture.clock.requestedTimeMs !== requested.timeMs
  ) {
    return check(
      bp,
      id,
      "fail",
      `${side} capturer did not honor the requested clock`,
    );
  }
  const observed = capture.observed.timeMs;
  if (observed === null || !Number.isFinite(observed)) {
    return check(
      bp,
      id,
      "could-not-run",
      `${side} pinned time could not be read back`,
    );
  }
  const skew = Math.abs(observed - capture.clock.requestedTimeMs);
  return skew <= tolerance
    ? check(bp, id, "pass", `observed ${observed}ms matches requested`)
    : check(
        bp,
        id,
        "fail",
        `${side} observed time ${observed}ms differs from requested ${capture.clock.requestedTimeMs}ms by ${skew}ms`,
      );
}

function validateSide(
  bp: BreakpointRecord,
  side: "source" | "destination",
  capture: SideCapture,
): CheckEntry[] {
  const out: CheckEntry[] = [];
  const v = capture.observed.viewport;
  out.push(
    v.width === bp.width && v.height === bp.height
      ? check(bp.name, `viewport-${side}`, "pass", `${v.width}x${v.height}`)
      : check(
          bp.name,
          `viewport-${side}`,
          "fail",
          `requested ${bp.width}x${bp.height} but ${side} rendered ${v.width}x${v.height}`,
        ),
  );
  out.push(
    capture.observed.devicePixelRatio === bp.deviceScaleFactor
      ? check(bp.name, `dpr-${side}`, "pass", `${bp.deviceScaleFactor}`)
      : check(
          bp.name,
          `dpr-${side}`,
          "fail",
          `requested DPR ${bp.deviceScaleFactor} but ${side} observed ${capture.observed.devicePixelRatio}`,
        ),
  );
  if (bp.reducedMotion) {
    const wantReduce = bp.reducedMotion === "reduce";
    out.push(
      capture.observed.reducedMotion === wantReduce
        ? check(bp.name, `reduced-motion-${side}`, "pass", bp.reducedMotion)
        : check(
            bp.name,
            `reduced-motion-${side}`,
            "fail",
            `requested ${bp.reducedMotion} but ${side} observed prefers-reduced-motion=${capture.observed.reducedMotion}`,
          ),
    );
  }
  return out;
}

interface Decoded {
  width: number;
  height: number;
  hasAlpha: boolean;
  space: string | undefined;
  orientation: number | undefined;
}

async function decode(
  sharp: SharpFactory,
  bytes: Uint8Array,
): Promise<Decoded> {
  const m = await sharp(Buffer.from(bytes), { failOn: "none" }).metadata();
  if (!m.width || !m.height) throw new Error("image has no dimensions");
  let hasTransparency = false;
  if (m.hasAlpha === true) {
    const { data, info } = await sharp(Buffer.from(bytes), { failOn: "none" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    if (channels >= 2) {
      for (let i = channels - 1; i < data.length; i += channels) {
        if ((data[i] ?? 255) < 255) {
          hasTransparency = true;
          break;
        }
      }
    }
  }
  return {
    width: m.width,
    height: m.height,
    hasAlpha: hasTransparency,
    space: m.space,
    orientation: m.orientation,
  };
}

async function normalizedPixels(
  sharp: SharpFactory,
  bytes: Uint8Array,
  background: { r: number; g: number; b: number },
): Promise<Uint8Array> {
  const { data, info } = await sharp(Buffer.from(bytes), { failOn: "none" })
    .flatten({ background })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) {
    throw new Error(
      `normalized image has ${info.channels} channels, expected 3`,
    );
  }
  return data;
}

function measure(a: Uint8Array, b: Uint8Array): { rmse: number; mae: number } {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  let squared = 0;
  let abs = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (left.readUInt8(i) - right.readUInt8(i)) / 255;
    squared += d * d;
    abs += Math.abs(d);
  }
  return {
    rmse: Math.sqrt(squared / a.length) * 100,
    mae: (abs / a.length) * 100,
  };
}

function sha(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

async function compareBreakpoint(
  input: MatchedCheckInput,
  bp: BreakpointRecord,
  sharp: SharpFactory,
  clockTolerance: number,
): Promise<BreakpointResult> {
  const result: BreakpointResult = {
    breakpoint: bp.name,
    validity: "valid",
    checks: [],
    artifacts: [],
    diagnostics: [],
  };
  const invalid = validateBreakpointRecord(bp);
  if (invalid) {
    result.checks.push(check(bp.name, "breakpoint", "fail", invalid));
    return finalize(result);
  }

  const run = (side: "source" | "destination") =>
    input.capture({
      side,
      target: input[side].target,
      breakpoint: bp,
      clock: input[side].clock,
      motion: input.motion,
    });
  const [sourceSettled, destinationSettled] = await Promise.allSettled([
    run("source"),
    run("destination"),
  ]);
  const captures: Partial<Record<"source" | "destination", SideCapture>> = {};
  const record = (
    side: "source" | "destination",
    s: PromiseSettledResult<SideCapture>,
  ) => {
    if (s.status === "fulfilled") {
      captures[side] = s.value;
      result.checks.push(check(bp.name, `capture-${side}`, "pass", "captured"));
    } else {
      const msg =
        s.reason instanceof Error ? s.reason.message : String(s.reason);
      result.checks.push(
        check(bp.name, `capture-${side}`, "could-not-run", msg),
      );
    }
  };
  record("source", sourceSettled);
  record("destination", destinationSettled);
  const source = captures.source;
  const destination = captures.destination;
  if (!source || !destination) return finalize(result);

  result.checks.push(
    ...validateSide(bp, "source", source),
    ...validateSide(bp, "destination", destination),
    clockCheck(bp.name, "source", source, clockTolerance, input.source.clock),
    clockCheck(
      bp.name,
      "destination",
      destination,
      clockTolerance,
      input.destination.clock,
    ),
  );
  if (
    source.observed.timeMs !== null &&
    destination.observed.timeMs !== null &&
    source.clock.pinned &&
    destination.clock.pinned
  ) {
    const skew = Math.abs(source.observed.timeMs - destination.observed.timeMs);
    result.checks.push(
      skew <= clockTolerance
        ? check(
            bp.name,
            "clock-match",
            "pass",
            "source and destination times match",
          )
        : check(
            bp.name,
            "clock-match",
            "fail",
            `source time ${source.observed.timeMs}ms and destination time ${destination.observed.timeMs}ms differ by ${skew}ms`,
          ),
    );
  } else {
    result.checks.push(
      check(
        bp.name,
        "clock-match",
        "could-not-run",
        "source and destination times are not both pinned and observed",
      ),
    );
  }

  if (source.motion || destination.motion) {
    result.motion = {
      source: source.motion,
      destination: destination.motion,
      note: "Short motion observation only; matching stills do not prove animation fidelity.",
    };
  }

  let decoded: { source: Decoded; destination: Decoded };
  try {
    decoded = {
      source: await decode(sharp, source.image),
      destination: await decode(sharp, destination.image),
    };
  } catch (error) {
    result.checks.push(
      check(
        bp.name,
        "image-decode",
        "fail",
        error instanceof Error ? error.message : String(error),
      ),
    );
    return finalize(result);
  }

  const expected = expectedPixels(bp);
  for (const side of ["source", "destination"] as const) {
    const d = decoded[side];
    result.checks.push(
      d.width === expected.width && d.height === expected.height
        ? check(bp.name, `bounds-${side}`, "pass", `${d.width}x${d.height}`)
        : check(
            bp.name,
            `bounds-${side}`,
            "fail",
            `${side} image is ${d.width}x${d.height}, expected ${expected.width}x${expected.height} for ${bp.crop ? "the crop" : "the viewport"} at DPR ${bp.deviceScaleFactor}`,
          ),
    );
    const badSpace = d.space !== undefined && d.space !== "srgb";
    const badOrientation = d.orientation !== undefined && d.orientation !== 1;
    result.checks.push(
      badSpace || badOrientation
        ? check(
            bp.name,
            `color-orientation-${side}`,
            "fail",
            `${side} image has colorSpace=${d.space ?? "unknown"} orientation=${d.orientation ?? "none"}; requested ${bp.colorSpace ?? "srgb"} / ${bp.orientation ?? "normal"}`,
          )
        : check(bp.name, `color-orientation-${side}`, "pass", "srgb, normal"),
    );
  }

  const backgroundHex = input.background;
  const background = parseBackground(backgroundHex);
  const anyAlpha = decoded.source.hasAlpha || decoded.destination.hasAlpha;
  if (backgroundHex !== undefined && !background) {
    result.checks.push(
      check(
        bp.name,
        "alpha-normalization",
        "fail",
        `background "${backgroundHex}" is not an opaque #rrggbb color`,
      ),
    );
  } else if (anyAlpha && !background) {
    result.checks.push(
      check(
        bp.name,
        "alpha-normalization",
        "fail",
        "an image has transparency but no opaque #rrggbb background was provided to normalize both sides",
      ),
    );
  } else {
    result.checks.push(
      check(
        bp.name,
        "alpha-normalization",
        "pass",
        anyAlpha ? `flattened onto ${input.background}` : "no transparency",
      ),
    );
  }

  if (input.storeArtifact) {
    for (const side of ["source", "destination"] as const) {
      const bytes = (side === "source" ? source : destination).image;
      result.artifacts.push({
        side,
        handle: await input.storeArtifact(`${bp.name}-${side}.png`, bytes),
        sha256: sha(bytes),
        width: decoded[side].width,
        height: decoded[side].height,
      });
    }
  }

  if (result.checks.some((c) => c.status !== "pass")) {
    return finalize(result);
  }

  const flatten = background ?? { r: 255, g: 255, b: 255 };
  const [a, b] = await Promise.all([
    normalizedPixels(sharp, source.image, flatten),
    normalizedPixels(sharp, destination.image, flatten),
  ]);
  if (a.length !== b.length) {
    result.checks.push(
      check(
        bp.name,
        "canvas-match",
        "fail",
        "normalized canvases differ in size",
      ),
    );
    return finalize(result);
  }
  const { rmse, mae } = measure(a, b);
  const threshold = input.maxRmsePercent ?? null;
  result.alphaNormalization = {
    background: backgroundHex ?? "none",
    sourceHadAlpha: decoded.source.hasAlpha,
    destinationHadAlpha: decoded.destination.hasAlpha,
  };
  result.fidelity = {
    rmsePercent: round(rmse),
    meanAbsolutePercent: round(mae),
    width: decoded.source.width,
    height: decoded.source.height,
    threshold,
    pass: threshold === null ? null : rmse <= threshold,
  };
  if (threshold !== null)
    result.checks.push(
      check(
        bp.name,
        "fidelity-threshold",
        rmse <= threshold ? "pass" : "fail",
        `rmse ${round(rmse)}% ${rmse <= threshold ? "meets" : "exceeds"} threshold ${threshold}%`,
      ),
    );
  return finalize(result);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function finalize(result: BreakpointResult): BreakpointResult {
  const failed = result.checks.filter(
    (c) => c.status === "fail" && c.id !== "fidelity-threshold",
  );
  const notRun = result.checks.filter((c) => c.status === "could-not-run");
  const captureFailed = notRun.some((c) => c.id.startsWith("capture-"));
  const onlyClock = notRun.every((c) => c.id.startsWith("clock-"));
  if (failed.length) result.validity = "invalid";
  else if (captureFailed) result.validity = "could-not-run";
  else if (notRun.length && onlyClock) result.validity = "unverified";
  else if (notRun.length) result.validity = "could-not-run";
  else result.validity = "valid";
  result.diagnostics = [...failed, ...notRun].map(
    (c) => `${c.id}: ${c.detail}`,
  );
  if (result.validity !== "valid") delete result.fidelity;
  else if (result.fidelity?.pass === false) {
    result.diagnostics.push(
      `fidelity: rmse ${result.fidelity.rmsePercent}% exceeds threshold ${result.fidelity.threshold}%`,
    );
  } else if (!result.fidelity) {
    result.validity = "could-not-run";
    result.diagnostics.push("fidelity: no metric was produced");
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  const queue = items.entries();
  const failures: unknown[] = [];
  const worker = async () => {
    for (const [index, item] of queue) {
      if (failures.length > 0) return;
      try {
        out[index] = await fn(item);
      } catch (error) {
        failures.push(error);
        return;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  if (failures.length > 0) throw failures[0];
  return out;
}

export function summarizeResults(
  results: BreakpointResult[],
): MatchedCheckReport {
  let pass = 0;
  let fail = 0;
  let couldNotRun = 0;
  for (const r of results) {
    for (const c of r.checks) {
      if (c.status === "pass") pass++;
      else if (c.status === "fail") fail++;
      else couldNotRun++;
    }
  }
  return {
    results,
    totals: {
      breakpoints: results.length,
      checks: pass + fail + couldNotRun,
      pass,
      fail,
      couldNotRun,
    },
  };
}

export async function runMatchedCheck(
  input: MatchedCheckInput,
): Promise<MatchedCheckReport> {
  const sharp = await loadSharp();
  const rawConcurrency = input.concurrency ?? 2;
  if (!Number.isInteger(rawConcurrency) || rawConcurrency < 1) {
    throw new Error("concurrency must be a positive integer.");
  }
  const concurrency = Math.min(rawConcurrency, MAX_CONCURRENCY);
  const tolerance = input.clockToleranceMs ?? 1;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("clockToleranceMs must be a finite non-negative number.");
  }
  if (
    input.motion &&
    (!Number.isInteger(input.motion.frames) ||
      input.motion.frames < 2 ||
      !Number.isFinite(input.motion.intervalMs) ||
      input.motion.intervalMs <= 0)
  )
    throw new Error(
      "motion requires at least two frames and a positive finite intervalMs",
    );
  const motion = input.motion
    ? {
        frames: Math.max(2, Math.min(input.motion.frames, MAX_MOTION_FRAMES)),
        intervalMs: Math.max(
          1,
          Math.min(input.motion.intervalMs, MAX_MOTION_INTERVAL_MS),
        ),
      }
    : undefined;
  const bounded = { ...input, motion };
  if (!Array.isArray(input.breakpoints) || input.breakpoints.length === 0) {
    throw new Error("runMatchedCheck needs at least one breakpoint.");
  }
  const breakpoints = input.breakpoints.map(resolveBreakpoint);
  const seen = new Set<string>();
  for (const bp of breakpoints) {
    const key = bp.name.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate breakpoint name "${bp.name}".`);
    }
    seen.add(key);
  }
  const results = await mapWithConcurrency(breakpoints, concurrency, (bp) =>
    compareBreakpoint(bounded, bp, sharp, tolerance),
  );
  return summarizeResults(results);
}

interface PwPage {
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
  screenshot(options: {
    type: "png";
    clip?: { x: number; y: number; width: number; height: number };
    animations?: "allow";
  }): Promise<Buffer>;
  clock: {
    pauseAt(time: number): Promise<void>;
    runFor(ms: number): Promise<void>;
  };
  waitForTimeout(ms: number): Promise<void>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  clock: { install(options: { time: number }): Promise<void> };
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    reducedMotion: "no-preference" | "reduce";
  }): Promise<PwContext>;
  close(): Promise<void>;
}
interface PwModule {
  chromium: {
    launch(options: {
      headless: boolean;
      args: string[];
      executablePath?: string;
    }): Promise<PwBrowser>;
  };
}

function toClip(crop: CropRect) {
  return { x: crop.left, y: crop.top, width: crop.width, height: crop.height };
}

export interface PlaywrightCapturer {
  capture: SideCapturer;
  close(): Promise<void>;
}

export function createPlaywrightCapturer(
  options: {
    launchArgs?: string[] | undefined;
    headless?: boolean;
    executablePath?: string | undefined;
  } = {},
): PlaywrightCapturer {
  let browserPromise: Promise<PwBrowser> | null = null;
  const getBrowser = (): Promise<PwBrowser> => {
    browserPromise ??= (async () => {
      const specifier = "playwright";
      const pw = (await loadOptionalPeer(
        "playwright",
        () => import(/* @vite-ignore */ specifier),
      )) as PwModule;
      return pw.chromium.launch({
        headless: options.headless !== false,
        args: options.launchArgs ?? [],
        ...(options.executablePath
          ? { executablePath: options.executablePath }
          : {}),
      });
    })();
    return browserPromise;
  };

  const capture: SideCapturer = async (request) => {
    const { breakpoint: bp, clock } = request;
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: bp.deviceScaleFactor,
      reducedMotion: bp.reducedMotion ?? "no-preference",
    });
    try {
      const page = await context.newPage();
      const requestedTimeMs = clock.kind === "unpinned" ? null : clock.timeMs;
      if (clock.kind === "playwright-clock") {
        await context.clock.install({ time: clock.timeMs - 1000 });
        await page.clock.pauseAt(clock.timeMs);
      }
      await page.goto(request.target, { waitUntil: "load" });

      let pinned = false;
      let reason: string | undefined;
      if (clock.kind === "playwright-clock") {
        pinned = true;
      } else if (clock.kind === "hook") {
        const applied = await page.evaluate(
          (a: { setter: string; timeMs: number }) => {
            let target: unknown = globalThis;
            let owner: unknown = globalThis;
            for (const part of a.setter.split(".")) {
              owner = target;
              target = (target as Record<string, unknown> | undefined)?.[part];
            }
            if (typeof target !== "function") return false;
            (target as (t: number) => void).call(owner, a.timeMs);
            return true;
          },
          { setter: clock.setter, timeMs: clock.timeMs },
        );
        pinned = applied;
        if (!applied) {
          reason = `unsupported clock hook: "${clock.setter}" is not a function on the page`;
        }
      } else {
        reason = "no clock strategy: time is not pinned";
      }

      const observed = await page.evaluate(
        (a: { readback: string | null; useDate: boolean }) => {
          let time: number | null = null;
          if (a.readback) {
            let v: unknown = globalThis;
            for (const part of a.readback.split(".")) {
              v = (v as Record<string, unknown> | undefined)?.[part];
            }
            if (typeof v === "function") v = (v as () => unknown)();
            if (typeof v === "number") time = v;
          } else if (a.useDate) {
            time = Date.now();
          }
          return {
            viewport: { width: innerWidth, height: innerHeight },
            devicePixelRatio,
            reducedMotion: matchMedia("(prefers-reduced-motion: reduce)")
              .matches,
            timeMs: time,
          };
        },
        {
          readback: clock.kind === "hook" ? clock.readback : null,
          useDate: clock.kind === "playwright-clock",
        },
      );

      const image = await page.screenshot({
        type: "png",
        ...(bp.crop ? { clip: toClip(bp.crop) } : {}),
        animations: "allow",
      });

      let motion: MotionObservation | undefined;
      if (request.motion) {
        const hashes: string[] = [];
        for (let i = 0; i < request.motion.frames; i++) {
          if (i > 0) {
            if (clock.kind === "playwright-clock") {
              await page.clock.runFor(request.motion.intervalMs);
            } else {
              await page.waitForTimeout(request.motion.intervalMs);
            }
          }
          hashes.push(
            sha(
              await page.screenshot({
                type: "png",
                ...(bp.crop ? { clip: toClip(bp.crop) } : {}),
                animations: "allow",
              }),
            ),
          );
        }
        const distinct = new Set(hashes).size;
        motion = {
          frames: hashes.length,
          distinctFrames: distinct,
          changed: distinct > 1,
          frameSha256: hashes,
        };
      }

      return {
        image,
        observed,
        clock: {
          kind: clock.kind,
          requestedTimeMs,
          pinned,
          ...(reason ? { reason } : {}),
        },
        ...(motion ? { motion } : {}),
      };
    } finally {
      await context.close();
    }
  };

  return {
    capture,
    async close() {
      if (!browserPromise) return;
      // coercion-ok: a failed launch was already reported by the capture that triggered it
      const browser = await browserPromise.catch(() => null);
      await browser?.close();
    },
  };
}
