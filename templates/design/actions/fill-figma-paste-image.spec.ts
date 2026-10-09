import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readLiveSourceFile: vi.fn(),
  writeInlineSourceFile: vi.fn(),
  mutateDesignData: vi.fn(),
  snapshotDesignBeforeAgentEdit: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  accessFilter: vi.fn(() => "access-filter-sentinel"),
}));

vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
}));

vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));

let dbRows: unknown[] = [];
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(dbRows),
          }),
        }),
      }),
    }),
  }),
  schema: {
    designFiles: {
      id: "id",
      designId: "designId",
      filename: "filename",
      fileType: "fileType",
      content: "content",
    },
    designs: { id: "id", data: "data" },
    designShares: {},
  },
}));

import action from "./fill-figma-paste-image.js";

const ONE_MISSING =
  '<div data-agent-native-layer-name="Robot arm" data-figma-image-ref="abc123" style="background-image: url(\'about:blank\'); background-size: cover;">x</div>';
const TWO_MISSING = [
  '<div data-figma-image-ref="h1" style="background-image: url(\'about:blank\');"></div>',
  '<div data-figma-image-ref="h2" style="background-image: url(\'about:blank\');"></div>',
].join("");
const UPLOADED = "https://cdn.example.com/robot.svg";

function useScreen(content: string) {
  dbRows = [
    {
      id: "file-1",
      designId: "design-1",
      filename: "Screen.html",
      fileType: "html",
      content,
      designData: JSON.stringify({ screenMetadata: { "file-1": {} } }),
    },
  ];
  mocks.readLiveSourceFile.mockResolvedValue({ content, versionHash: "v1" });
}

function writtenHtml(): string {
  return mocks.writeInlineSourceFile.mock.calls[0]![0].content as string;
}

describe("fill-figma-paste-image action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.writeInlineSourceFile.mockResolvedValue({ versionHash: "v2" });
    mocks.mutateDesignData.mockResolvedValue({ data: {}, updatedAt: "" });
  });

  it("fills the only missing image without a hash and keeps its scale mode", async () => {
    useScreen(ONE_MISSING);

    const result = await action.run({ fileId: "file-1", imageUrl: UPLOADED });

    expect(result).toEqual({
      fileId: "file-1",
      hash: "abc123",
      resolved: 1,
      missing: 0,
    });
    expect(writtenHtml()).toContain(
      `url('${UPLOADED}'); background-size: cover;`,
    );
    expect(writtenHtml()).not.toContain("data-figma-image-ref");
    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledTimes(1);
  });

  it("fills only the requested hash when several images are missing", async () => {
    useScreen(TWO_MISSING);

    const result = await action.run({
      fileId: "file-1",
      imageUrl: UPLOADED,
      hash: "h2",
    });

    expect(result).toMatchObject({ hash: "h2", resolved: 1, missing: 1 });
    expect(writtenHtml()).toContain('data-figma-image-ref="h1"');
    expect(writtenHtml()).toContain(`url('${UPLOADED}')`);
  });

  it("asks for a hash instead of guessing between several missing images", async () => {
    useScreen(TWO_MISSING);

    await expect(
      action.run({ fileId: "file-1", imageUrl: UPLOADED }),
    ).rejects.toMatchObject({
      errorCode: "hash_required",
      details: { hashes: ["h1", "h2"] },
    });
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("rejects a hash that is not missing on the screen", async () => {
    useScreen(ONE_MISSING);

    await expect(
      action.run({ fileId: "file-1", imageUrl: UPLOADED, hash: "nope" }),
    ).rejects.toMatchObject({ errorCode: "not_found", statusCode: 404 });
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("fails loudly when the screen has no missing images", async () => {
    useScreen("<div>done</div>");

    await expect(
      action.run({ fileId: "file-1", imageUrl: UPLOADED }),
    ).rejects.toMatchObject({ errorCode: "no_missing_images" });
  });

  it("fails loudly when the placeholder was edited away", async () => {
    useScreen(
      '<div data-figma-image-ref="abc123" style="background: red;"></div>',
    );

    await expect(
      action.run({ fileId: "file-1", imageUrl: UPLOADED }),
    ).rejects.toMatchObject({ errorCode: "placeholder_changed" });
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("rejects data URLs so image bytes stay out of the screen HTML", () => {
    const parsed = action.schema!.safeParse({
      fileId: "file-1",
      imageUrl: "data:image/png;base64,AAAA",
    });
    expect(parsed.success).toBe(false);
    expect(
      action.schema!.safeParse({
        fileId: "file-1",
        imageUrl: "/_agent-native/uploads/robot.svg",
      }).success,
    ).toBe(true);
  });
});
