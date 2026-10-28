export type PopoverAutoSizeView = "recorder" | "memory" | "settings";

export function getPopoverAutoSizeOptions(
  view: PopoverAutoSizeView,
  popoverVisible: boolean,
  recordingStartPending: boolean,
): {
  disabled: boolean;
  width: number;
} {
  const isSettings = view === "settings";

  return {
    disabled: !isSettings && (!popoverVisible || recordingStartPending),
    width: isSettings ? 720 : view === "memory" ? 440 : 320,
  };
}
