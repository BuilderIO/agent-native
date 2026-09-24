import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  readLiveSourceFile: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: {
      designId: "designFiles.designId",
    },
  },
}));

vi.mock("../source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
}));

import { buildDesignSnapshot } from "./design-snapshot.js";

const file = {
  id: "screen-file",
  designId: "design-1",
  filename: "index.html",
  fileType: "html",
  content: "<html>stored</html>",
};

describe("buildDesignSnapshot", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.readLiveSourceFile.mockReset();

    const query = {
      from: vi.fn(),
      where: vi.fn().mockResolvedValue([file]),
    };
    query.from.mockReturnValue(query);
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(query),
    });
  });

  it("does not fall back to stale SQL when the live source cannot be read", async () => {
    mocks.readLiveSourceFile.mockRejectedValue(
      Object.assign(new Error("live collaboration unavailable"), {
        statusCode: 409,
      }),
    );

    await expect(buildDesignSnapshot("design-1")).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
