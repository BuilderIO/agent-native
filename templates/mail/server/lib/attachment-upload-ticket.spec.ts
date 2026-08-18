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
    if (sql.startsWith("INSERT OR IGNORE")) {
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

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
  isPostgres: () => false,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(async (ownerEmail: string, key: string) => {
    const raw = settings.get(`u:${ownerEmail}:${key}`);
    return raw ? JSON.parse(raw) : null;
  }),
}));

const storageKey = "u:owner@example.com:mail-attachment-upload-ticket";

describe("attachment upload tickets", () => {
  beforeEach(() => {
    settings.clear();
    execute.mockClear();
    vi.useRealTimers();
  });

  it("stores only a hash and resolves the owner from the capability", async () => {
    const { createAttachmentUploadTicket, verifyAttachmentUploadTicket } =
      await import("./attachment-upload-ticket.js");

    const created = await createAttachmentUploadTicket(
      "owner@example.com",
      "quarterly report.pdf",
    );
    const stored = JSON.parse(settings.get(storageKey)!) as {
      tickets: Record<string, Record<string, unknown>>;
    };
    const storedTicket = stored.tickets[created.uploadId];

    expect(storedTicket).not.toHaveProperty("token");
    expect(storedTicket.tokenHash).not.toBe(created.token);
    expect(created.filename).toBe(`${created.uploadId}.pdf`);
    await expect(
      verifyAttachmentUploadTicket(created.uploadId, created.token),
    ).resolves.toMatchObject({
      ownerEmail: "owner@example.com",
      ticket: { originalName: "quarterly report.pdf" },
    });
  });

  it("keeps multiple pending tickets and consumes only the claimed ticket", async () => {
    const {
      claimAttachmentUploadTicket,
      createAttachmentUploadTicket,
      verifyAttachmentUploadTicket,
    } = await import("./attachment-upload-ticket.js");

    const first = await createAttachmentUploadTicket(
      "owner@example.com",
      "first.txt",
    );
    const second = await createAttachmentUploadTicket(
      "owner@example.com",
      "second.txt",
    );

    await expect(
      verifyAttachmentUploadTicket(first.uploadId, first.token),
    ).resolves.not.toBeNull();
    await expect(
      verifyAttachmentUploadTicket(second.uploadId, second.token),
    ).resolves.not.toBeNull();

    await expect(
      claimAttachmentUploadTicket(first.uploadId, first.token),
    ).resolves.toMatchObject({ ticket: { uploadId: first.uploadId } });
    await expect(
      verifyAttachmentUploadTicket(first.uploadId, first.token),
    ).resolves.toBeNull();
    await expect(
      verifyAttachmentUploadTicket(second.uploadId, second.token),
    ).resolves.not.toBeNull();
  });

  it("prunes expired tickets while preserving a newly minted ticket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    const { createAttachmentUploadTicket, verifyAttachmentUploadTicket } =
      await import("./attachment-upload-ticket.js");

    const expired = await createAttachmentUploadTicket(
      "owner@example.com",
      "expired.txt",
    );
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const current = await createAttachmentUploadTicket(
      "owner@example.com",
      "current.txt",
    );
    const stored = JSON.parse(settings.get(storageKey)!) as {
      tickets: Record<string, unknown>;
    };

    expect(Object.keys(stored.tickets)).toEqual([current.uploadId]);
    await expect(
      verifyAttachmentUploadTicket(expired.uploadId, expired.token),
    ).resolves.toBeNull();
  });

  it("bounds pending ticket storage while keeping the newest ticket valid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    const { createAttachmentUploadTicket, verifyAttachmentUploadTicket } =
      await import("./attachment-upload-ticket.js");

    let newest: Awaited<ReturnType<typeof createAttachmentUploadTicket>>;
    for (let index = 0; index < 21; index += 1) {
      newest = await createAttachmentUploadTicket(
        "owner@example.com",
        `report-${index}.txt`,
      );
    }
    const stored = JSON.parse(settings.get(storageKey)!) as {
      tickets: Record<string, unknown>;
    };

    expect(Object.keys(stored.tickets)).toHaveLength(20);
    await expect(
      verifyAttachmentUploadTicket(newest!.uploadId, newest!.token),
    ).resolves.not.toBeNull();
  });

  it("gives exactly one concurrent claimant the one-time capability", async () => {
    const { claimAttachmentUploadTicket, createAttachmentUploadTicket } =
      await import("./attachment-upload-ticket.js");
    const created = await createAttachmentUploadTicket(
      "owner@example.com",
      "race.txt",
    );

    const results = await Promise.all([
      claimAttachmentUploadTicket(created.uploadId, created.token),
      claimAttachmentUploadTicket(created.uploadId, created.token),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
  });

  it("rejects a tampered capability without consuming the valid one", async () => {
    const {
      claimAttachmentUploadTicket,
      createAttachmentUploadTicket,
      verifyAttachmentUploadTicket,
    } = await import("./attachment-upload-ticket.js");
    const created = await createAttachmentUploadTicket(
      "owner@example.com",
      "report.txt",
    );

    await expect(
      claimAttachmentUploadTicket(created.uploadId, `${created.token}x`),
    ).resolves.toBeNull();
    await expect(
      verifyAttachmentUploadTicket(created.uploadId, created.token),
    ).resolves.not.toBeNull();
  });
});
