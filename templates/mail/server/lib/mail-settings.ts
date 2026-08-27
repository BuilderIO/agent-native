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

  const unique = (labels: readonly string[]) => [...new Set(labels)];
  const baseList = unique(base);
  const currentList = unique(current ?? []);
  const nextList = unique(next);
  const baseSet = new Set(baseList);
  const nextSet = new Set(nextList);
  const finalLabels = new Set<string>();

  for (const label of currentList) {
    if (baseSet.has(label) ? nextSet.has(label) : !nextSet.has(label)) {
      finalLabels.add(label);
    }
  }
  for (const label of nextList) {
    if (!baseSet.has(label)) finalLabels.add(label);
  }

  const baseRetained = baseList.filter((label) => nextSet.has(label));
  const nextRetained = nextList.filter((label) => baseSet.has(label));
  const explicitReorder =
    baseRetained.length !== nextRetained.length ||
    baseRetained.some((label, index) => label !== nextRetained[index]);

  if (explicitReorder) {
    return [
      ...nextList.filter((label) => finalLabels.has(label)),
      ...currentList.filter(
        (label) => finalLabels.has(label) && !baseSet.has(label),
      ),
    ];
  }

  const rebased = currentList.filter(
    (label) =>
      finalLabels.has(label) && !(nextSet.has(label) && !baseSet.has(label)),
  );
  for (const [index, label] of nextList.entries()) {
    if (baseSet.has(label)) continue;

    const following = nextList
      .slice(index + 1)
      .find(
        (candidate) => baseSet.has(candidate) && finalLabels.has(candidate),
      );
    if (following) {
      const position = rebased.indexOf(following);
      if (position >= 0) {
        rebased.splice(position, 0, label);
        continue;
      }
    }
    rebased.push(label);
  }
  return rebased;
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
