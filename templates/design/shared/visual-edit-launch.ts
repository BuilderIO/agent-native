export type VisualEditLaunchTarget =
  | "inline-browser"
  | "system-browser"
  | "desktop";

export interface VisualEditLaunchResult {
  target: VisualEditLaunchTarget;
  status:
    | "inline"
    | "host-required"
    | "dispatched"
    | "desktop-not-detected"
    | "blocked"
    | "failed";
  browserUrl: string;
  desktopUrl: string;
  message?: string;
}
