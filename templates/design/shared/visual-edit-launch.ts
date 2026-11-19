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
  /** The installed desktop channel's scheme, set only after local detection. */
  desktopProtocol?: "agentnative" | "agentnative-nightly";
  message?: string;
}
