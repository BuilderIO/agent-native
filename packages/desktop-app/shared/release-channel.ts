export type DesktopReleaseChannel = "production" | "nightly";

declare const __AGENT_NATIVE_DESKTOP_RELEASE_CHANNEL__:
  | DesktopReleaseChannel
  | undefined;

export const DESKTOP_RELEASE_CHANNEL: DesktopReleaseChannel =
  typeof __AGENT_NATIVE_DESKTOP_RELEASE_CHANNEL__ === "string" &&
  __AGENT_NATIVE_DESKTOP_RELEASE_CHANNEL__ === "nightly"
    ? "nightly"
    : "production";
