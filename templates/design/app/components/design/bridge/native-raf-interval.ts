export class NativeRafIntervalTelemetry {
  private lastContinuousRafAt: number | null = null;

  reset(): void {
    this.lastContinuousRafAt = null;
  }

  onFrame(
    timestamp: number | undefined,
    schedulesNext: boolean,
  ): number | null {
    const previous = this.lastContinuousRafAt;
    this.lastContinuousRafAt = null;
    if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0)
      return null;
    if (schedulesNext) this.lastContinuousRafAt = timestamp;
    if (previous === null) return null;
    const interval = timestamp - previous;
    return Number.isFinite(interval) && interval > 0 ? interval : null;
  }
}
