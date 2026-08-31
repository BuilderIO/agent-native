import { getUserSetting } from "@agent-native/core/settings";

import { normalizeSignature } from "../../shared/signature.js";
import type { SavedMailFilter, UserSettings } from "../../shared/types.js";

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

export function mergeSavedFilters(
  current: readonly SavedMailFilter[] | undefined,
  next: readonly SavedMailFilter[] | undefined,
  base?: readonly SavedMailFilter[],
): SavedMailFilter[] | undefined {
  if (next === undefined) return current ? [...current] : undefined;
  if (base === undefined) return [...next].slice(0, 20);

  const baseById = new Map(base.map((filter) => [filter.id, filter]));
  const nextById = new Map(next.map((filter) => [filter.id, filter]));
  const result = (current ?? [])
    .filter((filter) => !baseById.has(filter.id) || nextById.has(filter.id))
    .map((filter) => ({ ...filter }));
  const sameFilter = (left: SavedMailFilter, right: SavedMailFilter) =>
    left.id === right.id &&
    left.name === right.name &&
    left.query === right.query;

  for (const filter of next) {
    const baseFilter = baseById.get(filter.id);
    const currentIndex = result.findIndex((item) => item.id === filter.id);
    if (!baseFilter) {
      if (currentIndex === -1) result.push({ ...filter });
      continue;
    }
    if (!sameFilter(baseFilter, filter)) {
      if (currentIndex === -1) result.push({ ...filter });
      else result[currentIndex] = { ...filter };
    }
  }

  if (result.length > 20) {
    throw new Error("Saved filters changed in another tab; please retry.");
  }
  return result;
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
        (label) =>
          finalLabels.has(label) && !baseSet.has(label) && !nextSet.has(label),
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
    const savedFilters = normalizeSavedFilters(data.savedFilters);
    const { savedFilters: _rawSavedFilters, ...dataWithoutSavedFilters } =
      data as Record<string, unknown>;
    return {
      ...DEFAULT_SETTINGS,
      ...(dataWithoutSavedFilters as Partial<UserSettings>),
      email: (data as Partial<UserSettings>).email || email,
      signature: normalizeSignature((data as Partial<UserSettings>).signature),
      ...(savedFilters ? { savedFilters } : {}),
    } as UserSettings;
  }
  return { ...DEFAULT_SETTINGS, email };
}

function normalizeSavedFilters(value: unknown): SavedMailFilter[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<string>();
  const filters: SavedMailFilter[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name =
      typeof candidate.name === "string" ? candidate.name.trim() : "";
    const query =
      typeof candidate.query === "string" ? candidate.query.trim() : "";
    const normalizedId = id.slice(0, 80);
    if (!normalizedId || !name || !query || seen.has(normalizedId)) continue;
    seen.add(normalizedId);
    filters.push({
      id: normalizedId,
      name: name.slice(0, 80),
      query: query.slice(0, 500),
    });
    if (filters.length === 20) break;
  }
  return filters;
}
