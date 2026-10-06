import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "../../audit/types.js";

const insertAuditEvent = vi.hoisted(() =>
  vi.fn(async (_event: AuditEvent) => undefined),
);
const clearFileStorage = vi.hoisted(() => vi.fn());
const saveFileStorage = vi.hoisted(() => vi.fn());

vi.mock("../../audit/store.js", () => ({ insertAuditEvent }));
vi.mock("../storage-settings.js", () => ({
  clearFileStorage,
  saveFileStorage,
}));

const { fail } = await import("../../action.js");
const manageFileStorage = (await import("./manage-file-storage.js")).default;

const ctx = (userEmail: string, orgId: string | null) => ({
  actionName: "manage-file-storage",
  caller: "frontend" as const,
  userEmail,
  orgId,
});

function recorded(): AuditEvent {
  expect(insertAuditEvent).toHaveBeenCalledTimes(1);
  return insertAuditEvent.mock.calls[0]![0];
}

beforeEach(() => {
  insertAuditEvent.mockClear();
  clearFileStorage.mockReset();
  saveFileStorage.mockReset();
});

describe("manage-file-storage audit", () => {
  it("puts an admin's storage change in the organization's admin trail", async () => {
    saveFileStorage.mockResolvedValue({ configured: true });

    await manageFileStorage.run(
      { operation: "save", bucket: "uploads" },
      ctx("admin@example.test", "org-a"),
    );

    expect(recorded()).toMatchObject({
      action: "manage-file-storage",
      status: "success",
      orgId: "org-a",
      targetType: "file-storage",
      targetId: "workspace",
      visibility: "admins",
      summary: "Saved file storage settings",
      input: null,
    });
  });

  it("records a member's refused clear as denied for admins to see", async () => {
    clearFileStorage.mockImplementation(() =>
      fail("Only organization owners and admins can change file storage.", {
        statusCode: 403,
      }),
    );

    await expect(
      manageFileStorage.run(
        { operation: "clear" },
        ctx("member@example.test", "org-a"),
      ),
    ).rejects.toThrow("Only organization owners and admins");

    expect(recorded()).toMatchObject({
      status: "denied",
      actorEmail: "member@example.test",
      visibility: "admins",
      summary: "Cleared file storage credentials",
    });
  });

  it("keeps a solo workspace's storage change private", async () => {
    clearFileStorage.mockResolvedValue({ removedKeys: [] });

    await manageFileStorage.run(
      { operation: "clear" },
      ctx("solo@example.test", null),
    );

    expect(recorded()).toMatchObject({ orgId: null, visibility: "private" });
  });
});
