import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLocalEmails: vi.fn(),
  findGmailDraftAccount: vi.fn(),
}));

vi.mock("./local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
}));

vi.mock("./gmail-drafts.js", () => ({
  findGmailDraftAccount: mocks.findGmailDraftAccount,
}));

import {
  resolveExistingSavedDraftOwnership,
  SavedDraftOwnershipError,
} from "./saved-draft-ownership.js";

describe("resolveExistingSavedDraftOwnership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readLocalEmails.mockResolvedValue([]);
    mocks.findGmailDraftAccount.mockResolvedValue(null);
  });

  it("recognizes an exact legacy local draft before considering Gmail", async () => {
    mocks.readLocalEmails.mockResolvedValue([
      { id: "local-draft-1", isDraft: true },
    ]);

    await expect(
      resolveExistingSavedDraftOwnership({
        ownerEmail: "owner@example.com",
        savedDraftId: "local-draft-1",
        accountEmail: "owner@example.com",
      }),
    ).resolves.toEqual({ backend: "local" });
    expect(mocks.findGmailDraftAccount).not.toHaveBeenCalled();
  });

  it("recognizes a legacy Gmail draft only after the exact provider lookup", async () => {
    mocks.findGmailDraftAccount.mockResolvedValue("secondary@example.com");

    await expect(
      resolveExistingSavedDraftOwnership({
        ownerEmail: "owner@example.com",
        savedDraftId: "gmail-draft-1",
      }),
    ).resolves.toEqual({
      backend: "gmail",
      accountEmail: "secondary@example.com",
    });
  });

  it("rejects unknown ownership instead of choosing from connection state", async () => {
    await expect(
      resolveExistingSavedDraftOwnership({
        ownerEmail: "owner@example.com",
        savedDraftId: "unknown-draft",
        accountEmail: "owner@example.com",
      }),
    ).rejects.toBeInstanceOf(SavedDraftOwnershipError);
  });

  it("honors explicit backend metadata without reclassifying the saved draft", async () => {
    await expect(
      resolveExistingSavedDraftOwnership({
        ownerEmail: "owner@example.com",
        savedDraftId: "local-draft-1",
        savedDraftBackend: "local",
      }),
    ).resolves.toEqual({ backend: "local" });
    expect(mocks.readLocalEmails).not.toHaveBeenCalled();
    expect(mocks.findGmailDraftAccount).not.toHaveBeenCalled();
  });

  it("resolves a Gmail account for explicit backend metadata when the old row lacks one", async () => {
    mocks.findGmailDraftAccount.mockResolvedValue("secondary@example.com");

    await expect(
      resolveExistingSavedDraftOwnership({
        ownerEmail: "owner@example.com",
        savedDraftId: "gmail-draft-1",
        savedDraftBackend: "gmail",
      }),
    ).resolves.toEqual({
      backend: "gmail",
      accountEmail: "secondary@example.com",
    });
  });
});
