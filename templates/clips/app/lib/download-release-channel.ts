export type DownloadReleaseChannel = "production" | "nightly";

export const BETA_CLIPS_HOSTNAME = "beta.clips.agent-native.com";

export function getDefaultDownloadChannel(
  hostname: string | undefined,
): DownloadReleaseChannel {
  const normalized = hostname?.trim().toLowerCase().replace(/\.$/, "");
  return normalized === BETA_CLIPS_HOSTNAME ? "nightly" : "production";
}
