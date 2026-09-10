import { open as openExternal } from "@tauri-apps/plugin-shell";

import { resolveDesktopMeetingJoinUrl } from "./meeting-join-url";

type OpenExternal = (url: string) => Promise<void>;

export async function openMeetingJoinUrl(
  joinUrl: string,
  open: OpenExternal = openExternal,
): Promise<void> {
  const nativeJoinUrl = resolveDesktopMeetingJoinUrl(joinUrl);
  if (nativeJoinUrl === joinUrl) {
    await open(joinUrl);
    return;
  }

  try {
    await open(nativeJoinUrl);
  } catch {
    await open(joinUrl);
  }
}
