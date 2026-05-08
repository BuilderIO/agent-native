import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "@agent-native/core/server";
import { listWorkspaceApps } from "./app-creation-store.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("listWorkspaceApps", () => {
  it("prefers the live workspace gateway manifest when available", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          apps: [
            {
              id: "dispatch",
              name: "Agent-Native Dispatch",
              path: "/dispatch",
            },
            { id: "todo", name: "Todo", path: "/todo" },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "dispatch", name: "Dispatch", path: "/dispatch" }]),
    );

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    const [urlArg, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(urlArg)).toBe("http://127.0.0.1:8080/_workspace/apps");
    expect(init).toEqual(
      expect.objectContaining({
        headers: { accept: "application/json" },
      }),
    );
    expect(apps.map((app) => app.id)).toEqual(["dispatch", "todo"]);
  });
});
