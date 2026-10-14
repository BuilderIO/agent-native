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
  private lastSubmittedAt = 0;
  private overviewCompact = false;

  setOverviewCompact(compact: boolean): boolean {
    if (this.overviewCompact === compact) return false;
    this.overviewCompact = compact;
    this.lastSubmittedAt = 0;
    return true;
  }

  setPolicy(policy: EffectPreviewPolicy): boolean {
    if (
      this.policy.quality === policy.quality &&
      this.policy.frameRateTarget === policy.frameRateTarget
    )
      return false;
    this.policy = { ...policy };
    this.autoTier = 0;
    this.budgetFloorTier = 0;
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

  shouldSubmit(now: number, dirty: boolean): boolean {
    if (
      (!this.overviewCompact && dirty) ||
      !this.lastSubmittedAt ||
      now < this.lastSubmittedAt
    ) {
      this.lastSubmittedAt = now;
      return true;
    }
    const interval = this.overviewCompact
      ? 1000 / 15
      : 1000 / this.policy.frameRateTarget;
    if (now - this.lastSubmittedAt + 0.25 < interval) return false;
    this.lastSubmittedAt = now;
    return true;
  }

  observeResourceBudgetExceeded(): boolean {
    if (this.policy.quality !== "auto" || this.autoTier >= 2) return false;
    this.autoTier += 1;
    this.budgetFloorTier = this.autoTier;
    this.slowFrames = 0;
    this.fastFrames = 0;
    return true;
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
