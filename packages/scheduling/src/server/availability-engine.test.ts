import { isActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../schema/index.js";
import type { BusyInterval, EventType, Schedule } from "../shared/index.js";
import {
  aggregateBusy,
  assertSlotAvailable,
  CalendarAvailabilityUnavailableError,
  getAvailableSlots,
} from "./availability-engine.js";
import { setSchedulingContext } from "./context.js";
import {
  CalendarCredentialInvalidError,
  CalendarLookupRateLimitedError,
} from "./providers/errors.js";
import { registerCalendarProvider } from "./providers/registry.js";
import type { CalendarProvider } from "./providers/types.js";

const RANGE_START = new Date("2026-07-10T09:00:00.000Z");
const RANGE_END = new Date("2026-07-10T17:00:00.000Z");
const TEST_USER_EMAIL = "availability-test@example.com";

const WORKDAY_SCHEDULE: Schedule = {
  id: "schedule-workday",
  name: "Working hours",
  timezone: "UTC",
  ownerEmail: TEST_USER_EMAIL,
  weeklyAvailability: [1, 2, 3, 4, 5].map((day) => ({
    day,
    intervals: [{ startTime: "09:00", endTime: "17:00" }],
  })),
  dateOverrides: [],
  isDefault: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("./schedules-repo.js", () => ({
  getScheduleById: vi.fn(async () => WORKDAY_SCHEDULE),
}));

interface CredentialRow {
  id: string;
  type: string;
  invalid?: boolean;
}

interface SelectedCalendarRow {
  credentialId: string;
  externalId: string;
}

interface FakeDbInput {
  bookings?: Array<{
    startTime: string;
    endTime: string;
    uid: string;
  }>;
  credentials?: CredentialRow[];
  selected?: SelectedCalendarRow[];
  legacySelectedBatches?: SelectedCalendarRow[][];
}

function createFakeDb(input: FakeDbInput) {
  const reads = {
    bookings: 0,
    credentials: 0,
    selectedCalendars: 0,
  };

  const db = {
    select(projection?: unknown) {
      return {
        from(table: unknown) {
          return {
            async where() {
              if (table === schema.bookings) {
                reads.bookings += 1;
                return input.bookings ?? [];
              }
              if (table === schema.schedulingCredentials) {
                reads.credentials += 1;
                return input.credentials ?? [];
              }
              if (table === schema.selectedCalendars) {
                reads.selectedCalendars += 1;
                if (projection) return input.selected ?? [];
                return (
                  input.legacySelectedBatches?.[reads.selectedCalendars - 1] ??
                  input.selected ??
                  []
                );
              }
              throw new Error("Unexpected table in availability test");
            },
          };
        },
      };
    },
  };

  setSchedulingContext({
    getDb: () => db,
    schema,
    getCurrentUserEmail: () => TEST_USER_EMAIL,
  });

  return { reads };
}

function createCalendarProvider(
  kind: string,
  getBusy: CalendarProvider["getBusy"],
): CalendarProvider {
  return {
    kind,
    label: `Test provider ${kind}`,
    startOAuth: vi.fn(async () => ({ authUrl: "https://example.test/oauth" })),
    completeOAuth: vi.fn(async () => ({
      externalEmail: "provider-test@example.com",
      calendars: [],
    })),
    listCalendars: vi.fn(async () => []),
    getBusy,
    createEvent: vi.fn(async () => ({ externalId: "event-example" })),
    updateEvent: vi.fn(async () => ({ iCalSequence: 1 })),
    deleteEvent: vi.fn(async () => {}),
  };
}

function interval(source: string, hour: number): BusyInterval {
  return {
    start: `2026-07-10T${String(hour).padStart(2, "0")}:00:00.000Z`,
    end: `2026-07-10T${String(hour + 1).padStart(2, "0")}:00:00.000Z`,
    source,
  };
}

async function readBusy(): Promise<BusyInterval[]> {
  return aggregateBusy({
    userEmail: TEST_USER_EMAIL,
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END,
  });
}

describe("aggregateBusy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("groups selected calendars and preserves local and provider busy intervals", async () => {
    const credentials = [
      { id: "credential-a", type: "availability-group-a" },
      { id: "credential-b", type: "availability-group-b" },
    ];
    const selected = [
      { credentialId: "credential-a", externalId: "calendar-a-1" },
      { credentialId: "credential-a", externalId: "calendar-a-2" },
      { credentialId: "credential-b", externalId: "calendar-b-1" },
    ];
    createFakeDb({
      bookings: [
        {
          startTime: "2026-07-10T10:00:00.000Z",
          endTime: "2026-07-10T11:00:00.000Z",
          uid: "booking-example",
        },
      ],
      credentials,
      selected,
      legacySelectedBatches: [selected.slice(0, 2), selected.slice(2)],
    });

    const getBusyA = vi.fn(async () => [interval("provider-a", 12)]);
    const getBusyB = vi.fn(async () => [interval("provider-b", 14)]);
    registerCalendarProvider(
      createCalendarProvider("availability-group-a", getBusyA),
    );
    registerCalendarProvider(
      createCalendarProvider("availability-group-b", getBusyB),
    );

    const busy = await readBusy();

    expect(busy.map((entry) => entry.source)).toEqual([
      "booking:booking-example",
      "provider-a",
      "provider-b",
    ]);
    expect(getBusyA).toHaveBeenCalledWith({
      credentialId: "credential-a",
      calendarExternalIds: ["calendar-a-1", "calendar-a-2"],
      start: RANGE_START,
      end: RANGE_END,
    });
    expect(getBusyB).toHaveBeenCalledWith({
      credentialId: "credential-b",
      calendarExternalIds: ["calendar-b-1"],
      start: RANGE_START,
      end: RANGE_END,
    });
  });

  it("reads bookings, credentials, and selected calendars once each", async () => {
    const credentials = [
      { id: "credential-query-a", type: "availability-query-a" },
      { id: "credential-query-b", type: "availability-query-b" },
    ];
    const selected = [
      { credentialId: "credential-query-a", externalId: "calendar-query-a" },
      { credentialId: "credential-query-b", externalId: "calendar-query-b" },
    ];
    const { reads } = createFakeDb({
      credentials,
      selected,
      legacySelectedBatches: [[selected[0]], [selected[1]]],
    });
    registerCalendarProvider(
      createCalendarProvider(
        "availability-query-a",
        vi.fn(async () => []),
      ),
    );
    registerCalendarProvider(
      createCalendarProvider(
        "availability-query-b",
        vi.fn(async () => []),
      ),
    );

    await readBusy();

    expect(reads).toEqual({
      bookings: 1,
      credentials: 1,
      selectedCalendars: 1,
    });
  });

  it("runs provider reads concurrently with a maximum of four in flight", async () => {
    const credentials = Array.from({ length: 6 }, (_, index) => ({
      id: `credential-concurrency-${index}`,
      type: `availability-concurrency-${index}`,
    }));
    const selected = credentials.map((credential, index) => ({
      credentialId: credential.id,
      externalId: `calendar-concurrency-${index}`,
    }));
    createFakeDb({
      credentials,
      selected,
      legacySelectedBatches: selected.map((row) => [row]),
    });

    let active = 0;
    let maximumActive = 0;
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    for (const credential of credentials) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      gates.set(credential.id, release);
      registerCalendarProvider(
        createCalendarProvider(credential.type, async ({ credentialId }) => {
          started.push(credentialId);
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await gate;
          active -= 1;
          const index = Number(credentialId.split("-").at(-1));
          return [interval(`provider-concurrency-${index}`, 10 + index)];
        }),
      );
    }

    const busyPromise = readBusy();
    await vi.waitFor(() => expect(started.length).toBeGreaterThan(0));
    for (const release of Array.from(gates.values()).reverse()) release();
    const busy = await busyPromise;

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(started).toHaveLength(6);
    expect(busy.map((entry) => entry.source)).toEqual(
      credentials.map((_, index) => `provider-concurrency-${index}`),
    );
  });

  it("fails naming the unreadable calendar even when another provider succeeds", async () => {
    const credentials = [
      { id: "credential-failure", type: "availability-failure" },
      { id: "credential-success", type: "availability-success" },
    ];
    const selected = [
      { credentialId: "credential-failure", externalId: "calendar-failure" },
      { credentialId: "credential-success", externalId: "calendar-success" },
    ];
    createFakeDb({
      credentials,
      selected,
      legacySelectedBatches: [[selected[0]], [selected[1]]],
    });
    registerCalendarProvider(
      createCalendarProvider(
        "availability-failure",
        vi.fn(async () => {
          throw new Error("Expected provider failure");
        }),
      ),
    );
    const successBusy = vi.fn(async () => [interval("provider-success", 13)]);
    registerCalendarProvider(
      createCalendarProvider("availability-success", successBusy),
    );

    const error = await readBusy().then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CalendarAvailabilityUnavailableError);
    const unavailable = error as CalendarAvailabilityUnavailableError;
    expect(unavailable.message).toContain(
      "Couldn't check Test provider availability-failure",
    );
    expect(unavailable.failures).toEqual([
      {
        credentialId: "credential-failure",
        provider: "availability-failure",
        providerLabel: "Test provider availability-failure",
        calendarExternalIds: ["calendar-failure"],
        reason: "lookup_failed",
        cause: "Expected provider failure",
      },
    ]);
    expect(successBusy).toHaveBeenCalledTimes(1);
  });

  it("skips credentials without selected calendars", async () => {
    createFakeDb({
      credentials: [{ id: "credential-empty", type: "availability-empty" }],
      selected: [],
      legacySelectedBatches: [[]],
    });
    const emptyProviderBusy = vi.fn(async () => []);
    registerCalendarProvider(
      createCalendarProvider("availability-empty", emptyProviderBusy),
    );

    await expect(readBusy()).resolves.toEqual([]);
    expect(emptyProviderBusy).not.toHaveBeenCalled();
  });

  it("fails when a selected calendar's provider is not registered", async () => {
    createFakeDb({
      credentials: [{ id: "credential-unknown", type: "availability-unknown" }],
      selected: [
        { credentialId: "credential-unknown", externalId: "calendar-unknown" },
      ],
    });

    const error = await readBusy().then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CalendarAvailabilityUnavailableError);
    expect((error as CalendarAvailabilityUnavailableError).failures).toEqual([
      expect.objectContaining({
        credentialId: "credential-unknown",
        provider: "availability-unknown",
        reason: "provider_not_registered",
      }),
    ]);
  });

  it("fails when a selected calendar's credential was marked invalid", async () => {
    const invalidBusy = vi.fn(async () => []);
    registerCalendarProvider(
      createCalendarProvider("availability-invalid", invalidBusy),
    );
    createFakeDb({
      credentials: [
        {
          id: "credential-invalid",
          type: "availability-invalid",
          invalid: true,
        },
      ],
      selected: [
        { credentialId: "credential-invalid", externalId: "calendar-invalid" },
      ],
    });

    const error = await readBusy().then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CalendarAvailabilityUnavailableError);
    expect((error as CalendarAvailabilityUnavailableError).failures).toEqual([
      expect.objectContaining({
        credentialId: "credential-invalid",
        reason: "credential_invalid",
      }),
    ]);
    expect(invalidBusy).not.toHaveBeenCalled();
  });

  it("reports a throttled lookup as a retryable lookup_failed with its Retry-After", async () => {
    registerCalendarProvider(
      createCalendarProvider(
        "availability-throttled",
        vi.fn(async () => {
          throw new CalendarLookupRateLimitedError(
            "Test provider rate limited (403 rateLimitExceeded)",
            45,
          );
        }),
      ),
    );
    createFakeDb({
      credentials: [
        { id: "credential-throttled", type: "availability-throttled" },
      ],
      selected: [
        {
          credentialId: "credential-throttled",
          externalId: "calendar-throttled",
        },
      ],
    });

    const error = await readBusy().then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CalendarAvailabilityUnavailableError);
    expect((error as CalendarAvailabilityUnavailableError).details).toEqual({
      calendars: [
        {
          provider: "availability-throttled",
          providerLabel: "Test provider availability-throttled",
          reason: "lookup_failed",
          retryAfterSeconds: 45,
        },
      ],
      retryAfterSeconds: 45,
    });
  });

  it("reports credential_invalid when the provider rejects the credential on this lookup", async () => {
    registerCalendarProvider(
      createCalendarProvider(
        "availability-unauthorized",
        vi.fn(async () => {
          throw new CalendarCredentialInvalidError(
            "Test provider credential invalid (401)",
          );
        }),
      ),
    );
    createFakeDb({
      credentials: [
        { id: "credential-unauthorized", type: "availability-unauthorized" },
      ],
      selected: [
        {
          credentialId: "credential-unauthorized",
          externalId: "calendar-unauthorized",
        },
      ],
    });

    const error = await readBusy().then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CalendarAvailabilityUnavailableError);
    expect((error as CalendarAvailabilityUnavailableError).details).toEqual({
      calendars: [
        expect.objectContaining({
          provider: "availability-unauthorized",
          reason: "credential_invalid",
        }),
      ],
    });
  });

  it("ignores an invalid credential that has no selected calendars", async () => {
    createFakeDb({
      credentials: [
        {
          id: "credential-invalid-unselected",
          type: "availability-invalid-unselected",
          invalid: true,
        },
      ],
      selected: [],
    });

    await expect(readBusy()).resolves.toEqual([]);
  });

  it("does not read selected calendars when there are no valid credentials", async () => {
    const { reads } = createFakeDb({
      bookings: [
        {
          startTime: "2026-07-10T10:00:00.000Z",
          endTime: "2026-07-10T11:00:00.000Z",
          uid: "booking-only-example",
        },
      ],
      credentials: [],
    });

    await expect(readBusy()).resolves.toEqual([
      {
        start: "2026-07-10T10:00:00.000Z",
        end: "2026-07-10T11:00:00.000Z",
        source: "booking:booking-only-example",
      },
    ]);
    expect(reads.selectedCalendars).toBe(0);
  });
});

