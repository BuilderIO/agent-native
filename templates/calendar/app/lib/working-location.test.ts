import type { CalendarEvent } from "@shared/api";
import { describe, expect, it } from "vitest";

import { dateKeyToDate } from "./calendar-timezone";
import {
  buildWorkingLocationProperties,
  buildWorkingLocationUpdate,
  createWorkingLocationDisplayLabels,
  findOwnedWorkingLocationForDay,
  getWorkingLocationChipLabel,
  getWorkingLocationDetail,
  getWorkingLocationEditableLabel,
  getWorkingLocationTitle,
  isWorkingLocationDraftReadyToCreate,
} from "./working-location";

const translatedLabels = createWorkingLocationDisplayLabels((key, values) => {
  const translations: Record<string, string> = {
    "eventForm.home": "Casa",
    "eventForm.office": "Oficina",
    "eventForm.workingLocation": "Lugar de trabajo",
    "eventForm.workingLocationTitle": "Lugar de trabajo: {{location}}",
    "eventForm.workingLocationFloor": "Piso {{floor}}",
    "eventForm.workingLocationDesk": "Escritorio {{desk}}",
  };
  return Object.entries(values ?? {}).reduce(
    (value, [name, replacement]) => value.replace(`{{${name}}}`, replacement),
    translations[key] ?? key,
  );
});

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

    expect(getWorkingLocationChipLabel(workingLocation, translatedLabels)).toBe(
      "Casa",
    );
    expect(getWorkingLocationTitle(workingLocation, translatedLabels)).toBe(
      "Lugar de trabajo: Casa",
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

    expect(getWorkingLocationChipLabel(workingLocation, translatedLabels)).toBe(
      "Pier 57",
    );
    expect(getWorkingLocationDetail(workingLocation, translatedLabels)).toBe(
      "nyc / Piso 6 / Escritorio D14",
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

    expect(getWorkingLocationChipLabel(workingLocation, translatedLabels)).toBe(
      "nyc",
    );
  });

  it("uses translated fallbacks instead of hardcoded generic labels", () => {
    const office = event({
      title: "",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "officeLocation",
        officeLocation: {},
      },
    });
    const custom = event({
      title: "",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "customLocation",
        customLocation: {},
      },
    });

    expect(getWorkingLocationChipLabel(office, translatedLabels)).toBe(
      "Oficina",
    );
    expect(getWorkingLocationChipLabel(custom, translatedLabels)).toBe(
      "Lugar de trabajo",
    );
  });

  it("does not let a generated summary hide an unlabeled office", () => {
    const office = event({
      title: "Working location",
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "officeLocation",
        officeLocation: {},
      },
    });

    expect(getWorkingLocationChipLabel(office, translatedLabels)).toBe(
      "Oficina",
    );
  });

  it("uses native labels as editable values without summary fallbacks", () => {
    expect(
      getWorkingLocationEditableLabel({
        location: "",
        workingLocationProperties: { type: "homeOffice", homeOffice: {} },
      }),
    ).toBe("");
    expect(
      getWorkingLocationEditableLabel({
        location: "Legacy label",
        workingLocationProperties: {
          type: "officeLocation",
          officeLocation: { label: "Pier 57" },
        },
      }),
    ).toBe("Pier 57");
    expect(
      getWorkingLocationEditableLabel({
        location: "",
        workingLocationProperties: {
          type: "officeLocation",
          officeLocation: { buildingId: "nyc" },
        },
      }),
    ).toBe("");
  });

  it("does not synthesize a generic office placeholder for updates", () => {
    expect(
      buildWorkingLocationUpdate(
        {
          id: "google-instance-20260707",
          accountEmail: "owner@example.com",
        },
        { type: "officeLocation", label: "", scope: "single" },
      ),
    ).toMatchObject({
      workingLocationType: "officeLocation",
      workingLocationLabel: "",
    });
  });

  it("targets the instance id and omits Google's forbidden generic location", () => {
    expect(
      buildWorkingLocationUpdate(
        {
          id: "google-instance-20260707",
          accountEmail: "owner@example.com",
        },
        { type: "homeOffice", label: "Old custom label", scope: "single" },
      ),
    ).toEqual({
      id: "google-instance-20260707",
      accountEmail: "owner@example.com",
      workingLocationType: "homeOffice",
      workingLocationLabel: "",
      scope: "single",
    });
  });

  it("preserves office metadata only while the location remains an office", () => {
    const office = {
      workingLocationProperties: {
        type: "officeLocation" as const,
        officeLocation: { buildingId: "nyc", deskId: "D14" },
      },
    };

    expect(
      buildWorkingLocationProperties(office, {
        type: "officeLocation",
        label: "Pier 57",
      }),
    ).toEqual({
      type: "officeLocation",
      officeLocation: {
        buildingId: "nyc",
        deskId: "D14",
        label: "Pier 57",
      },
    });
    expect(
      buildWorkingLocationProperties(office, {
        type: "customLocation",
        label: "Neighborhood cafe",
      }),
    ).toEqual({
      type: "customLocation",
      customLocation: { label: "Neighborhood cafe" },
    });
  });
});

