import { useCallback, useEffect, useMemo, useState } from "react";

import type { TableColumnConfig } from "@/pages/adhoc/sql-dashboard/types";

const STORAGE_PREFIX = "analytics-column-widths:v1:";

/**
 * A width someone dragged while viewing a dashboard, kept in their browser.
 * `base` is the dashboard's own width for the column at the time (null when it
 * had none): once the dashboard's width changes, the personal one is dropped,
 * so a later edit for everyone is never hidden behind an old personal drag.
 */
export interface PersonalColumnWidth {
  width: number;
  base: number | null;
}

export type PersonalColumnWidths = Record<string, PersonalColumnWidth>;

export function personalColumnWidthsKey(
  dashboardId: string,
  panelId: string,
): string {
  return `${STORAGE_PREFIX}${dashboardId}:${panelId}`;
}

function isPersonalColumnWidth(value: unknown): value is PersonalColumnWidth {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.width === "number" &&
    Number.isFinite(entry.width) &&
    entry.width > 0 &&
    (entry.base === null ||
      (typeof entry.base === "number" && Number.isFinite(entry.base)))
  );
}

/** Parses a stored value, keeping only well-formed entries. */
export function parsePersonalColumnWidths(
  raw: string | null,
): PersonalColumnWidths {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // coercion-ok: a corrupt entry means no personal widths; the dashboard's own widths apply.
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const widths: PersonalColumnWidths = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isPersonalColumnWidth(value)) widths[key] = value;
  }
  return widths;
}

/**
 * The personal widths that still apply: each one only while the dashboard's
 * width for that column is the one it was dragged from.
 */
export function activePersonalColumnWidths(
  stored: PersonalColumnWidths,
  columns: TableColumnConfig[] | undefined,
): Record<string, number> {
  const sharedWidth = new Map(
    (columns ?? []).map((column) => [column.key, column.width ?? null]),
  );
  const active: Record<string, number> = {};
  for (const [key, entry] of Object.entries(stored)) {
    if ((sharedWidth.get(key) ?? null) === entry.base) {
      active[key] = entry.width;
    }
  }
  return active;
}

function readStoredWidths(key: string | null): PersonalColumnWidths {
  if (!key || typeof window === "undefined") return {};
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // coercion-ok: storage blocked by the browser; widths then last for this visit only.
    return {};
  }
  return parsePersonalColumnWidths(raw);
}

function writeStoredWidths(key: string, widths: PersonalColumnWidths): void {
  try {
    if (Object.keys(widths).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // coercion-ok: storage blocked or full; the width still applies until the page reloads.
  }
}

/**
 * Column widths one person dragged on one dashboard table. They live in this
 * browser only and never change the dashboard for anyone else.
 */
export function usePersonalColumnWidths(
  dashboardId: string | undefined,
  panelId: string,
  columns: TableColumnConfig[] | undefined,
): {
  widths: Record<string, number>;
  setWidth: (columnKey: string, width: number | null) => void;
} {
  const key = dashboardId
    ? personalColumnWidthsKey(dashboardId, panelId)
    : null;
  const [stored, setStored] = useState<PersonalColumnWidths>(() =>
    readStoredWidths(key),
  );
  useEffect(() => {
    setStored(readStoredWidths(key));
  }, [key]);

  const setWidth = useCallback(
    (columnKey: string, width: number | null) => {
      if (!key) return;
      const base =
        columns?.find((column) => column.key === columnKey)?.width ?? null;
      setStored((current) => {
        const next = { ...current };
        if (width === null) delete next[columnKey];
        else next[columnKey] = { width, base };
        writeStoredWidths(key, next);
        return next;
      });
    },
    [columns, key],
  );

  const widths = useMemo(
    () => activePersonalColumnWidths(stored, columns),
    [stored, columns],
  );
  return { widths, setWidth };
}
