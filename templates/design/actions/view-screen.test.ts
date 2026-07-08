import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);

  return {
    getDb: vi.fn(() => ({
      select: vi.fn(() => selectChain),
    })),
    parseCanvasFrameGeometryById: vi.fn((value) => value ?? []),
    readAppState: vi.fn(),
    readAppStateForCurrentTab: vi.fn(),
    resolveAccess: vi.fn(),
    eq: vi.fn((left, right) => ({ left, right })),
    selectChain,
  };
});

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: {
      id: "designFiles.id",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      updatedAt: "designFiles.updatedAt",
      designId: "designFiles.designId",
    },
  },
}));

vi.mock("../shared/canvas-frames.js", () => ({
  parseCanvasFrameGeometryById: mocks.parseCanvasFrameGeometryById,
}));

import action from "./view-screen.js";

describe("view-screen", () => {
  beforeEach(() => {
    mocks.readAppState.mockReset();
    mocks.readAppStateForCurrentTab.mockReset();
    mocks.resolveAccess.mockReset();
    mocks.selectChain.where.mockReset();
    mocks.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        title: "Shared checkout",
        data: '{"canvasFrames":[]}',
      },
    });
    mocks.readAppState.mockResolvedValue(undefined);
  });

  it("uses active file before overview multi-selection", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "overview",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "overview",
        activeFileId: "file_index",
        activeFilename: "index.html",
        selectedScreenIds: ["file_checkout"],
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toMatchObject({
      id: "file_index",
      filename: "index.html",
    });
  });

  it("uses selected overview screen ids when no focused file is available", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "overview",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "overview",
        selectedScreenIds: ["file_checkout"],
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toMatchObject({
      id: "file_checkout",
      filename: "checkout.html",
    });
  });

  it("uses navigation targets when selection state is not active yet", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
        filename: "checkout.html",
      })
      .mockResolvedValueOnce(null);
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toMatchObject({
      id: "file_checkout",
      filename: "checkout.html",
    });
  });

  it("falls back to index.html for single-screen public views without selection", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "present",
        designId: "design_123",
      })
      .mockResolvedValueOnce(null);
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_settings",
        filename: "settings.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toMatchObject({
      id: "file_index",
      filename: "index.html",
    });
  });
});
