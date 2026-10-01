import { beforeEach, describe, expect, it, vi } from "vitest";

const labEnabled = vi.hoisted(() => ({ value: false }));
const getUserLabEnabled = vi.hoisted(() => vi.fn(async () => labEnabled.value));
const listSessionRecordings = vi.hoisted(() => vi.fn(async () => []));
const listSessionRecordingsPage = vi.hoisted(() =>
  vi.fn(async () => ({ recordings: [], total: 0, appCounts: [] })),
);
const listSessionEventNames = vi.hoisted(() =>
  vi.fn(async () => ({ events: [], coverageStartedAt: null })),
);
const listEventCatalog = vi.hoisted(() =>
  vi.fn(async () => ({
    from: "2026-09-01",
    to: "2026-09-30",
    entries: [
      {
        eventName: "clip.viewed",
        app: "clips",
        volume: 3,
        lastSeenAt: "2026-09-29T10:00:00.000Z",
        propertyKeys: [],
        description: null as string | null,
        automatic: false,
        stoppedFiring: false,
      },
    ],
    apps: [],
    truncated: false,
  })),
);

vi.mock("@agent-native/core/labs/server", () => ({ getUserLabEnabled }));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "user@example.test",
  getRequestOrgId: () => "org-1",
}));
vi.mock("@agent-native/core/settings", () => ({
  listOrgSettings: vi.fn(async () => ({
    "data-dict-clip-viewed": {
      metric: "Clip viewed",
      definition: "A viewer opened a clip.",
    },
  })),
  listSettingsByPrefix: vi.fn(async () => []),
}));
vi.mock("../server/lib/session-replay.js", () => ({
  listSessionRecordings,
  listSessionRecordingsPage,
}));
vi.mock("../server/lib/session-event-index.js", () => ({
  listSessionEventNames,
  listEventCatalog,
}));

const { default: listRecordings } = await import("./list-session-recordings");
const { default: listEventNames } = await import("./list-session-event-names");
const { default: listCatalog } = await import("./list-event-catalog");

describe("Sessions triage Lab guard on event actions", () => {
  beforeEach(() => {
    labEnabled.value = false;
    getUserLabEnabled.mockClear();
    listSessionRecordingsPage.mockClear();
  });

  it("keeps plain session lists working with the Lab off", async () => {
    await listRecordings.run({ paginated: true } as never);
    expect(getUserLabEnabled).not.toHaveBeenCalled();
    expect(listSessionRecordingsPage).toHaveBeenCalledOnce();
  });

  it("rejects event filters, event names, and the catalog with the Lab off", async () => {
    await expect(
      listRecordings.run({
        paginated: true,
        didEvents: ["recording_started"],
      } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(listEventNames.run({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(listCatalog.run({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(listSessionRecordingsPage).not.toHaveBeenCalled();
    expect(getUserLabEnabled).toHaveBeenCalledWith(
      "user@example.test",
      expect.objectContaining({ key: "analytics.sessions-triage" }),
      { orgId: "org-1" },
    );
  });

  it("serves event filters and fills catalog descriptions with the Lab on", async () => {
    labEnabled.value = true;
    await listRecordings.run({
      paginated: true,
      didNotEvents: ["clip_viewed"],
    } as never);
    expect(listSessionRecordingsPage).toHaveBeenCalledWith(
      { userEmail: "user@example.test", orgId: "org-1" },
      expect.objectContaining({ didNotEvents: ["clip_viewed"] }),
    );

    const catalog = (await listCatalog.run({} as never)) as Awaited<
      ReturnType<typeof listEventCatalog>
    >;
    expect(catalog.entries[0].description).toBe("A viewer opened a clip.");
  });

  it("rejects event range bounds that are not timestamps", () => {
    expect(listCatalog.schema.safeParse({ from: "last week" }).success).toBe(
      false,
    );
    expect(listEventNames.schema.safeParse({ to: "soon" }).success).toBe(false);
    for (const bound of ["Sept 1", "2026-02-30", "2026-09-20T10:00:00"]) {
      expect(listCatalog.schema.safeParse({ from: bound }).success).toBe(false);
    }
    for (const bound of [
      "2026-09-01",
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T02:00:00+02:00",
    ]) {
      expect(listCatalog.schema.safeParse({ from: bound }).success).toBe(true);
    }
  });
});
