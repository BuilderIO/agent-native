import type { CalendarEvent, UpdateEventScope } from "@shared/api";

export type WorkingLocationKind =
  | "homeOffice"
  | "officeLocation"
  | "customLocation";

export interface WorkingLocationSelection {
  type: WorkingLocationKind;
  label: string;
  scope?: UpdateEventScope;
}

export interface WorkingLocationDisplayLabels {
  home: string;
  office: string;
  workingLocation: string;
  title: (location: string) => string;
  floor: (floor: string) => string;
  desk: (desk: string) => string;
}

type WorkingLocationTranslate = (
  key: string,
  values?: Record<string, string>,
) => string;

export function createWorkingLocationDisplayLabels(
  t: WorkingLocationTranslate,
): WorkingLocationDisplayLabels {
  return {
    home: t("eventForm.home"),
    office: t("eventForm.office"),
    workingLocation: t("eventForm.workingLocation"),
    title: (location) => t("eventForm.workingLocationTitle", { location }),
    floor: (floor) => t("eventForm.workingLocationFloor", { floor }),
    desk: (desk) => t("eventForm.workingLocationDesk", { desk }),
  };
}

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
  labels: WorkingLocationDisplayLabels,
): string {
  const properties = event.workingLocationProperties;
  if (properties?.type === "homeOffice") return labels.home;
  if (properties?.type === "officeLocation") {
    return (
      properties.officeLocation?.label ||
      properties.officeLocation?.buildingId ||
      event.location ||
      event.title ||
      labels.office
    );
  }
  return (
    properties?.customLocation?.label ||
    event.location ||
    event.title ||
    labels.workingLocation
  );
}

export function getWorkingLocationEditableLabel(
  event: Pick<CalendarEvent, "location" | "workingLocationProperties">,
): string {
  const properties = event.workingLocationProperties;
  if (properties?.type === "officeLocation") {
    return properties.officeLocation?.label || event.location || "";
  }
  if (properties?.type === "customLocation") {
    return properties.customLocation?.label || event.location || "";
  }
  return "";
}

export function buildWorkingLocationUpdate(
  event: Pick<CalendarEvent, "id" | "accountEmail">,
  selection: WorkingLocationSelection,
) {
  const label = selection.type === "homeOffice" ? "" : selection.label.trim();

  return {
    id: event.id,
    accountEmail: event.accountEmail,
    workingLocationType: selection.type,
    workingLocationLabel: label,
    scope: selection.scope,
  };
}

export function buildWorkingLocationProperties(
  event: Pick<CalendarEvent, "workingLocationProperties">,
  selection: Pick<WorkingLocationSelection, "type" | "label">,
): NonNullable<CalendarEvent["workingLocationProperties"]> {
  const label = selection.label.trim();
  if (selection.type === "homeOffice") {
    return { type: "homeOffice", homeOffice: {} };
  }
  if (selection.type === "officeLocation") {
    return {
      type: "officeLocation",
      officeLocation: {
        ...(event.workingLocationProperties?.type === "officeLocation"
          ? event.workingLocationProperties.officeLocation
          : {}),
        label,
      },
    };
  }
  return {
    type: "customLocation",
    customLocation: { label },
  };
}

export function getWorkingLocationChipLabel(
  event: CalendarEvent,
  labels: WorkingLocationDisplayLabels,
): string {
  return isWorkingLocationEvent(event)
    ? getWorkingLocationLabel(event, labels)
    : event.title;
}

export function getWorkingLocationTitle(
  event: CalendarEvent,
  labels: WorkingLocationDisplayLabels,
): string {
  return isWorkingLocationEvent(event)
    ? labels.title(getWorkingLocationLabel(event, labels))
    : event.title;
}

export function getWorkingLocationDetail(
  event: Pick<CalendarEvent, "workingLocationProperties">,
  labels: WorkingLocationDisplayLabels,
): string | undefined {
  const office = event.workingLocationProperties?.officeLocation;
  if (!office) return undefined;
  const parts = [
    office.buildingId,
    office.floorId ? labels.floor(office.floorId) : undefined,
    office.floorSectionId,
    office.deskId ? labels.desk(office.deskId) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}
