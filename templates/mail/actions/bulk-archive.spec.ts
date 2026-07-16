import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));

import action from "./bulk-archive";

describe("bulk-archive action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.withLocalEmailMutationLock.mockImplementation(
      async (_ownerEmail, mutate) => mutate(),
    );
    mocks.writeLocalEmails.mockResolvedValue(undefined);
  });

  it("uses the shared owner lock and preserves empty-mailbox success", async () => {
    mocks.readLocalEmails.mockResolvedValue([]);

    const result = await action.run({ "older-than": 30 });

    expect(result).toBe("Archived 0 email(s) older than 30 days (0 total)");
    expect(mocks.withLocalEmailMutationLock).toHaveBeenCalledWith(
      "owner@example.com",
      expect.any(Function),
    );
    expect(mocks.writeLocalEmails).toHaveBeenCalledWith(
      "owner@example.com",
      [],
    );
  });

  it("archives only eligible old inbox mail in one write", async () => {
    const old = {
      id: "old",
      date: "2020-01-01T00:00:00.000Z",
      isArchived: false,
      isTrashed: false,
      isDraft: false,
      labelIds: ["inbox", "updates"],
    };
    const recent = {
      ...old,
      id: "recent",
      date: new Date().toISOString(),
    };
    mocks.readLocalEmails.mockResolvedValue([old, recent]);

    const result = await action.run({ "older-than": 30 });

    expect(result).toBe("Archived 1 email(s) older than 30 days (2 total)");
    expect(mocks.writeLocalEmails).toHaveBeenCalledWith("owner@example.com", [
      expect.objectContaining({
        id: "old",
        isArchived: true,
        labelIds: ["updates"],
      }),
      recent,
    ]);
  });
});
