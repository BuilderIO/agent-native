import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, string>());
const execute = vi.hoisted(() =>
  vi.fn(async ({ sql, args }: { sql: string; args: unknown[] }) => {
    if (sql.startsWith("SELECT value")) {
      const value = settings.get(args[0] as string);
      return {
        rows: value === undefined ? [] : [{ value }],
        rowsAffected: 0,
      };
    }
    if (sql.startsWith("INSERT INTO")) {
      const [key, value] = args as [string, string];
      if (settings.has(key)) return { rows: [], rowsAffected: 0 };
      settings.set(key, value);
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.startsWith("UPDATE")) {
      const [value, , key, expected] = args as [string, number, string, string];
      if (settings.get(key) !== expected) {
        return { rows: [], rowsAffected: 0 };
      }
      settings.set(key, value);
      return { rows: [], rowsAffected: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }),
);
const recordingRows = vi.hoisted(() => ({
  rows: [] as Array<{ status: string; organizationId?: string }>,
  statusById: {} as Record<string, string>,
}));
const selectRecording = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(async () => null),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
}));

vi.mock("h3", () => ({
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
  getHeader: (event: { headers: Record<string, string> }, name: string) =>
    event.headers[name],
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async (where: unknown) => {
          selectRecording(where);
          if (JSON.stringify(where).includes('"inArray"')) {
            return Object.entries(recordingRows.statusById).map(
              ([id, status]) => ({ id, status }),
            );
          }
          return recordingRows.rows;
        },
      }),
    }),
  }),
  schema: {
    recordings: {
      id: "recordings.id",
      organizationId: "recordings.organizationId",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
    },
  },
}));

vi.mock("./recordings.js", () => ({
  ownerEmailMatches: (_column: unknown, email: string) => ({ owner: email }),
}));

const storageKey = "u:owner@example.com:clips-recording-upload-ticket";

function ticketEvent(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as any;
}

