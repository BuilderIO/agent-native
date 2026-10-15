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
  rows: [] as Array<{ status: string }>,
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
          return recordingRows.rows;
        },
      }),
    }),
  }),
  schema: {
    recordings: {
      id: "recordings.id",
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
    recordingRows.rows = [{ status: "uploading" }];
    vi.useRealTimers();
  });

  it("stores only a hash of the token, keyed by its recording", async () => {
    const { createRecordingUploadTicket, RECORDING_UPLOAD_TICKET_TTL_MS } =
      await import("./recording-upload-ticket.js");

    const before = Date.now();
    const created = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
      "org-1",
    );

    const stored = JSON.parse(settings.get(storageKey)!);
    expect(Object.keys(stored.tickets)).toEqual(["rec-1"]);
    expect(stored.tickets["rec-1"]).toEqual({
      recordingId: "rec-1",
      orgId: "org-1",
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: created.expiresAt,
    });
    expect(settings.get(storageKey)).not.toContain(created.token);
    expect(created.token.startsWith("clipsup_")).toBe(true);
    expect(created.expiresAt).toBeGreaterThanOrEqual(
      before + RECORDING_UPLOAD_TICKET_TTL_MS,
    );
  });

  it("opens its own recording's live upload for the ticket owner", async () => {
    const { createRecordingUploadTicket, requireRecordingUploadTicketOwner } =
      await import("./recording-upload-ticket.js");
    const { token } = await createRecordingUploadTicket(
      "owner@example.com",
      "rec-1",
      "org-1",
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

    for (const rows of [
      [{ status: "processing" }],
      [{ status: "ready" }],
      [{ status: "failed" }],
      [],
    ]) {
      recordingRows.rows = rows;
      await expect(
        requireRecordingUploadTicketOwner(ticketEvent(token), "rec-1"),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
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