const SLOT_DAY_START = new Date("2030-01-07T00:00:00.000Z");
const SLOT_DAY_END = new Date("2030-01-08T00:00:00.000Z");

const EVENT_TYPE: EventType = {
  id: "event-type-availability",
  title: "Intro call",
  slug: "intro-call",
  length: 30,
  hidden: false,
  position: 0,
  schedulingType: "individual",
  ownerEmail: TEST_USER_EMAIL,
  scheduleId: WORKDAY_SCHEDULE.id,
  locations: [],
  customFields: [],
  minimumBookingNotice: 0,
  beforeEventBuffer: 0,
  afterEventBuffer: 0,
  slotInterval: null,
  periodType: "unlimited",
  requiresConfirmation: false,
  disableGuests: false,
  hideCalendarNotes: false,
  lockTimeZoneToggle: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function readSlots() {
  return getAvailableSlots({
    eventType: EVENT_TYPE,
    forUserEmail: TEST_USER_EMAIL,
    rangeStart: SLOT_DAY_START,
    rangeEnd: SLOT_DAY_END,
    now: new Date("2029-12-01T00:00:00.000Z"),
  });
}

function selectedCalendarDb(kind: string) {
  createFakeDb({
    credentials: [{ id: `credential-${kind}`, type: kind }],
    selected: [
      { credentialId: `credential-${kind}`, externalId: `calendar-${kind}` },
    ],
  });
}

describe("getAvailableSlots with selected calendars", () => {
  it("offers the whole working day when no calendar is connected", async () => {
    createFakeDb({ credentials: [] });

    await expect(readSlots()).resolves.toHaveLength(16);
  });

  it("offers nothing when a selected calendar is busy all day", async () => {
    const getBusy = vi.fn(async () => [
      {
        start: "2030-01-07T09:00:00.000Z",
        end: "2030-01-07T17:00:00.000Z",
        source: "calendar-slots-busy",
      },
    ]);
    registerCalendarProvider(createCalendarProvider("slots-busy", getBusy));
    selectedCalendarDb("slots-busy");

    await expect(readSlots()).resolves.toHaveLength(0);
    expect(getBusy).toHaveBeenCalledTimes(1);
  });

  it("fails with a typed error instead of offering free slots when the busy lookup throws", async () => {
    const getBusy = vi.fn(async () => {
      throw new Error("Injected calendar outage");
    });
    registerCalendarProvider(createCalendarProvider("slots-throws", getBusy));
    selectedCalendarDb("slots-throws");

    const result = await readSlots().then(
      (slots) => ({ slots }),
      (error: unknown) => ({ error }),
    );

    expect(getBusy).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("slots");
    const error = (result as { error: unknown }).error;
    expect(error).toBeInstanceOf(CalendarAvailabilityUnavailableError);
    expect(isActionContractError(error)).toBe(true);
    const unavailable = error as CalendarAvailabilityUnavailableError;
    expect(unavailable.errorCode).toBe("calendar_availability_unavailable");
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.message).toContain(
      "Couldn't check Test provider slots-throws",
    );
    expect(unavailable.details).toEqual({
      calendars: [
        {
          provider: "slots-throws",
          providerLabel: "Test provider slots-throws",
          reason: "lookup_failed",
        },
      ],
    });
    expect(JSON.stringify(unavailable.details)).not.toContain(
      "Injected calendar outage",
    );
  });

  it("keeps offering slots for a credential whose calendars are all unselected", async () => {
    const getBusy = vi.fn(async () => {
      throw new Error("Unselected calendars are never read");
    });
    registerCalendarProvider(
      createCalendarProvider("slots-unselected", getBusy),
    );
    createFakeDb({
      credentials: [
        { id: "credential-slots-unselected", type: "slots-unselected" },
      ],
      selected: [],
    });

    await expect(readSlots()).resolves.toHaveLength(16);
    expect(getBusy).not.toHaveBeenCalled();
  });
});

describe("assertSlotAvailable with selected calendars", () => {
  it("refuses the booking when a selected calendar can't be read", async () => {
    registerCalendarProvider(
      createCalendarProvider(
        "booking-throws",
        vi.fn(async () => {
          throw new Error("Injected calendar outage");
        }),
      ),
    );
    selectedCalendarDb("booking-throws");

    await expect(
      assertSlotAvailable({
        hostEmail: TEST_USER_EMAIL,
        startTime: "2030-01-07T09:00:00.000Z",
        endTime: "2030-01-07T09:30:00.000Z",
      }),
    ).rejects.toBeInstanceOf(CalendarAvailabilityUnavailableError);
  });
});
