import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  buildDesignSnapshot: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: (args: {
    app: string;
    view: string;
    params?: Record<string, string>;
  }) =>
    `/_agent-native/open?app=${args.app}&view=${args.view}&designId=${args.params?.designId ?? ""}`,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
  registerShareableResource: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  schema: { designs: {} },
}));

vi.mock("../server/lib/design-snapshot.js", () => ({
  buildDesignSnapshot: mocks.buildDesignSnapshot,
}));

import action from "./get-design-snapshot.js";

describe("get-design-snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue({
      resource: {
        id: "design_123",
        title: "Todo app",
        description: null,
        projectType: "web",
        designSystemId: null,
        updatedAt: "2026-07-01T00:00:00.000Z",
        data: "{}",
      },
    });
    mocks.buildDesignSnapshot.mockResolvedValue({
      designId: "design_123",
      files: [
        {
          id: "file-a",
          filename: "variant-a.html",
          fileType: "html",
          content: "<html>A</html>",
          source: "stored",
        },
        {
          id: "file-b",
          filename: "variant-b.html",
          fileType: "html",
          content: "<html>B</html>",
          source: "collab",
        },
      ],
      tweaks: [],
      appliedTweaks: {},
      resolvedCssVars: {},
    });
  });

  it("returns only the requested file id for bounded variant follow-ups", async () => {
    const result = await action.run({
      designId: "design_123",
      fileId: "file-b",
    });

    expect(result.fileCount).toBe(1);
    expect(result.totalFileCount).toBe(2);
    expect(result.files).toEqual([
      {
        id: "file-b",
        filename: "variant-b.html",
        fileType: "html",
        content: "<html>B</html>",
        source: "collab",
      },
    ]);
    expect(result.editTarget).toEqual({
      designId: "design_123",
      fileId: "file-b",
      filename: "variant-b.html",
    });
    expect(result.nextRequiredAction).toContain(
      "Call edit-design exactly once",
    );
    expect(result.nextRequiredAction).toContain("fileId file-b");
    expect(result.nextRequiredAction).toContain(
      "Do not call delete-file or get-design-snapshot again",
    );
  });

  it("can filter by filename when the file id is unavailable", async () => {
    const result = await action.run({
      designId: "design_123",
      filename: "variant-a.html",
    });

    expect(result.fileCount).toBe(1);
    expect(result.files[0]).toMatchObject({
      id: "file-a",
      filename: "variant-a.html",
    });
  });

  it("prefers fileId over filename when both are provided", async () => {
    const result = await action.run({
      designId: "design_123",
      fileId: "file-b",
      filename: "stale-name.html",
    });

    expect(result.fileCount).toBe(1);
    expect(result.files[0]).toMatchObject({
      id: "file-b",
      filename: "variant-b.html",
    });
  });

  it("fails loudly when filename fallback matches multiple files", async () => {
    mocks.buildDesignSnapshot.mockResolvedValue({
      designId: "design_123",
      files: [
        {
          id: "file-a",
          filename: "duplicate.html",
          fileType: "html",
          content: "<html>A</html>",
          source: "stored",
        },
        {
          id: "file-b",
          filename: "duplicate.html",
          fileType: "html",
          content: "<html>B</html>",
          source: "stored",
        },
      ],
      tweaks: [],
      appliedTweaks: {},
      resolvedCssVars: {},
    });

    await expect(
      action.run({
        designId: "design_123",
        filename: "duplicate.html",
      }),
    ).rejects.toMatchObject({
      message: "Multiple design files match filename; pass fileId instead",
      statusCode: 409,
    });
  });

  it("fails loudly when a requested file is missing", async () => {
    await expect(
      action.run({
        designId: "design_123",
        fileId: "missing-file",
      }),
    ).rejects.toMatchObject({
      message: "Design file not found",
      statusCode: 404,
    });
  });
});
