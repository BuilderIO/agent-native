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
};

export class NativePreviewPolicyController {
  private policy: EffectPreviewPolicy = DEFAULT_NATIVE_PREVIEW_POLICY;
  private autoTier = 0;
  private slowFrames = 0;
  private fastFrames = 0;
  private lastSubmittedAt = 0;

  setPolicy(policy: EffectPreviewPolicy): boolean {
    if (
      this.policy.quality === policy.quality &&
      this.policy.frameRateTarget === policy.frameRateTarget
    )
      return false;
    this.policy = { ...policy };
    this.autoTier = 0;
    this.slowFrames = 0;
    this.fastFrames = 0;
    this.lastSubmittedAt = 0;
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
      effectivePixelRatio: Math.max(0.5, capped * scale),
      targetFrameIntervalMs: 1000 / this.policy.frameRateTarget,
      ...(renderWallMs === undefined ? {} : { renderWallMs }),
      ...(rafIntervalMs === undefined ? {} : { rafIntervalMs }),
    };
  }

  shouldSubmit(now: number, dirty: boolean): boolean {
    if (dirty || !this.lastSubmittedAt || now < this.lastSubmittedAt) {
      this.lastSubmittedAt = now;
      return true;
    }
    if (now - this.lastSubmittedAt + 0.25 < 1000 / this.policy.frameRateTarget)
      return false;
    this.lastSubmittedAt = now;
    return true;
  }

  observeRenderWall(wallMs: number): boolean {
    if (
      this.policy.quality !== "auto" ||
      !Number.isFinite(wallMs) ||
      wallMs < 0
    )
      return false;
    const budget = 1000 / this.policy.frameRateTarget;
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
      if (this.fastFrames >= 90 && this.autoTier > 0) {
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
