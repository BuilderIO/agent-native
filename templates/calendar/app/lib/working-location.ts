import type { CalendarEvent } from "@shared/api";

export type WorkingLocationKind =
  | "homeOffice"
  | "officeLocation"
  | "customLocation";

export function isWorkingLocationEvent(
  event: Pick<CalendarEvent, "eventType">,
) {
  return event.eventType === "workingLocation";
}

export function getWorkingLocationType(
  event: Pick<CalendarEvent, "workingLocationProperties">,
): WorkingLocationKind {
  return event.workingLocationProperties?.type ?? "customLocation";
}

export function getWorkingLocationLabel(
  event: Pick<
    CalendarEvent,
    "location" | "title" | "workingLocationProperties"
  >,
): string {
  const properties = event.workingLocationProperties;
  if (properties?.type === "homeOffice") return "Home";
  if (properties?.type === "officeLocation") {
    return (
      properties.officeLocation?.label ||
      properties.officeLocation?.buildingId ||
      event.location ||
      event.title ||
      "Office"
    );
  }
  return (
    properties?.customLocation?.label ||
    event.location ||
    event.title ||
    "Working location"
  );
}

export function getWorkingLocationChipLabel(event: CalendarEvent): string {
  return isWorkingLocationEvent(event)
    ? getWorkingLocationLabel(event)
    : event.title;
}

export function getWorkingLocationTitle(event: CalendarEvent): string {
  return isWorkingLocationEvent(event)
    ? `Working location: ${getWorkingLocationLabel(event)}`
    : event.title;
}

export function getWorkingLocationDetail(
  event: Pick<CalendarEvent, "workingLocationProperties">,
): string | undefined {
  const office = event.workingLocationProperties?.officeLocation;
  if (!office) return undefined;
  const parts = [
    office.buildingId,
    office.floorId ? `Floor ${office.floorId}` : undefined,
    office.floorSectionId,
    office.deskId ? `Desk ${office.deskId}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}
