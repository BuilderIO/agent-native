import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  uploadFile: vi.fn(),
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
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
}));
vi.mock("../server/db/index.js", () => ({
  schema: { recordings: { id: "recordings.id" } },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [
          {
            id: "shot-1",
            kind: "image",
            imageUrl: "https://store.example/shot.png",
            thumbnailUrl: "https://store.example/shot.png",
          },
        ],
      }),
    }),
    update: mocks.update,
  }),
}));

import action from "./set-thumbnail";

describe("set-thumbnail", () => {
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
});