describe("working location create readiness", () => {
  it("allows unlabeled office drafts and requires a name for Other", () => {
    expect(
      isWorkingLocationDraftReadyToCreate(
        event({
          eventType: "workingLocation",
          workingLocationProperties: {
            type: "officeLocation",
            officeLocation: {},
          },
        }),
      ),
    ).toBe(true);
    expect(
      isWorkingLocationDraftReadyToCreate(
        event({
          eventType: "workingLocation",
          workingLocationProperties: {
            type: "customLocation",
            customLocation: {},
          },
        }),
      ),
    ).toBe(false);
    expect(
      isWorkingLocationDraftReadyToCreate(
        event({
          eventType: "workingLocation",
          workingLocationProperties: {
            type: "customLocation",
            customLocation: { label: "Cafe" },
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("findOwnedWorkingLocationForDay", () => {
  it("returns the owned Google location on that day, not overlays or adjacent days", () => {
    const home = event({
      id: "home-thu",
      start: "2026-08-13",
      end: "2026-08-14",
      eventType: "workingLocation",
      workingLocationProperties: { type: "homeOffice", homeOffice: {} },
      accountEmail: "owner@example.com",
    });
    const overlay = event({
      id: "overlay-thu",
      start: "2026-08-13",
      end: "2026-08-14",
      eventType: "workingLocation",
      overlayEmail: "teammate@example.com",
      workingLocationProperties: { type: "homeOffice", homeOffice: {} },
    });
    const friday = event({
      id: "home-fri",
      start: "2026-08-14",
      end: "2026-08-15",
      eventType: "workingLocation",
      workingLocationProperties: { type: "homeOffice", homeOffice: {} },
      accountEmail: "owner@example.com",
    });

    expect(
      findOwnedWorkingLocationForDay(
        [overlay, friday, home],
        dateKeyToDate("2026-08-13"),
        "America/Chicago",
        "owner@example.com",
      )?.id,
    ).toBe("home-thu");
    expect(
      findOwnedWorkingLocationForDay(
        [overlay, friday, home],
        dateKeyToDate("2026-08-15"),
        "America/Chicago",
        "owner@example.com",
      ),
    ).toBeUndefined();
  });

  it("prefers a Google event over a local draft on the same day", () => {
    const draft = event({
      id: "calendar-draft-event:slot-working-location-1",
      source: "local",
      start: "2026-08-13",
      end: "2026-08-14",
      eventType: "workingLocation",
      workingLocationProperties: { type: "homeOffice", homeOffice: {} },
      accountEmail: "owner@example.com",
    });
    const google = event({
      id: "google-home",
      start: "2026-08-13",
      end: "2026-08-14",
      eventType: "workingLocation",
      workingLocationProperties: { type: "homeOffice", homeOffice: {} },
      accountEmail: "owner@example.com",
    });

    expect(
      findOwnedWorkingLocationForDay(
        [draft, google],
        dateKeyToDate("2026-08-13"),
        "America/Chicago",
        "owner@example.com",
      )?.id,
    ).toBe("google-home");
  });
});
