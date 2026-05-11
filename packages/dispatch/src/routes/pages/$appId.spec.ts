import { afterEach, describe, expect, it, vi } from "vitest";

const loadWorkspaceAppsManifestMock = vi.hoisted(() => vi.fn());
const getBuiltinAgentsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  loadWorkspaceAppsManifest: loadWorkspaceAppsManifestMock,
  getBuiltinAgents: getBuiltinAgentsMock,
}));

vi.mock("@agent-native/core/client", () => ({
  appPath: (path: string) => path,
  useActionQuery: () => ({ data: [] }),
}));

const captureRedirect = async (
  run: () => unknown,
): Promise<Response | null> => {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof Response ? err : null;
  }
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("dispatch /<appId> catch-all loader", () => {
  it("redirects /dispatch/dispatch to the overview", async () => {
    loadWorkspaceAppsManifestMock.mockReturnValue(null);
    getBuiltinAgentsMock.mockReturnValue([]);
    const { loader } = await import("./$appId.js");

    const response = await captureRedirect(() =>
      loader({ params: { appId: "dispatch" } } as any),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/overview");
  });

  it("prefers the workspace manifest entry when one matches", async () => {
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
    const { loader } = await import("./$appId.js");

    const response = await captureRedirect(() =>
      loader({ params: { appId: "todo" } } as any),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/todo");
  });

  it("falls back to the built-in template URL when no workspace manifest matches", async () => {
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
    const { loader } = await import("./$appId.js");

    const response = await captureRedirect(() =>
      loader({ params: { appId: "forms" } } as any),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("http://localhost:8084");
  });

  it("returns null (renders Page not found) when nothing matches", async () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);
    const { loader } = await import("./$appId.js");

    const response = await captureRedirect(() =>
      loader({ params: { appId: "unknown-app" } } as any),
    );

    expect(response).toBeNull();
  });
});
