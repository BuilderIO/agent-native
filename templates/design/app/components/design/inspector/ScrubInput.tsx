import {
  VisualScrubInput,
  type ScrubInputProps,
} from "@agent-native/toolkit/design-tweaks";

export {
  resolvePendingScrubCommit,
  type PendingScrubCommit,
  type ScrubInputChangeMeta,
  type ScrubInputProps,
} from "@agent-native/toolkit/design-tweaks";

export function ScrubInput(props: ScrubInputProps) {
  return <VisualScrubInput allowRelativeExpressions {...props} blurOnEnter />;
}
