export interface FragmentLocation {
  byte: number;
  sec: number;
}

const MIN_SLOPE_SPAN_SECONDS = 0.5;

export interface EstimateBounds {
  totalBytes: number | null;
  durationSec: number;
}

export class ByteTimeMap {
  private readonly anchors: FragmentLocation[] = [];

  constructor(private readonly initLength: number) {}

  get size(): number {
    return this.anchors.length;
  }

  add(byte: number, sec: number): void {
    if (!Number.isFinite(byte) || !Number.isFinite(sec)) return;
    if (byte < this.initLength || sec < 0) return;
    const existing = this.anchors.findIndex((a) => a.byte === byte);
    if (existing >= 0) {
      this.anchors[existing] = { byte, sec };
      return;
    }
    this.anchors.push({ byte, sec });
    this.anchors.sort((a, b) => a.byte - b.byte);
  }

  estimate(targetSec: number, bounds: EstimateBounds): number {
    const points = this.referencePoints(bounds);
    const byDistance = points
      .slice()
      .sort(
        (a, b) =>
          Math.abs(a.sec - targetSec) - Math.abs(b.sec - targetSec) ||
          a.byte - b.byte,
      );

    const near = byDistance[0];
    const far = near
      ? byDistance.find(
          (p) =>
            p.byte !== near.byte &&
            Math.abs(p.sec - near.sec) >= MIN_SLOPE_SPAN_SECONDS,
        )
      : undefined;
    if (!near || !far) return this.initLength;

    const slope = (far.byte - near.byte) / (far.sec - near.sec);
    if (!(slope > 0)) return this.initLength;
    return this.clampByte(near.byte + (targetSec - near.sec) * slope, bounds);
  }

  private referencePoints(bounds: EstimateBounds): FragmentLocation[] {
    const points: FragmentLocation[] = [{ byte: this.initLength, sec: 0 }];
    for (const anchor of this.anchors) {
      if (anchor.byte !== this.initLength) points.push(anchor);
    }
    if (
      bounds.totalBytes !== null &&
      bounds.durationSec > 0 &&
      bounds.totalBytes > this.initLength &&
      !points.some((p) => p.byte === bounds.totalBytes)
    ) {
      points.push({ byte: bounds.totalBytes, sec: bounds.durationSec });
    }
    return points;
  }

  private clampByte(byte: number, bounds: EstimateBounds): number {
    const floored = Math.max(this.initLength, Math.floor(byte));
    if (bounds.totalBytes === null) return floored;
    return Math.min(floored, Math.max(this.initLength, bounds.totalBytes - 1));
  }
}

export interface ResolveSeekOptions<T extends FragmentLocation> {
  target: number;
  initLength: number;
  probeSize: number;
  maxProbes: number;
  acceptUndershootSeconds: number;
  estimate: () => number;
  probe: (startByte: number) => Promise<T | null>;
  superseded?: () => boolean;
}

export interface ResolvedSeek<T> {
  chosen: T | null;
  overshot: boolean;
  probes: number;
  superseded: boolean;
}

export async function resolveSeekFragment<T extends FragmentLocation>(
  opts: ResolveSeekOptions<T>,
): Promise<ResolvedSeek<T>> {
  const { target, initLength, probeSize, maxProbes } = opts;
  let landed: T | null = null;
  let overshoot: T | null = null;
  let lowerByte = initLength;
  let upperByte: number | null = null;
  let forwardStep = probeSize;
  let backStep = probeSize;
  let lastStart: number | null = null;
  let probes = 0;

  for (let attempt = 0; attempt < maxProbes; attempt++) {
    if (opts.superseded?.()) {
      return { chosen: null, overshot: false, probes, superseded: true };
    }

    const estimated = opts.estimate();
    let guess = estimated - Math.floor(probeSize / 2);
    if (upperByte !== null) {
      const ceiling = upperByte - backStep;
      backStep *= 2;
      guess = Math.min(guess, ceiling);
      if (guess <= lowerByte) {
        guess =
          upperByte - lowerByte <= probeSize
            ? lowerByte
            : Math.floor((lowerByte + upperByte) / 2);
      }
    } else if (estimated <= lowerByte) {
      guess = lowerByte + forwardStep;
      forwardStep *= 2;
    }

    const start = Math.max(Math.floor(guess), initLength);
    if (upperByte !== null && start >= upperByte) break;
    if (start === lastStart) break;
    lastStart = start;

    probes++;
    const candidate = await opts.probe(start);

    if (!candidate) {
      if (upperByte === null || start < upperByte) upperByte = start;
      if (upperByte <= initLength) break;
      continue;
    }

    if (candidate.sec <= target) {
      if (!landed || candidate.sec > landed.sec) landed = candidate;
      if (candidate.byte > lowerByte) lowerByte = candidate.byte;
      if (target - candidate.sec <= opts.acceptUndershootSeconds) break;
      continue;
    }

    if (!overshoot || candidate.byte < overshoot.byte) overshoot = candidate;
    if (upperByte === null || start < upperByte) upperByte = start;
  }

  const chosen = landed ?? overshoot;
  return {
    chosen,
    overshot: chosen !== null && landed === null,
    probes,
    superseded: false,
  };
}
