// Calendar and timeline date utilities: month days, spans, range labels, date keys.
// Pure logic — no React, no icons.
import type {
  ContentDatabaseItem,
  ContentDatabaseView,
  ContentDatabaseViewType,
  DocumentProperty,
  DocumentPropertyValue,
} from "@shared/api";
import {
  documentPropertyDateKey,
  documentPropertyDatePart,
} from "@shared/properties";

import { databaseCalendarDateProperty } from "./grouping";
import { type DatabaseDateViewRange, type DatabaseTimelineSpan } from "./types";

export { type DatabaseDateViewRange, type DatabaseTimelineSpan };

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function calendarDateKey(value: Date): string;
export function calendarDateKey(value: DocumentPropertyValue): string | null;
export function calendarDateKey(value: Date | DocumentPropertyValue) {
  if (value instanceof Date) return formatCalendarDateKey(value);
  const dateKey = documentPropertyDateKey(value);
  if (dateKey) return dateKey;
  if (value === null || value === undefined || value === "") return null;

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return formatCalendarDateKey(date);
}

function calendarDateEndKey(value: DocumentPropertyValue) {
  return documentPropertyDateKey(value, "end");
}

function formatCalendarDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function databaseCalendarMonthDays(anchorDate: Date) {
  const first = startOfMonth(anchorDate);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function databaseTimelineDays(anchorDate: Date) {
  return databaseCalendarMonthDays(anchorDate);
}

export function databaseTimelineEndDateProperty(
  view: Pick<ContentDatabaseView, "endDatePropertyId">,
  properties: DocumentProperty[],
  startPropertyId?: string | null,
) {
  if (!view.endDatePropertyId) return null;
  return (
    databaseCalendarDateProperties(properties).find(
      (property) =>
        property.definition.id === view.endDatePropertyId &&
        property.definition.id !== startPropertyId,
    ) ?? null
  );
}

// Re-exported for convenience
import { databaseCalendarDateProperties } from "./grouping";
export { databaseCalendarDateProperties };

export function databaseTimelineItemSpans(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  startPropertyId: string | null | undefined,
  endPropertyId: string | null | undefined,
  days: Date[],
): DatabaseTimelineSpan[] {
  const visibleKeys = days.map((day) => calendarDateKey(day));
  const firstKey = visibleKeys[0];
  const lastKey = visibleKeys[visibleKeys.length - 1];
  if (!startPropertyId || !firstKey || !lastKey) return [];

  return items
    .map((item) => {
      const startProperty = databaseItemPropertyById(
        item,
        properties,
        startPropertyId,
      );
      const startKey = calendarDateKey(startProperty?.value ?? null);
      if (!startKey) return null;

      const rangeEndKey = calendarDateEndKey(startProperty?.value ?? null);
      const rawEndKey = rangeEndKey
        ? rangeEndKey
        : endPropertyId
          ? calendarDateKey(
              databaseItemPropertyById(item, properties, endPropertyId)
                ?.value ?? null,
            )
          : null;
      const endKey = rawEndKey && rawEndKey >= startKey ? rawEndKey : startKey;
      if (endKey < firstKey || startKey > lastKey) return null;

      const clippedStartKey = startKey < firstKey ? firstKey : startKey;
      const clippedEndKey = endKey > lastKey ? lastKey : endKey;
      const startIndex = visibleKeys.indexOf(clippedStartKey);
      const endIndex = visibleKeys.indexOf(clippedEndKey);
      if (startIndex < 0 || endIndex < 0) return null;

      return {
        item,
        startKey,
        endKey,
        label: startKey === endKey ? startKey : `${startKey} - ${endKey}`,
        startIndex,
        endIndex,
      };
    })
    .filter((span): span is DatabaseTimelineSpan => !!span);
}

export function databaseItemPropertyById(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  propertyId: string,
) {
  return (
    item.properties.find(
      (candidate) => candidate.definition.id === propertyId,
    ) ??
    properties.find((candidate) => candidate.definition.id === propertyId) ??
    null
  );
}

export function databaseTimelineRangeLabel(days: Date[]) {
  const first = days[0] ?? new Date();
  const last = days[days.length - 1] ?? first;
  const sameYear = first.getFullYear() === last.getFullYear();
  const firstLabel = first.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const lastLabel = last.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${firstLabel} - ${lastLabel}`;
}

export function databaseDateViewRange(
  viewType: ContentDatabaseViewType,
  anchorDate: Date,
): DatabaseDateViewRange | null {
  if (viewType !== "calendar" && viewType !== "timeline") return null;

  const month = startOfMonth(anchorDate);
  const days =
    viewType === "timeline"
      ? databaseTimelineDays(month)
      : databaseCalendarMonthDays(month);
  const first = days[0] ?? month;
  const last = days[days.length - 1] ?? first;
  return {
    start: calendarDateKey(first),
    end: calendarDateKey(last),
    label:
      viewType === "timeline"
        ? databaseTimelineRangeLabel(days)
        : month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          }),
  };
}

export function databaseScreenVisibleItems(
  view: Pick<
    ContentDatabaseView,
    "type" | "datePropertyId" | "endDatePropertyId"
  >,
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  dateRange: DatabaseDateViewRange | null,
) {
  if (view.type !== "calendar" && view.type !== "timeline") return items;
  const dateProperty = databaseCalendarDateProperty(view, properties);
  if (!dateProperty || !dateRange) return [];
  const datePropertyId = dateProperty.definition.id;

  return items.filter((item) => {
    const startProperty = databaseItemPropertyById(
      item,
      properties,
      datePropertyId,
    );
    const startKey = calendarDateKey(startProperty?.value ?? null);
    if (!startKey) return true;

    if (view.type === "calendar") {
      const rangeEndKey = calendarDateEndKey(startProperty?.value ?? null);
      const endKey =
        rangeEndKey && rangeEndKey >= startKey ? rangeEndKey : startKey;
      return endKey >= dateRange.start && startKey <= dateRange.end;
    }

    const rangeEndKey = calendarDateEndKey(startProperty?.value ?? null);
    const rawEndKey = rangeEndKey
      ? rangeEndKey
      : view.endDatePropertyId
        ? calendarDateKey(
            databaseItemPropertyById(item, properties, view.endDatePropertyId)
              ?.value ?? null,
          )
        : null;
    const endKey = rawEndKey && rawEndKey >= startKey ? rawEndKey : startKey;
    return endKey >= dateRange.start && startKey <= dateRange.end;
  });
}

export function databaseCalendarItemsByDate(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  datePropertyId?: string | null,
) {
  const grouped = new Map<string, ContentDatabaseItem[]>();
  if (!datePropertyId) return grouped;

  for (const item of items) {
    const property =
      item.properties.find(
        (candidate) => candidate.definition.id === datePropertyId,
      ) ??
      properties.find(
        (candidate) => candidate.definition.id === datePropertyId,
      );
    if (!property?.value) continue;
    const key = calendarDateKey(property.value);
    if (!key) continue;
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }

  return grouped;
}

export function databaseItemsWithoutDateValue(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  datePropertyId?: string | null,
) {
  if (!datePropertyId) return [];

  return items.filter((item) => {
    const property = databaseItemPropertyById(item, properties, datePropertyId);
    return !calendarDateKey(property?.value ?? null);
  });
}

export function propertyDateValue(
  property: DocumentProperty | null | undefined,
) {
  if (!property || !property.value) return Number.NaN;
  const value = new Date(
    documentPropertyDatePart(property.value, "start") || String(property.value),
  ).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}
