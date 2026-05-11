import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadWorkspaceAppsManifestMock = vi.hoisted(() => vi.fn());
const getBuiltinAgentsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  loadWorkspaceAppsManifest: loadWorkspaceAppsManifestMock,
  getBuiltinAgents: getBuiltinAgentsMock,
}));

import { resolveCatchAllTarget } from "./catch-all-target.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveCatchAllTarget", () => {
  it("prefers the workspace manifest entry when one matches", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "todo", name: "Todo", path: "/todo" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([
      {
        id: "todo",
        name: "Todo",
        description: "",
        url: "https://todo.example.com",
        color: "#000",
      },
    ]);

    expect(resolveCatchAllTarget("todo")).toBe("/todo");
  });

  it("falls back to the built-in template URL when no workspace manifest exists", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue(null);
    getBuiltinAgentsMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        description: "",
        url: "http://localhost:8084",
        color: "#06B6D4",
      },
    ]);

    expect(resolveCatchAllTarget("forms")).toBe("http://localhost:8084");
  });

  it("falls back to the built-in template URL when the workspace manifest does not include the app", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        description: "",
        url: "http://localhost:8084",
        color: "#06B6D4",
      },
    ]);

    expect(resolveCatchAllTarget("forms")).toBe("http://localhost:8084");
  });

  it("normalizes a manifest entry without a leading slash", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "todo", name: "Todo", path: "todo" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("todo")).toBe("/todo");
  });

  it("returns null when nothing matches", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("unknown-app")).toBeNull();
  });
});
