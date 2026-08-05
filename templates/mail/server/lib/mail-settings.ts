import { getUserSetting } from "@agent-native/core/settings";

import { normalizeSignature } from "../../shared/signature.js";
import type { UserSettings } from "../../shared/types.js";

export const DEFAULT_SETTINGS: UserSettings = {
  name: "",
  email: "",
  signature: "",
  writingStyle: "",
  theme: "dark",
  density: "comfortable",
  previewPane: "right",
  sendAndArchive: false,
  undoSendDelay: 5,
  tracking: { opens: false, clicks: false },
};

export async function readSettings(email: string): Promise<UserSettings> {
  const data = await getUserSetting(email, "mail-settings");
  if (data) {
    return {
      ...DEFAULT_SETTINGS,
      ...(data as Partial<UserSettings>),
      email: (data as Partial<UserSettings>).email || email,
      signature: normalizeSignature((data as Partial<UserSettings>).signature),
    } as UserSettings;
  }
  return { ...DEFAULT_SETTINGS, email };
}

export function mergeSettings(
  current: UserSettings,
  patch: Partial<UserSettings>,
): UserSettings {
  return {
    ...current,
    ...patch,
    ...(patch.signature !== undefined
      ? { signature: normalizeSignature(patch.signature) }
      : {}),
  };
}
