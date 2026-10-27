import {
  contentSidebarSectionsSchema,
  type ContentSidebarSections,
} from "@shared/content-personal-navigation";

// The sidebar's sections and how many rows each drew come from three reads
// that land in any order. What this browser last drew for the same person,
// organization, and space lets the first frame reserve each section at that
// size, so later rows fill in place instead of pushing the sections below.
// The Files folders that were open are kept by ID, so the next load reads
// them with the tree. Only counts, IDs, and section settings are kept, never
// titles.
const SIDEBAR_LAYOUT_HINT_STORAGE_KEY = "content-sidebar-layout-v1";

// Rows each section shows before "Show more", and the most a hint reserves.
export const SIDEBAR_SECTION_ROW_LIMIT = 5;
const MAX_HINTED_FILES_ROWS = 100;
const MAX_HINTED_FILES_BRANCHES = 32;

export type SidebarRowsHint = { rows: number; more: boolean };

export type SidebarLayoutHint = {
  sections?: ContentSidebarSections;
  pinned?: SidebarRowsHint;
  recent?: SidebarRowsHint;
  files?: SidebarRowsHint;
  /** Rows each open Files folder drew, by folder document ID. */
  branches?: Record<string, SidebarRowsHint>;
};

function parseRows(value: unknown, max: number): SidebarRowsHint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { rows, more } = value as { rows?: unknown; more?: unknown };
  if (typeof rows !== "number" || !Number.isInteger(rows) || rows < 0) {
    return undefined;
  }
  return { rows: Math.min(rows, max), more: more === true };
}

// Folders are stored oldest first, so the cap keeps the most recently drawn.
function parseBranches(
  value: unknown,
): Record<string, SidebarRowsHint> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(-MAX_HINTED_FILES_BRANCHES)
      .flatMap(([documentId, rows]) => {
        const parsed = parseRows(rows, MAX_HINTED_FILES_ROWS);
        return parsed ? [[documentId, parsed]] : [];
      }),
  );
}

/** Open folders with `documentId` moved last, as the most recently drawn. */
export function withShownFilesBranch(
  branches: Readonly<Record<string, SidebarRowsHint>> | undefined,
  documentId: string,
  rows: SidebarRowsHint,
): Record<string, SidebarRowsHint> {
  const { [documentId]: _previous, ...others } = branches ?? {};
  return { ...others, [documentId]: rows };
}

function readStoredHint(): {
  scope?: unknown;
  spaceId?: unknown;
  hint: Record<string, unknown>;
} | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SIDEBAR_LAYOUT_HINT_STORAGE_KEY);
  } catch {
    // coercion-ok: an unreadable hint only means the sidebar may settle once.
    return null;
  }
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>;
    return { scope: stored.scope, spaceId: stored.spaceId, hint: stored };
  } catch {
    // coercion-ok: a malformed hint is ignored and replaced by the next write.
    return null;
  }
}

// Before the spaces arrive the space is unknown (`null`); the sidebar then
// opens the space it last drew, so that space's hint applies.
export function readSidebarLayoutHint(
  scope: string | null,
  spaceId: string | null,
): SidebarLayoutHint {
  if (!scope) return {};
  const stored = readStoredHint();
  if (
    !stored ||
    stored.scope !== scope ||
    (spaceId !== null && stored.spaceId !== spaceId)
  ) {
    return {};
  }
  const sections = contentSidebarSectionsSchema.safeParse(stored.hint.sections);
  return {
    ...(sections.success ? { sections: sections.data } : {}),
    pinned: parseRows(stored.hint.pinned, SIDEBAR_SECTION_ROW_LIMIT),
    recent: parseRows(stored.hint.recent, SIDEBAR_SECTION_ROW_LIMIT),
    files: parseRows(stored.hint.files, MAX_HINTED_FILES_ROWS),
    branches: parseBranches(stored.hint.branches),
  };
}

export function rememberSidebarLayout(
  scope: string | null,
  spaceId: string | null,
  update: SidebarLayoutHint,
) {
  if (!scope || !spaceId) return;
  const current = readSidebarLayoutHint(scope, spaceId);
  const next = { scope, spaceId, ...current, ...update };
  try {
    localStorage.setItem(SIDEBAR_LAYOUT_HINT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // coercion-ok: without storage the next load draws default sizes.
  }
}

// A section with `count` rows shows the first few and a "Show more" row.
export function sectionRowsHint(count: number): SidebarRowsHint {
  return {
    rows: Math.min(count, SIDEBAR_SECTION_ROW_LIMIT),
    more: count > SIDEBAR_SECTION_ROW_LIMIT,
  };
}
