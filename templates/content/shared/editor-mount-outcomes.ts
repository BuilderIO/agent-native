export const EDITOR_MOUNT_OUTCOMES = [
  "initial",
  "navigation",
  "mode_switch",
  "remount",
] as const;
export const EDITOR_MOUNT_MODES = [
  "editing",
  "suggesting",
  "readonly",
] as const;
export type EditorMountOutcome = (typeof EDITOR_MOUNT_OUTCOMES)[number];
export type EditorMountMode = (typeof EDITOR_MOUNT_MODES)[number];
