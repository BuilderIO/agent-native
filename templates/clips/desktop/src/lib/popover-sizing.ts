export type PopoverAutoSizeView = "recorder" | "memory" | "settings";

export type PopoverResizePurpose = "popover" | "settings";

export function getPopoverAutoSizeOptions(
  view: PopoverAutoSizeView,
  popoverVisible: boolean,
  recordingActive: boolean,
): {
  disabled: boolean;
  width: number;
  purpose: PopoverResizePurpose;
} {
  const isSettings = view === "settings";

  return {
    disabled: !isSettings && (!popoverVisible || recordingActive),
    width: isSettings ? 720 : view === "memory" ? 440 : 320,
    purpose: isSettings ? "settings" : "popover",
  };
}
