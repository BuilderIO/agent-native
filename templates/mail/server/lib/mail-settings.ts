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
  return normalizeMailSettings(data, email);
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

export function mergePinnedLabels(
  current: readonly string[] | undefined,
  next: readonly string[] | undefined,
  base?: readonly string[],
): string[] | undefined {
  if (next === undefined) return current ? [...current] : undefined;
  if (base === undefined) return [...next];

  const baseSet = new Set(base);
  const nextSet = new Set<string>();
  const merged: string[] = [];
  for (const label of next) {
    if (nextSet.has(label)) continue;
    nextSet.add(label);
    merged.push(label);
  }
  for (const label of current ?? []) {
    if (baseSet.has(label) || nextSet.has(label)) continue;
    nextSet.add(label);
    merged.push(label);
  }
  return merged;
}

export function normalizeMailSettings(
  data: Partial<UserSettings> | Record<string, unknown> | null,
  email: string,
): UserSettings {
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
