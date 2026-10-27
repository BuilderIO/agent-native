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

/** Pixel lengths show as bare numbers and angles in degrees as °. */
export function inspectorDisplayUnit(
  unit: string | undefined,
): string | undefined {
  if (unit === "px") return "";
  if (unit === "deg") return "°";
  return unit;
}

export function ScrubInput(props: ScrubInputProps) {
  return (
    <VisualScrubInput
      allowRelativeExpressions
      displayUnit={inspectorDisplayUnit(props.unit)}
      {...props}
      blurOnEnter
    />
  );
}
