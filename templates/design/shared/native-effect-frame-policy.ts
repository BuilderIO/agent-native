import type { NativeEffectAnimationCapability } from "./native-effect-animation-capability";

type NativeFrameMount = {
  animationCapability: NativeEffectAnimationCapability;
  clock: { paused: boolean; speed: number };
  frozenReason?: { code: string } | null;
  provider: { needsContinuousFrames(): boolean } | null;
  authoredInputs?: ReadonlyMap<
    string,
    { provider: { needsContinuousFrames(): boolean } }
  >;
};

export function nativeMountNeedsContinuousSourceFrames(
  mount: Pick<NativeFrameMount, "provider" | "authoredInputs" | "frozenReason">,
): boolean {
  if (mount.frozenReason) return false;
  if (mount.provider?.needsContinuousFrames()) return true;
  for (const input of mount.authoredInputs?.values() ?? [])
    if (input.provider.needsContinuousFrames()) return true;
  return false;
}

export function planNativeSceneFrame(
  mounts: Iterable<NativeFrameMount>,
  playing: boolean,
  draftPlaying: boolean | null,
  benchmarkActive: boolean,
  previewDirty: boolean,
  renderBusy: boolean,
): { enter: boolean; scheduleNext: boolean; maySubmit: boolean } {
  const activeMounts = [...mounts].filter((mount) => !mount.frozenReason);
  let scheduleNext =
    activeMounts.length > 0 &&
    (benchmarkActive || previewDirty || draftPlaying === true);
  if (!scheduleNext)
    for (const mount of activeMounts) {
      if (nativeMountNeedsContinuousSourceFrames(mount)) {
        scheduleNext = true;
        break;
      }
      if (
        (draftPlaying ?? playing) &&
        mount.animationCapability !== "static" &&
        !mount.clock.paused &&
        mount.clock.speed !== 0
      ) {
        scheduleNext = true;
        break;
      }
    }
  const enter =
    activeMounts.length > 0 &&
    (draftPlaying === null
      ? playing || scheduleNext
      : draftPlaying || scheduleNext);
  return { enter, scheduleNext, maySubmit: enter && !renderBusy };
}
