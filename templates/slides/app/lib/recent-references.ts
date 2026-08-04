export const RECENT_REFERENCES_STORAGE_KEY = "slides:recent-references";

export type RecentReferenceKind = "deck" | "design-system";

export interface RecentReference {
  id: string;
  kind: RecentReferenceKind;
  lastUsedAt: number;
}

export interface RecentReferencesResult {
  items: RecentReference[];
  readable: boolean;
}

const MAX_RECENT_REFERENCES = 8;

function isRecentReference(value: unknown): value is RecentReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RecentReference>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    (candidate.kind === "deck" || candidate.kind === "design-system") &&
    typeof candidate.lastUsedAt === "number" &&
    Number.isFinite(candidate.lastUsedAt)
  );
}

export function readRecentReferences(
  storage: Pick<Storage, "getItem"> | null | undefined =
    typeof window === "undefined" ? null : window.localStorage,
): RecentReferencesResult {
  if (!storage) return { items: [], readable: true };

  let raw: string | null;
  try {
    raw = storage.getItem(RECENT_REFERENCES_STORAGE_KEY);
  } catch {
    return { items: [], readable: false };
  }

  if (raw === null) return { items: [], readable: true };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { items: [], readable: false };
    return {
      items: parsed.filter(isRecentReference).slice(0, MAX_RECENT_REFERENCES),
      readable: true,
    };
  } catch {
    return { items: [], readable: false };
  }
}

export function rememberRecentReference(
  reference: Omit<RecentReference, "lastUsedAt">,
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined =
    typeof window === "undefined" ? null : window.localStorage,
): RecentReferencesResult {
  const current = readRecentReferences(storage);
  if (!storage || !current.readable) return current;

  const next: RecentReference[] = [
    { ...reference, lastUsedAt: Date.now() },
    ...current.items.filter(
      (item) => !(item.id === reference.id && item.kind === reference.kind),
    ),
  ].slice(0, MAX_RECENT_REFERENCES);

  try {
    storage.setItem(RECENT_REFERENCES_STORAGE_KEY, JSON.stringify(next));
    return { items: next, readable: true };
  } catch {
    return { items: current.items, readable: false };
  }
}
