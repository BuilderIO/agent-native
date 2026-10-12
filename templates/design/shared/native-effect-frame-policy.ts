import type { NativeEffectAnimationCapability } from "./native-effect-animation-capability";

type NativeFrameMount = {
  animationCapability: NativeEffectAnimationCapability;
  clock: { paused: boolean; speed: number };
  provider: { needsContinuousFrames(): boolean } | null;
  authoredInputs?: ReadonlyMap<
    string,
    { provider: { needsContinuousFrames(): boolean } }
  >;
};

export function nativeMountNeedsContinuousSourceFrames(
  mount: Pick<NativeFrameMount, "provider" | "authoredInputs">,
): boolean {
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
  let scheduleNext = benchmarkActive || previewDirty || draftPlaying === true;
  if (!scheduleNext)
    for (const mount of mounts) {
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
    draftPlaying === null
      ? playing || scheduleNext
      : draftPlaying || scheduleNext;
  return { enter, scheduleNext, maySubmit: enter && !renderBusy };
}
