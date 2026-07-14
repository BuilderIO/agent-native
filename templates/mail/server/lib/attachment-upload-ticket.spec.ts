import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(async (ownerEmail: string, key: string) =>
    settings.get(`${ownerEmail}:${key}`),
  ),
  putUserSetting: vi.fn(
    async (ownerEmail: string, key: string, value: unknown) => {
      settings.set(`${ownerEmail}:${key}`, value);
    },
  ),
  deleteUserSetting: vi.fn(async (ownerEmail: string, key: string) => {
    settings.delete(`${ownerEmail}:${key}`);
  }),
}));

describe("attachment upload tickets", () => {
  beforeEach(() => {
    settings.clear();
    vi.useRealTimers();
  });

  it("stores only a hash and resolves the owner from the capability", async () => {
    const { createAttachmentUploadTicket, verifyAttachmentUploadTicket } =
      await import("./attachment-upload-ticket.js");

    const created = await createAttachmentUploadTicket(
      "owner@example.com",
      "quarterly report.pdf",
    );
    const stored = settings.get(
      "owner@example.com:mail-attachment-upload-ticket",
    ) as Record<string, unknown>;

    expect(stored).not.toHaveProperty("token");
    expect(stored.tokenHash).not.toBe(created.token);
    expect(created.filename).toBe(`${created.uploadId}.pdf`);
    await expect(
      verifyAttachmentUploadTicket(created.uploadId, created.token),
    ).resolves.toMatchObject({
      ownerEmail: "owner@example.com",
      ticket: { originalName: "quarterly report.pdf" },
    });
  });

  it("rejects tampered, replaced, expired, and consumed capabilities", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    const {
      consumeAttachmentUploadTicket,
      createAttachmentUploadTicket,
      verifyAttachmentUploadTicket,
    } = await import("./attachment-upload-ticket.js");

    const first = await createAttachmentUploadTicket(
      "owner@example.com",
      "first.txt",
    );
    await expect(
      verifyAttachmentUploadTicket(first.uploadId, `${first.token}x`),
    ).resolves.toBeNull();

    const second = await createAttachmentUploadTicket(
      "owner@example.com",
      "second.txt",
    );
    await expect(
      verifyAttachmentUploadTicket(first.uploadId, first.token),
    ).resolves.toBeNull();

    await consumeAttachmentUploadTicket("owner@example.com", second.uploadId);
    await expect(
      verifyAttachmentUploadTicket(second.uploadId, second.token),
    ).resolves.toBeNull();

    const expiring = await createAttachmentUploadTicket(
      "owner@example.com",
      "late.txt",
    );
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await expect(
      verifyAttachmentUploadTicket(expiring.uploadId, expiring.token),
    ).resolves.toBeNull();
  });
});
