import type { EffectPreviewPolicy } from "../../../../shared/native-effects";

export interface NativePreviewStatus {
  requestedQuality: EffectPreviewPolicy["quality"];
  frameRateTarget: EffectPreviewPolicy["frameRateTarget"];
  devicePixelRatio: number;
  effectivePixelRatio: number;
  targetFrameIntervalMs: number;
  renderWallMs?: number;
  rafIntervalMs?: number;
}

export const DEFAULT_NATIVE_PREVIEW_POLICY: EffectPreviewPolicy = {
  quality: "auto",
  frameRateTarget: 60,
  colorMode: "srgb",
  dynamicRange: "sdr",
};

export function resolveNativePreviewPolicy(
  editorPolicy: EffectPreviewPolicy | null,
  documentPolicy: EffectPreviewPolicy | undefined,
): EffectPreviewPolicy {
  return editorPolicy ?? documentPolicy ?? DEFAULT_NATIVE_PREVIEW_POLICY;
}

export class NativePreviewPolicyController {
  private policy: EffectPreviewPolicy = DEFAULT_NATIVE_PREVIEW_POLICY;
  private autoTier = 0;
  private budgetFloorTier = 0;
  private slowFrames = 0;
  private fastFrames = 0;
  private cadenceSlowFrames = 0;
  private cadenceFastFrames = 0;
  private lastSubmittedAt: number | null = null;
  private nextSubmissionAt: number | null = null;
  private overviewCompact = false;

  resetDensityBudget(): void {
    this.autoTier = 0;
    this.budgetFloorTier = 0;
    this.slowFrames = 0;
    this.fastFrames = 0;
    this.resetCommittedCadence();
  }

  setOverviewCompact(compact: boolean): boolean {
    if (this.overviewCompact === compact) return false;
    this.overviewCompact = compact;
    this.resetCommittedCadence();
    this.lastSubmittedAt = null;
    this.nextSubmissionAt = null;
    return true;
  }

  setPolicy(policy: EffectPreviewPolicy): boolean {
    if (
      this.policy.quality === policy.quality &&
      this.policy.frameRateTarget === policy.frameRateTarget
    )
      return false;
    this.policy = { ...policy };
    this.resetCommittedCadence();
    this.autoTier = 0;
    this.budgetFloorTier = 0;
    this.slowFrames = 0;
    this.fastFrames = 0;
    this.lastSubmittedAt = null;
    this.nextSubmissionAt = null;
    return true;
  }

  status(
    deviceRatio: number,
    renderWallMs?: number,
    rafIntervalMs?: number,
  ): NativePreviewStatus {
    const devicePixelRatio =
      Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
    const capped = Math.min(devicePixelRatio, 2);
    const scale =
      this.policy.quality === "performance"
        ? 0.75
        : this.policy.quality === "auto"
          ? [1, 0.875, 0.75][this.autoTier]
          : 1;
    return {
      requestedQuality: this.policy.quality,
      frameRateTarget: this.policy.frameRateTarget,
      devicePixelRatio,
      effectivePixelRatio: Math.max(
        0.5,
        this.overviewCompact ? Math.min(0.75, capped * scale) : capped * scale,
      ),
      targetFrameIntervalMs: this.overviewCompact
        ? 1000 / 15
        : 1000 / this.policy.frameRateTarget,
      ...(renderWallMs === undefined ? {} : { renderWallMs }),
      ...(rafIntervalMs === undefined ? {} : { rafIntervalMs }),
    };
  }

  isSubmissionDue(now: number, dirty: boolean, earlyWindowMs = 0.25): boolean {
    if (
      (!this.overviewCompact && dirty) ||
      this.lastSubmittedAt === null ||
      this.nextSubmissionAt === null ||
      now < this.lastSubmittedAt
    )
      return true;
    return now + earlyWindowMs >= this.nextSubmissionAt;
  }

  commitSubmission(now: number, dirty: boolean): void {
    const interval = this.overviewCompact
      ? 1000 / 15
      : 1000 / this.policy.frameRateTarget;
    if (
      (!this.overviewCompact && dirty) ||
      this.lastSubmittedAt === null ||
      this.nextSubmissionAt === null ||
      now < this.lastSubmittedAt
    ) {
      this.lastSubmittedAt = now;
      this.nextSubmissionAt = now + interval;
      return;
    }
    const elapsedIntervals = Math.max(
      1,
      Math.floor((now + 0.25 - this.nextSubmissionAt) / interval) + 1,
    );
    this.nextSubmissionAt += elapsedIntervals * interval;
    this.lastSubmittedAt = now;
  }

  shouldSubmit(now: number, dirty: boolean): boolean {
    if (!this.isSubmissionDue(now, dirty)) return false;
    this.commitSubmission(now, dirty);
    return true;
  }

  observeResourceBudgetExceeded(): boolean {
    if (this.policy.quality !== "auto" || this.autoTier >= 2) return false;
    this.autoTier += 1;
    this.budgetFloorTier = this.autoTier;
    this.resetCommittedCadence();
    this.slowFrames = 0;
    this.fastFrames = 0;
    return true;
  }

  resetCommittedCadence(): void {
    this.cadenceSlowFrames = 0;
    this.cadenceFastFrames = 0;
  }

  // The caller supplies elapsed/commits from a continuous animation window, not adjacent burst completions.
  observeCommittedCadence(intervalMs: number, committedFrames = 1): boolean {
    if (
      this.policy.quality !== "auto" ||
      !Number.isFinite(intervalMs) ||
      intervalMs <= 0 ||
      !Number.isSafeInteger(committedFrames) ||
      committedFrames <= 0
    ) {
      this.resetCommittedCadence();
      return false;
    }
    const budget = this.overviewCompact
      ? 1000 / 15
      : 1000 / this.policy.frameRateTarget;
    if (intervalMs > budget * 1.5) {
      this.cadenceFastFrames = 0;
      this.cadenceSlowFrames = Math.min(
        8,
        this.cadenceSlowFrames + Math.min(8, committedFrames),
      );
      if (this.cadenceSlowFrames >= 8 && this.autoTier < 2) {
        this.autoTier++;
        this.resetCommittedCadence();
        return true;
      }
    } else if (intervalMs <= budget * 1.1) {
      this.cadenceSlowFrames = 0;
      this.cadenceFastFrames = Math.min(
        90,
        this.cadenceFastFrames + Math.min(90, committedFrames),
      );
      if (
        this.cadenceFastFrames >= 90 &&
        this.autoTier > this.budgetFloorTier
      ) {
        this.autoTier--;
        this.resetCommittedCadence();
        return true;
      }
    } else {
      this.resetCommittedCadence();
    }
    return false;
  }

  observeRenderWall(wallMs: number): boolean {
    if (
      this.policy.quality !== "auto" ||
      !Number.isFinite(wallMs) ||
      wallMs < 0
    )
      return false;
    const budget = this.overviewCompact
      ? 1000 / 15
      : 1000 / this.policy.frameRateTarget;
    if (wallMs > budget * 0.85) {
      this.slowFrames += 1;
      this.fastFrames = 0;
      if (this.slowFrames >= 8 && this.autoTier < 2) {
        this.autoTier += 1;
        this.slowFrames = 0;
        return true;
      }
    } else if (wallMs < budget * 0.55) {
      this.fastFrames += 1;
      this.slowFrames = 0;
      if (this.fastFrames >= 90 && this.autoTier > this.budgetFloorTier) {
        this.autoTier -= 1;
        this.fastFrames = 0;
        return true;
      }
    } else {
      this.slowFrames = 0;
      this.fastFrames = 0;
    }
    return false;
  }
}
