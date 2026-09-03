/**
 * Shapes the sidebar and command menu need from `list-crm-lists` and
 * `list-crm-saved-views`. Both actions are read defensively because the wave-1
 * contract widened saved views (`viewKind`/`targetKind`/`targetId`) while the
 * older `kind` field is still in flight.
 */

export interface CrmSidebarList {
  id: string;
  name: string;
  parentObjectType?: string;
}

export interface CrmSidebarSavedView {
  id: string;
  name: string;
  viewKind: "table" | "board";
  targetKind: "object" | "list";
  targetId?: string;
  pinned: boolean;
}

const OBJECT_ROUTES: Record<string, string> = {
  account: "/accounts",
  accounts: "/accounts",
  person: "/people",
  people: "/people",
  contact: "/people",
  opportunity: "/opportunities",
  opportunities: "/opportunities",
  deal: "/opportunities",
};

function rowsOf(payload: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function normalizeCrmLists(payload: unknown): CrmSidebarList[] {
  return rowsOf(payload, "lists", "items", "rows").flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = text(record.id);
    const name = text(record.name);
    if (!id || !name) return [];
    if (record.archived === true) return [];
    return [
      {
        id,
        name,
        ...(text(record.parentObjectType)
          ? { parentObjectType: text(record.parentObjectType) as string }
          : {}),
      },
    ];
  });
}

export function normalizeCrmSavedViews(
  payload: unknown,
): CrmSidebarSavedView[] {
  return rowsOf(payload, "views", "savedViews", "items", "rows").flatMap(
    (row) => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const id = text(record.id);
      const name = text(record.name);
      if (!id || !name) return [];

      const targetKind = record.targetKind === "list" ? "list" : "object";
      const targetId =
        text(record.targetId) ??
        (targetKind === "object" ? text(record.kind) : undefined);

      return [
        {
          id,
          name,
          viewKind: record.viewKind === "board" ? "board" : "table",
          targetKind,
          ...(targetId ? { targetId } : {}),
          pinned: record.pinned === true,
        } satisfies CrmSidebarSavedView,
      ];
    },
  );
}

export function savedViewHref(view: CrmSidebarSavedView): string {
  const query = `?view=${encodeURIComponent(view.id)}`;
  if (view.targetKind === "list" && view.targetId) {
    return `/lists/${encodeURIComponent(view.targetId)}${query}`;
  }
  const objectRoute = view.targetId
    ? OBJECT_ROUTES[view.targetId.toLowerCase()]
    : undefined;
  return `${objectRoute ?? "/views"}${query}`;
}
