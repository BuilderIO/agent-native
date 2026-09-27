import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calendarSlotDraftId,
  createCalendarSlotDraft,
  createOrLoadCalendarSlotDraft,
  parseCalendarSlotPrefill,
} from "./calendar-slot-prefill";

const VALID_PARAMS = new URLSearchParams({
  createSlot: "1",
  start: "2026-04-23T17:30:00.000Z",
  end: "2026-04-23T18:15:00.000Z",
  timezone: "America/Los_Angeles",
});

afterEach(() => vi.unstubAllGlobals());

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

  it("uses timezone as part of the persisted draft identity", () => {
    const prefill = parseCalendarSlotPrefill(VALID_PARAMS)!;
    const otherTimezone = { ...prefill, timezone: "America/New_York" };

    expect(calendarSlotDraftId(prefill)).not.toBe(
      calendarSlotDraftId(otherTimezone),
    );
    expect(calendarSlotDraftId(prefill)).toMatch(/^[a-zA-Z0-9_-]{1,96}$/);
  });

  it("reuses an existing edited draft for the same slot", async () => {
    const prefill = parseCalendarSlotPrefill(VALID_PARAMS)!;
    const id = calendarSlotDraftId(prefill);
    const savedDraft = {
      ...createCalendarSlotDraft(prefill, id, "created"),
      title: "Product review",
      description: "Keep these edits",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ changed: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(savedDraft), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createOrLoadCalendarSlotDraft(prefill, savedDraft.id),
    ).resolves.toEqual(savedDraft);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined();
  });

  it("creates a draft only when the slot has no saved draft", async () => {
    const prefill = parseCalendarSlotPrefill(VALID_PARAMS)!;
    const id = calendarSlotDraftId(prefill);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ changed: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createOrLoadCalendarSlotDraft(prefill, id),
    ).resolves.toMatchObject({
      id,
      title: "",
      start: "2026-04-23T17:30:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({ expected: null, next: { id } });
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
