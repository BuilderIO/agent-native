import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    meetings: { id: "meetings.id" },
  },
}));

import updateMeeting from "./update-meeting";

function createDb() {
  const patches: Record<string, unknown>[] = [];
  const updateBuilder = {
    set: vi.fn((patch: Record<string, unknown>) => {
      patches.push(patch);
      return updateBuilder;
    }),
    where: vi.fn(async () => undefined),
  };
  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(() => selectBuilder),
    limit: vi.fn(async () => [{ id: "meeting-1" }]),
  };
  return {
    patches,
    update: vi.fn(() => updateBuilder),
    select: vi.fn(() => selectBuilder),
  };
}

describe("update-meeting transcript sharing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccess.mockResolvedValue({ role: "owner" });
    mockWriteAppState.mockResolvedValue(undefined);
  });

  it("requires admin access and persists an explicit transcript-sharing change", async () => {
    const db = createDb();
    mockGetDb.mockReturnValue(db);

    await updateMeeting.run({ id: "meeting-1", shareTranscript: true });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "meeting",
      "meeting-1",
      "admin",
    );
    expect(db.patches[0]).toMatchObject({ shareTranscript: true });
  });

  it("keeps ordinary meeting edits at the editor role", async () => {
    const db = createDb();
    mockGetDb.mockReturnValue(db);

    await updateMeeting.run({ id: "meeting-1", title: "Renamed" });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "meeting",
      "meeting-1",
      "editor",
    );
    expect(db.patches[0]).toMatchObject({ title: "Renamed" });
    expect(db.patches[0]).not.toHaveProperty("shareTranscript");
  });

  it("requires admin access for visibility changes", async () => {
    const db = createDb();
    mockGetDb.mockReturnValue(db);

    await updateMeeting.run({ id: "meeting-1", visibility: "public" });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "meeting",
      "meeting-1",
      "admin",
    );
  });

  it("parses false-like CLI values without turning them on", () => {
    expect(
      updateMeeting.schema.parse({
        id: "meeting-1",
        shareTranscript: "false",
      }),
    ).toMatchObject({ shareTranscript: false });
  });
});
