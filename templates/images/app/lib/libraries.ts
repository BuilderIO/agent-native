export type ImageLibrarySummary = {
  id: string;
  title: string;
  description?: string | null;
  referenceCount?: number | null;
  generatedCount?: number | null;
  coverAsset?: { thumbnailUrl?: string | null } | null;
  styleBrief?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  updatedAt?: string | null;
};

const LAST_LIBRARY_KEY = "images.lastLibraryId";

export function loadLastLibraryId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_LIBRARY_KEY);
  } catch {
    return null;
  }
}

export function rememberLastLibraryId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_LIBRARY_KEY, id);
  } catch {
    /* ignore */
  }
}

function usageScore(library: ImageLibrarySummary): number {
  return (library.generatedCount ?? 0) * 2 + (library.referenceCount ?? 0);
}

export function sortLibrariesByUsage<T extends ImageLibrarySummary>(
  libraries: T[],
): T[] {
  return [...libraries].sort((a, b) => {
    const scoreDelta = usageScore(b) - usageScore(a);
    if (scoreDelta) return scoreDelta;
    const dateDelta =
      Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? "");
    if (Number.isFinite(dateDelta) && dateDelta) return dateDelta;
    return a.title.localeCompare(b.title);
  });
}

export function sortLibrariesForCreate<T extends ImageLibrarySummary>(
  libraries: T[],
): T[] {
  const sorted = sortLibrariesByUsage(libraries);
  const lastLibraryId = loadLastLibraryId();
  if (!lastLibraryId) return sorted;

  const last = sorted.find((library) => library.id === lastLibraryId);
  if (!last) return sorted;
  return [last, ...sorted.filter((library) => library.id !== lastLibraryId)];
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getLibraryCustomInstructions(
  library?: ImageLibrarySummary | null,
): string | null {
  if (!library) return null;
  const fromRoot =
    stringField((library as any).customInstructions) ??
    stringField((library as any).instructions);
  if (fromRoot) return fromRoot;

  const styleBrief = library.styleBrief ?? {};
  const settings = library.settings ?? {};
  return (
    stringField(styleBrief.customInstructions) ??
    stringField(styleBrief.instructions) ??
    stringField(settings.customInstructions) ??
    stringField(settings.instructions)
  );
}
