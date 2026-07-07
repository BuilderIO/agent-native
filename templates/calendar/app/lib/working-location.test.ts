import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  getWorkingLocationChipLabel,
  getWorkingLocationDetail,
  getWorkingLocationTitle,
} from "./working-location";

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event-1",
    title: "Home",
    description: "",
    start: "2026-07-06",
    end: "2026-07-07",
    location: "",
    allDay: true,
    source: "google",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("working location display helpers", () => {
  it("labels Google home working-location events with native context", () => {
    const workingLocation = event({
      eventType: "workingLocation",
      workingLocationProperties: { type: "homeOffice", homeOffice: {} },
    });

    expect(getWorkingLocationChipLabel(workingLocation)).toBe("Home");
    expect(getWorkingLocationTitle(workingLocation)).toBe(
      "Working location: Home",
    );
  });

  it("prefers office metadata over the generic event title", () => {
    const workingLocation = event({
      title: "Office",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "officeLocation",
        officeLocation: {
          label: "Pier 57",
          buildingId: "nyc",
          floorId: "6",
          deskId: "D14",
        },
      },
    });

    expect(getWorkingLocationChipLabel(workingLocation)).toBe("Pier 57");
    expect(getWorkingLocationDetail(workingLocation)).toBe(
      "nyc / Floor 6 / Desk D14",
    );
  });

  it("falls back to office building id when Google omits an office label", () => {
    const workingLocation = event({
      title: "Office",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "officeLocation",
        officeLocation: {
          buildingId: "nyc",
        },
      },
    });

    expect(getWorkingLocationChipLabel(workingLocation)).toBe("nyc");
  });
});
