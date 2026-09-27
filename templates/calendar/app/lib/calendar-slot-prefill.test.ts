import { describe, expect, it } from "vitest";

import {
  createCalendarSlotDraft,
  parseCalendarSlotPrefill,
} from "./calendar-slot-prefill";

const VALID_PARAMS = new URLSearchParams({
  createSlot: "1",
  start: "2026-04-23T17:30:00.000Z",
  end: "2026-04-23T18:15:00.000Z",
  timezone: "America/Los_Angeles",
});

describe("calendar slot prefill", () => {
  it("validates a deep-link slot and creates an attendee-free event draft", () => {
    const prefill = parseCalendarSlotPrefill(VALID_PARAMS);
    expect(prefill).toEqual({
      start: "2026-04-23T17:30:00.000Z",
      end: "2026-04-23T18:15:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(
      createCalendarSlotDraft(prefill!, "slot-1776965400000", "now"),
    ).toEqual({
      id: "slot-1776965400000",
      title: "",
      description: "",
      location: "",
      start: "2026-04-23T17:30:00.000Z",
      end: "2026-04-23T18:15:00.000Z",
      startTimeZone: "America/Los_Angeles",
      endTimeZone: "America/Los_Angeles",
      allDay: false,
      eventType: "default",
      createdAt: "now",
      updatedAt: "now",
    });
  });

  it.each([
    [
      "missing marker",
      new URLSearchParams(VALID_PARAMS.toString().replace("createSlot=1&", "")),
    ],
    [
      "duplicate start",
      new URLSearchParams(
        `${VALID_PARAMS.toString()}&start=2026-04-23T17%3A30%3A00.000Z`,
      ),
    ],
    [
      "reversed interval",
      new URLSearchParams({
        ...Object.fromEntries(VALID_PARAMS),
        start: "2026-04-23T18:15:00.000Z",
      }),
    ],
    [
      "invalid timezone",
      new URLSearchParams({
        ...Object.fromEntries(VALID_PARAMS),
        timezone: "Not/A_Timezone",
      }),
    ],
  ])("rejects %s query input", (_name, params) => {
    expect(parseCalendarSlotPrefill(params)).toBeNull();
  });
});
