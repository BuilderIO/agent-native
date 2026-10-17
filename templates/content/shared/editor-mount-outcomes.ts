export const EDITOR_MOUNT_OUTCOMES = [
  "initial",
  "navigation",
  "mode_switch",
  "remount",
  // A doc the server refused was rebuilt, an error path counted apart from remounts.
  "recovery",
  // The signed-in account changed, so the page started over on a new doc.
  "account_change",
] as const;
export const EDITOR_MOUNT_MODES = [
  "editing",
  "suggesting",
  "readonly",
] as const;
export type EditorMountOutcome = (typeof EDITOR_MOUNT_OUTCOMES)[number];
export type EditorMountMode = (typeof EDITOR_MOUNT_MODES)[number];
export type EditorMountCause = Extract<
  EditorMountOutcome,
  "recovery" | "account_change"
>;
