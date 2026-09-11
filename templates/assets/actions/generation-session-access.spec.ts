import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertCanDraftAuthoredByMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: vi.fn(),
}));

vi.mock("../server/lib/library-access.js", () => ({
  assertCanDraftAuthoredBy: assertCanDraftAuthoredByMock,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetGenerationSessions: { id: "image_generation_sessions.id" },
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn((column, value) => ({ column, value })),
}));

import { requireGenerationSessionInLibrary } from "./_helpers.js";

function dbWithSession(
  session: { id: string; libraryId: string; createdBy: string | null } | null,
) {
  getDbMock.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (session ? [session] : []) }),
      }),
    }),
  });
}

describe("requireGenerationSessionInLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertCanDraftAuthoredByMock.mockResolvedValue({
      role: "viewer",
      canApprove: false,
    });
  });

  it("rejects a session from another library before any access work", async () => {
    dbWithSession({
      id: "session-1",
      libraryId: "lib-other",
      createdBy: "author@example.test",
    });

    await expect(
      requireGenerationSessionInLibrary("session-1", "lib-1"),
    ).rejects.toThrow(/does not belong to this library/);
    expect(assertCanDraftAuthoredByMock).not.toHaveBeenCalled();
  });

  it("scopes a below-editor caller to the session author", async () => {
    dbWithSession({
      id: "session-1",
      libraryId: "lib-1",
      createdBy: "author@example.test",
    });

    await requireGenerationSessionInLibrary("session-1", "lib-1");

    // The author check is what stops a viewer from appending candidates to
    // someone else's handoff session and moving its active asset.
    expect(assertCanDraftAuthoredByMock).toHaveBeenCalledWith(
      "lib-1",
      "author@example.test",
      "A generation session",
    );
  });

  it("skips the author check when the resolved access can approve", async () => {
    dbWithSession({
      id: "session-1",
      libraryId: "lib-1",
      createdBy: "author@example.test",
    });

    await requireGenerationSessionInLibrary("session-1", "lib-1", {
      role: "editor",
      canApprove: true,
    });

    expect(assertCanDraftAuthoredByMock).not.toHaveBeenCalled();
  });
});