describe("recording upload tickets", () => {
  beforeEach(() => {
    settings.clear();
    execute.mockClear();
    selectRecording.mockClear();
    recordingRows.rows = [{ status: "uploading", organizationId: "org-1" }];
    recordingRows.statusById = {};
    vi.useRealTimers();
  });

  it("stores only a hash of the token, keyed by its recording", async () => {
    const { createRecordingUploadTicket, RECORDING_UPLOAD_TICKET_TTL_MS } =
      await import("./recording-upload-ticket.js");

    const before = Date.now();
    const created = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
    );

    const stored = JSON.parse(settings.get(storageKey)!);
    expect(Object.keys(stored.tickets)).toEqual(["rec-1"]);
    expect(stored.tickets["rec-1"]).toEqual({
      recordingId: "rec-1",
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      reservedAt: expect.any(Number),
      expiresAt: created.expiresAt,
    });
    expect(settings.get(storageKey)).not.toContain(created.token);
    expect(created.token.startsWith("clipsup_")).toBe(true);
    expect(created.expiresAt).toBeGreaterThanOrEqual(
      before + RECORDING_UPLOAD_TICKET_TTL_MS,
    );
  });

  it("opens its own recording's live upload for the ticket owner, in the recording's org", async () => {
    const { createRecordingUploadTicket, requireRecordingUploadTicketOwner } =
      await import("./recording-upload-ticket.js");
    const { token } = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
    );

    await expect(
      requireRecordingUploadTicketOwner(ticketEvent(token), "rec-1"),
    ).resolves.toEqual({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(selectRecording).toHaveBeenCalledWith({
      and: [{ eq: ["recordings.id", "rec-1"] }, { owner: "owner@example.com" }],
    });
  });

  it("refuses a request without an upload ticket before reading anything", async () => {
    const { requireRecordingUploadTicketOwner } =
      await import("./recording-upload-ticket.js");

    for (const event of [
      { headers: {} } as any,
      ticketEvent("some-session-token"),
    ]) {
      await expect(
        requireRecordingUploadTicketOwner(event, "rec-1"),
      ).rejects.toMatchObject({ statusCode: 401 });
    }
    expect(execute).not.toHaveBeenCalled();
    expect(selectRecording).not.toHaveBeenCalled();
  });

  it("refuses a wrong token, another recording's ticket, and a forged owner without writing", async () => {
    const { createRecordingUploadTicket, requireRecordingUploadTicketOwner } =
      await import("./recording-upload-ticket.js");
    const { token } = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
    );
    const storedBefore = settings.get(storageKey);
    execute.mockClear();

    const [ownerPart] = token.split(".");
    const forgedOwner = `clipsup_${Buffer.from("other@example.com").toString("base64url")}.${token.split(".")[1]}`;
    for (const [candidate, recordingId] of [
      [`${ownerPart}.wrong-secret`, "rec-1"],
      [token, "rec-2"],
      [forgedOwner, "rec-1"],
      ["clipsup_", "rec-1"],
    ]) {
      await expect(
        requireRecordingUploadTicketOwner(ticketEvent(candidate), recordingId),
      ).rejects.toMatchObject({ statusCode: 401 });
    }

    expect(selectRecording).not.toHaveBeenCalled();
    expect(
      execute.mock.calls.every(([query]) => query.sql.startsWith("SELECT")),
    ).toBe(true);
    expect(settings.get(storageKey)).toBe(storedBefore);
  });

  it("refuses an expired ticket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    const {
      createRecordingUploadTicket,
      requireRecordingUploadTicketOwner,
      RECORDING_UPLOAD_TICKET_TTL_MS,
    } = await import("./recording-upload-ticket.js");
    const { token } = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
    );

    vi.setSystemTime(Date.now() + RECORDING_UPLOAD_TICKET_TTL_MS + 1);

    await expect(
      requireRecordingUploadTicketOwner(ticketEvent(token), "rec-1"),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(selectRecording).not.toHaveBeenCalled();
  });

  it("refuses a ticket once its recording has left the uploading state", async () => {
    const { createRecordingUploadTicket, requireRecordingUploadTicketOwner } =
      await import("./recording-upload-ticket.js");
    const { token } = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
    );

    for (const [rows, guidance] of [
      [
        [{ status: "processing" }],
        /already finished.*get-recording-player-data/,
      ],
      [[{ status: "ready" }], /already finished.*get-recording-player-data/],
      [
        [{ status: "failed" }],
        /failed or was cancelled.*create-recording-upload/,
      ],
      [[], /failed or was cancelled.*create-recording-upload/],
    ] as const) {
      recordingRows.rows = [...rows];
      await expect(
        requireRecordingUploadTicketOwner(ticketEvent(token), "rec-1"),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(guidance),
      });
    }
  });

  it("refuses a new upload at the cap without evicting or writing anything", async () => {
    const { createRecordingUploadTicket, requireRecordingUploadTicketOwner } =
      await import("./recording-upload-ticket.js");
    const ids = Array.from({ length: 20 }, (_, i) => `rec-${i}`);
    const first = await createRecordingUploadTicket(
      "owner@example.com",
      ids[0],
    );
    for (const id of ids.slice(1)) {
      await createRecordingUploadTicket("owner@example.com", id);
    }
    // rec-0's recording is not created yet: its upload is still starting.
    recordingRows.statusById = Object.fromEntries(
      ids.slice(1).map((id) => [id, "uploading"]),
    );

    const storedBefore = settings.get(storageKey);
    await expect(
      createRecordingUploadTicket("owner@example.com", "rec-late"),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(settings.get(storageKey)).toBe(storedBefore);
    await expect(
      requireRecordingUploadTicketOwner(ticketEvent(first.token), ids[0]),
    ).resolves.toMatchObject({ recordingId: ids[0] });
  });

  it("frees a slot whose recording never appeared once the reservation is stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    const { createRecordingUploadTicket } =
      await import("./recording-upload-ticket.js");
    const ids = Array.from({ length: 20 }, (_, i) => `rec-${i}`);
    for (const id of ids) {
      await createRecordingUploadTicket("owner@example.com", id);
    }
    // rec-0 was deleted, or its creation failed and the release did too.
    recordingRows.statusById = Object.fromEntries(
      ids.slice(1).map((id) => [id, "uploading"]),
    );

    await expect(
      createRecordingUploadTicket("owner@example.com", "rec-new"),
    ).rejects.toMatchObject({ statusCode: 429 });

    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    await createRecordingUploadTicket("owner@example.com", "rec-new");
    const stored = Object.keys(JSON.parse(settings.get(storageKey)!).tickets);
    expect(stored).not.toContain(ids[0]);
    expect(stored).toContain("rec-new");
  });

  it("frees capacity held by uploads that already finished", async () => {
    const { createRecordingUploadTicket } =
      await import("./recording-upload-ticket.js");
    const ids = Array.from({ length: 20 }, (_, i) => `rec-${i}`);
    for (const id of ids) {
      await createRecordingUploadTicket("owner@example.com", id);
    }
    recordingRows.statusById = Object.fromEntries(
      ids.map((id, i) => [id, i === 0 ? "ready" : "uploading"]),
    );

    await createRecordingUploadTicket("owner@example.com", "rec-new");
    const stored = Object.keys(JSON.parse(settings.get(storageKey)!).tickets);
    expect(stored).not.toContain(ids[0]);
    expect(stored).toContain("rec-new");
    expect(stored).toHaveLength(20);
  });

  it("releases one reservation and leaves the others", async () => {
    const {
      createRecordingUploadTicket,
      releaseRecordingUploadTicket,
      requireRecordingUploadTicketOwner,
    } = await import("./recording-upload-ticket.js");
    const kept = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
    );
    const released = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-2",
    );

    await releaseRecordingUploadTicket("owner@example.com", "rec-2");
    await releaseRecordingUploadTicket("owner@example.com", "rec-2");

    expect(Object.keys(JSON.parse(settings.get(storageKey)!).tickets)).toEqual([
      "rec-1",
    ]);
    await expect(
      requireRecordingUploadTicketOwner(ticketEvent(released.token), "rec-2"),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      requireRecordingUploadTicketOwner(ticketEvent(kept.token), "rec-1"),
    ).resolves.toMatchObject({ recordingId: "rec-1" });
  });

  it("keeps other recordings' tickets when issuing a new one", async () => {
    const { createRecordingUploadTicket, requireRecordingUploadTicketOwner } =
      await import("./recording-upload-ticket.js");
    const first = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
    );
    await createRecordingUploadTicket("owner@example.com", "rec-2");

    await expect(
      requireRecordingUploadTicketOwner(ticketEvent(first.token), "rec-1"),
    ).resolves.toMatchObject({ recordingId: "rec-1" });
  });
});
