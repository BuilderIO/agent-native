import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppStateMock = vi.hoisted(() => vi.fn());
const readAppStateForCurrentTabMock = vi.hoisted(() => vi.fn());
const getAssetRunMock = vi.hoisted(() => vi.fn());
const getGenerationRunRunMock = vi.hoisted(() => vi.fn());
const getGenerationSessionRunMock = vi.hoisted(() => vi.fn());
const getLibraryRunMock = vi.hoisted(() => vi.fn());
const listAssetsRunMock = vi.hoisted(() => vi.fn());
const listAuditRunsRunMock = vi.hoisted(() => vi.fn());
const listGenerationPresetsRunMock = vi.hoisted(() => vi.fn());
const listGenerationSessionsRunMock = vi.hoisted(() => vi.fn());
const listLibrariesRunMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: readAppStateMock,
  readAppStateForCurrentTab: readAppStateForCurrentTabMock,
}));

vi.mock("./get-asset.js", () => ({
  default: { run: getAssetRunMock },
}));

vi.mock("./get-generation-run.js", () => ({
  default: { run: getGenerationRunRunMock },
}));

vi.mock("./get-generation-session.js", () => ({
  default: { run: getGenerationSessionRunMock },
}));

vi.mock("./get-library.js", () => ({
  default: { run: getLibraryRunMock },
}));

vi.mock("./list-assets.js", () => ({
  default: { run: listAssetsRunMock },
}));

vi.mock("./list-audit-runs.js", () => ({
  default: { run: listAuditRunsRunMock },
}));

vi.mock("./list-generation-presets.js", () => ({
  default: { run: listGenerationPresetsRunMock },
}));

vi.mock("./list-generation-sessions.js", () => ({
  default: { run: listGenerationSessionsRunMock },
}));

vi.mock("./list-libraries.js", () => ({
  default: { run: listLibrariesRunMock },
}));

import action from "./view-screen.js";

describe("view-screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readAppStateMock.mockResolvedValue(null);
  });

  it("keeps navigation context when the current library cannot be loaded", async () => {
    readAppStateForCurrentTabMock.mockResolvedValue({
      view: "library",
      libraryId: "lib-missing",
      activeTab: "settings",
    });
    getLibraryRunMock.mockRejectedValue(
      new Error("Asset library not found or not accessible."),
    );
    const ctx = {
      caller: "tool" as const,
      userEmail: "designer@example.com",
      orgId: "org-1",
    };

    const result = await action.run({}, ctx);

    expect(getLibraryRunMock).toHaveBeenCalledWith({ id: "lib-missing" }, ctx);
    expect(result).toMatchObject({
      navigation: {
        view: "library",
        libraryId: "lib-missing",
        activeTab: "settings",
      },
      errors: {
        library: "Asset library not found or not accessible.",
      },
    });
    expect(listGenerationPresetsRunMock).not.toHaveBeenCalled();
    expect(listGenerationSessionsRunMock).not.toHaveBeenCalled();
  });

  it("returns dependent library details when the current library loads", async () => {
    readAppStateForCurrentTabMock.mockResolvedValue({
      view: "library",
      libraryId: "lib-1",
    });
    getLibraryRunMock.mockResolvedValue({
      library: { id: "lib-1", title: "Launch kit" },
    });
    listGenerationPresetsRunMock.mockResolvedValue({
      count: 1,
      presets: [{ id: "preset-1" }],
    });
    listGenerationSessionsRunMock.mockResolvedValue({
      count: 0,
      sessions: [],
    });

    const result = await action.run({});

    expect(result).toMatchObject({
      navigation: {
        view: "library",
        libraryId: "lib-1",
      },
      library: {
        library: { id: "lib-1", title: "Launch kit" },
      },
      generationPresets: {
        count: 1,
        presets: [{ id: "preset-1" }],
      },
      generationSessions: {
        count: 0,
        sessions: [],
      },
    });
    expect(result).not.toHaveProperty("errors");
  });
});
