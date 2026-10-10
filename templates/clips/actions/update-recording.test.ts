import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  patches: [] as Record<string, unknown>[],
  selectRows: [] as unknown[][],
}));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockSaveChapters = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, options: { errorCode?: string }) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("./lib/save-chapters.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/save-chapters.js")>()),
  saveChapters: (...args: unknown[]) => mockSaveChapters(...args),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => state.selectRows.shift() ?? [],
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        state.patches.push(patch);
        return { where: async () => undefined };
      },
    }),
  }),
  schema: { recordings: { id: "recordings.id" } },
}));

vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => "tag-id",
  stringifySpaceIds: JSON.stringify,
}));

vi.mock("../server/lib/share-password.js", () => ({
  encryptSharePassword: (value: string | null | undefined) =>
    value ? "encrypted-value" : null,
}));

import action from "./update-recording";

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "recording-1",
    organizationId: "org-1",
    sharePasswordVersion: "initial",
    ...overrides,
  };
}

async function run(args: Record<string, unknown>) {
  return action.run(action.schema.parse(args));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.patches = [];
  state.selectRows = [[recording()], [recording()]];
  mockAssertAccess.mockResolvedValue(undefined);
  mockWriteAppState.mockResolvedValue(undefined);
  mockSaveChapters.mockResolvedValue(undefined);
});

describe("update-recording share password version", () => {
  it("rotates the version when a password is set", async () => {
    await run({ id: "recording-1", password: "example-share-value" });

    expect(state.patches[0]).toMatchObject({
      password: "encrypted-value",
      sharePasswordVersion: expect.any(String),
    });
    expect(state.patches[0]?.sharePasswordVersion).not.toBe("initial");
  });

  it("rotates the version when a password is cleared", async () => {
    await run({ id: "recording-1", password: null });

    expect(state.patches[0]).toMatchObject({
      password: null,
      sharePasswordVersion: expect.any(String),
    });
    expect(state.patches[0]?.sharePasswordVersion).not.toBe("initial");
  });

  it("preserves the version for metadata edits", async () => {
    await run({ id: "recording-1", title: "Updated title" });

    expect(state.patches[0]).toMatchObject({ title: "Updated title" });
    expect(state.patches[0]).not.toHaveProperty("sharePasswordVersion");
  });
});

describe("update-recording chapters", () => {
  const intro = { startMs: 0, title: "Intro" };
  const demo = { startMs: 48_000, title: "Demo" };

  it("refuses chapters without the list they started from, and writes nothing", async () => {
    await expect(
      run({
        id: "recording-1",
        title: "Updated title",
        chaptersJson: JSON.stringify([intro]),
      }),
    ).rejects.toMatchObject({ errorCode: "expected_chapters_required" });
    expect(mockSaveChapters).not.toHaveBeenCalled();
    expect(state.patches).toEqual([]);
  });

  it("saves chapters through the guarded save, checked against the list given", async () => {
    await run({
      id: "recording-1",
      chaptersJson: JSON.stringify([demo, intro]),
      expectedChapters: JSON.stringify([intro]),
    });
    expect(mockSaveChapters).toHaveBeenCalledWith({
      recordingId: "recording-1",
      chapters: [demo, intro],
      expectedChapters: [intro],
      expectedVersion: null,
      expectedCuts: null,
    });
    expect(state.patches[0]).not.toHaveProperty("chaptersJson");
  });

  it("writes nothing else when the guarded save is refused", async () => {
    mockSaveChapters.mockRejectedValueOnce(
      Object.assign(new Error("changed"), { errorCode: "chapters_changed" }),
    );
    await expect(
      run({
        id: "recording-1",
        title: "Updated title",
        chaptersJson: JSON.stringify([demo]),
        expectedChapters: [intro],
      }),
    ).rejects.toMatchObject({ errorCode: "chapters_changed" });
    expect(state.patches).toEqual([]);
  });

  it("refuses chapters the player couldn't show", async () => {
    await expect(
      run({
        id: "recording-1",
        chaptersJson: JSON.stringify([{ startMs: 0, title: "" }]),
        expectedChapters: [],
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_chapters" });
    expect(mockSaveChapters).not.toHaveBeenCalled();
  });
});
