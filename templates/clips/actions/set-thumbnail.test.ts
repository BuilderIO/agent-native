import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  uploadFile: vi.fn(),
  deleteSuperseded: vi.fn(),
  row: {} as Record<string, unknown>,
  updateSet: vi.fn(),
  updateRows: [] as unknown[][],
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
}));
vi.mock("../server/lib/upload-recording-media.js", () => ({
  uploadRecordingMedia: (...args: unknown[]) => mocks.uploadFile(...args),
}));
vi.mock("../server/lib/video-storage.js", () => ({
  requiresConfiguredVideoStorage: () => false,
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  isNull: (...args: unknown[]) => args,
  ne: (...args: unknown[]) => args,
  or: (...args: unknown[]) => args,
}));
vi.mock("../server/lib/recording-media-cleanup.js", () => ({
  deleteSupersededHostedMedia: (...args: unknown[]) =>
    mocks.deleteSuperseded(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
}));
vi.mock("../server/db/index.js", () => ({
  schema: {
    recordings: {
      id: "recordings.id",
      editsJson: "recordings.editsJson",
      failureCode: "recordings.failureCode",
    },
  },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [mocks.row],
      }),
    }),
    update: mocks.update,
  }),
}));

import action from "./set-thumbnail";

const screenshotRow = {
  id: "shot-1",
  kind: "image",
  imageUrl: "https://store.example/shot.png",
  thumbnailUrl: "https://store.example/shot.png",
};
const hostedRow = {
  id: "rec-1",
  storageMode: "hosted",
  failureCode: null,
  editsJson: null,
  thumbnailUrl: "https://bucket.example/clips/rec-1/old.png",
  animatedThumbnailUrl: "https://bucket.example/clips/rec-1/old.gif",
};

describe("set-thumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.row = screenshotRow;
    mocks.updateRows = [[{ id: "rec-1" }]];
    mocks.update.mockImplementation(() => ({
      set: (value: unknown) => {
        mocks.updateSet(value);
        return {
          where: () => ({
            returning: async () => mocks.updateRows.shift() ?? [],
          }),
        };
      },
    }));
    mocks.uploadFile.mockResolvedValue({
      url: "https://bucket.example/clips/rec-1/new.png",
    });
  });

  it("refuses a screenshot, whose thumbnail is the picture viewers see", async () => {
    await expect(
      (action as any).run({
        recordingId: "shot-1",
        kind: "upload",
        dataUrl: "data:image/png;base64,AAAA",
      }),
    ).rejects.toThrow(/own picture as its thumbnail/);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("deletes the hosted thumbnail a successful upload replaced", async () => {
    mocks.row = hostedRow;

    await (action as any).run({
      recordingId: "rec-1",
      kind: "upload",
      dataUrl: "data:image/png;base64,AAAA",
    });

    expect(mocks.deleteSuperseded).toHaveBeenCalledWith(
      hostedRow.thumbnailUrl,
      {
        recordingId: "rec-1",
        replacementUrl: "https://bucket.example/clips/rec-1/new.png",
      },
    );
  });

  it("deletes the hosted animated thumbnail a gif replaced", async () => {
    mocks.row = hostedRow;
    mocks.uploadFile.mockResolvedValue({
      url: "https://bucket.example/clips/rec-1/new.gif",
    });

    await (action as any).run({
      recordingId: "rec-1",
      kind: "gif",
      dataUrl: "data:image/gif;base64,AAAA",
    });

    expect(mocks.deleteSuperseded).toHaveBeenCalledWith(
      hostedRow.animatedThumbnailUrl,
      {
        recordingId: "rec-1",
        replacementUrl: "https://bucket.example/clips/rec-1/new.gif",
      },
    );
  });

  it("rejects a taken-down recording before uploading anything", async () => {
    mocks.row = { ...hostedRow, failureCode: "taken_down" };

    await expect(
      (action as any).run({
        recordingId: "rec-1",
        kind: "upload",
        dataUrl: "data:image/png;base64,AAAA",
      }),
    ).rejects.toThrow(/removed from hosted Clips storage/);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("removes its upload when a takedown lands before the write", async () => {
    mocks.row = hostedRow;
    mocks.updateRows = [[]];
    mocks.update.mockImplementationOnce(() => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            // The fenced write matched nothing: takedown won the race.
            mocks.row = { ...hostedRow, failureCode: "taken_down" };
            return [];
          },
        }),
      }),
    }));

    await expect(
      (action as any).run({
        recordingId: "rec-1",
        kind: "upload",
        dataUrl: "data:image/png;base64,AAAA",
      }),
    ).rejects.toThrow(/removed from hosted Clips storage/);
    expect(mocks.deleteSuperseded).toHaveBeenCalledWith(
      "https://bucket.example/clips/rec-1/new.png",
      { recordingId: "rec-1" },
    );
  });
});
