import { describe, expect, it, vi } from "vitest";

import { validateRecordingScope } from "./recording-scope";

vi.mock("../../server/lib/recordings.js", () => ({
  sameOwnerEmail: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(),
}));

function query(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({ limit: async () => rows }),
    }),
  };
}

describe("validateRecordingScope", () => {
  it("requires org-owned spaces and a folder in the requested scope", async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(
          query([
            {
              organizationId: "org-1",
              ownerEmail: "owner@example.com",
              spaceId: "space-1",
            },
          ]),
        )
        .mockReturnValueOnce(query([{ id: "space-1" }])),
    };

    await expect(
      validateRecordingScope(db as any, {
        organizationId: "org-1",
        ownerEmail: "owner@example.com",
        spaceIds: ["space-1"],
        folderId: "folder-1",
      }),
    ).resolves.toEqual(["space-1"]);

    await expect(
      validateRecordingScope({ select: vi.fn(() => query([])) } as any, {
        organizationId: "org-1",
        ownerEmail: "owner@example.com",
        spaceIds: ["space-from-another-org"],
      }),
    ).rejects.toThrow("One or more spaces were not found.");

    const mismatchedFolderDb = {
      select: vi.fn().mockReturnValueOnce(
        query([
          {
            ownerEmail: "owner@example.com",
            spaceId: "space-2",
          },
        ]),
      ),
    };
    await expect(
      validateRecordingScope(mismatchedFolderDb as any, {
        organizationId: "org-1",
        ownerEmail: "owner@example.com",
        spaceIds: ["space-1"],
        folderId: "folder-1",
      }),
    ).rejects.toThrow("Target folder must belong to the same organization");
  });

  it("infers the space from a space folder when no space was provided", async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(
          query([
            {
              ownerEmail: "owner@example.com",
              spaceId: "space-1",
            },
          ]),
        )
        .mockReturnValueOnce(query([{ id: "space-1" }])),
    };

    await expect(
      validateRecordingScope(db as any, {
        organizationId: "org-1",
        ownerEmail: "owner@example.com",
        spaceIds: [],
        folderId: "folder-1",
      }),
    ).resolves.toEqual(["space-1"]);
  });
});
