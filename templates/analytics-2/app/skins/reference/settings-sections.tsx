import type { SettingsSectionsProps } from "@agent-native/toolkit/app/settings";
import { resolveSettingsPresentation } from "@agent-native/toolkit/app/settings/rows/index";
import type { ComponentType } from "react";

import { frames } from "./settings/frames";

/**
 * A frame draws one family of settings panel from its sections. It is chosen by
 * the `frame` hint, and it is written against row kinds and hints only: it never
 * looks at a row's id, label or position.
 */
export type ReferenceSettingsFrame = ComponentType<SettingsSectionsProps>;

const FRAMES: Readonly<Record<string, ReferenceSettingsFrame>> = {
  ...frames,
};

export function ReferenceSettingsSections(input: SettingsSectionsProps) {
  const props = resolveSettingsPresentation(input);
  const frame = props.hints?.frame;
  const Frame = typeof frame === "string" ? FRAMES[frame] : undefined;
  if (!Frame)
    throw new Error(`Missing reference Settings frame: ${String(frame)}`);
  return <Frame {...props} />;
}
