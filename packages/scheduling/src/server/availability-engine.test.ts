import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../schema/index.js";
import type { BusyInterval } from "../shared/index.js";
import { aggregateBusy } from "./availability-engine.js";
import { setSchedulingContext } from "./context.js";
import { registerCalendarProvider } from "./providers/registry.js";
import type { CalendarProvider } from "./providers/types.js";

const RANGE_START = new Date("2026-07-10T09:00:00.000Z");
const RANGE_END = new Date("2026-07-10T17:00:00.000Z");
const TEST_USER_EMAIL = "availability-test@example.com";

interface CredentialRow {
  id: string;
  type: string;
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
  /** Supports the pre-batching implementation during characterization. */
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

  it("keeps successful provider intervals when another provider fails", async () => {
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
    registerCalendarProvider(
      createCalendarProvider(
        "availability-success",
        vi.fn(async () => [interval("provider-success", 13)]),
      ),
    );

    await expect(readBusy()).resolves.toEqual([
      interval("provider-success", 13),
    ]);
  });

  it("skips credentials without selected calendars or a registered provider", async () => {
    const credentials = [
      { id: "credential-empty", type: "availability-empty" },
      { id: "credential-unknown", type: "availability-unknown" },
    ];
    const selected = [
      {
        credentialId: "credential-unknown",
        externalId: "calendar-unknown",
      },
    ];
    createFakeDb({
      credentials,
      selected,
      legacySelectedBatches: [[], selected],
    });
    const emptyProviderBusy = vi.fn(async () => []);
    registerCalendarProvider(
      createCalendarProvider("availability-empty", emptyProviderBusy),
    );

    await expect(readBusy()).resolves.toEqual([]);
    expect(emptyProviderBusy).not.toHaveBeenCalled();
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
