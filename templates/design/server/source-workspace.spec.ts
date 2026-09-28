import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveAccess: vi.fn(),
  hasCollabState: vi.fn(),
  getText: vi.fn(),
}));

vi.mock("@agent-native/core/collab", () => ({
  CollabBaseVersionConflictError: class extends Error {},
  applyText: vi.fn(),
  getText: mocks.getText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("./db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
  },
}));

import {
  readPreparedSourceText,
  readLiveSourceFile,
  resolveSourceWorkspace,
  SourceWorkspaceEditConflictError,
} from "./source-workspace.js";

const sourceFiles = [
  {
    id: "board-file",
    designId: "design-with-board",
    filename: "__board__.html",
    fileType: "html",
    content: "<html><body><div>Board</div></body></html>",
    createdAt: null,
    updatedAt: null,
  },
  {
    id: "screen-file",
    designId: "design-with-board",
    filename: "index.html",
    fileType: "html",
    content: "<html><body><div>Screen</div></body></html>",
    createdAt: null,
    updatedAt: null,
  },
];

describe("resolveSourceWorkspace", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.resolveAccess.mockReset().mockResolvedValue(null);
    mocks.hasCollabState.mockReset().mockResolvedValue(false);
    mocks.getText.mockReset().mockResolvedValue("");
  });

  it("fails closed when live collaboration content cannot be verified", async () => {
    mocks.hasCollabState.mockResolvedValue(true);
    mocks.getText.mockRejectedValue(new Error("collaboration unavailable"));

    await expect(readLiveSourceFile(sourceFiles[1])).rejects.toBeInstanceOf(
      SourceWorkspaceEditConflictError,
    );
    await expect(readLiveSourceFile(sourceFiles[1])).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("fails closed when live collaboration returns a non-string snapshot", async () => {
    mocks.hasCollabState.mockResolvedValue(true);
    mocks.getText.mockResolvedValue(42);

    await expect(readLiveSourceFile(sourceFiles[1])).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("maps malformed prepared collaboration documents to a typed conflict", () => {
    let rejection: unknown;
    try {
      readPreparedSourceText({
        doc: {
          getText: () => {
            throw new Error("malformed Y.Map root");
          },
        } as never,
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(SourceWorkspaceEditConflictError);
    expect(rejection).toMatchObject({ statusCode: 409 });
  });

  it("returns a 404 action error when the design is missing or inaccessible", async () => {
    await expect(
      resolveSourceWorkspace("missing-design"),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "not_found",
      message: "Design not found",
      statusCode: 404,
    });
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAccess).toHaveBeenCalledWith(
      "design",
      "missing-design",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("includes the Board only for callers that opt in", async () => {
    const query = {
      from: vi.fn(),
      where: vi.fn().mockResolvedValue(sourceFiles),
    };
    query.from.mockReturnValue(query);
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(query),
    });
    mocks.resolveAccess.mockResolvedValue({
      role: "editor",
      resource: {
        data: JSON.stringify({
          sourceType: "inline",
          boardFileId: "board-file",
        }),
      },
    });

    const defaultWorkspace = await resolveSourceWorkspace("design-with-board");
    const linkedEditWorkspace = await resolveSourceWorkspace(
      "design-with-board",
      { includeContent: true, includeBoard: true },
    );

    expect(defaultWorkspace.files.map((file) => file.id)).toEqual([
      "screen-file",
    ]);
    expect(linkedEditWorkspace.files.map((file) => file.id)).toEqual([
      "board-file",
      "screen-file",
    ]);
    expect(linkedEditWorkspace.boardFileId).toBe("board-file");
  });
});
