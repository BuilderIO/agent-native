import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  generateWorkspaceAppDescription,
  listWorkspaceApps,
} from "./app-creation-store.js";

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
            {
              id: "todo",
              name: "Todo",
              description: "Tracks personal tasks and follow-ups",
              path: "/todo",
              audience: "public",
            },
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
    expect(apps.find((app) => app.id === "todo")?.description).toBe(
      "Tracks personal tasks and follow-ups",
    );
    expect(apps.find((app) => app.id === "todo")?.audience).toBe("public");
  });

  it("filters workspace apps by audience", async () => {
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([
        {
          id: "dispatch",
          name: "Dispatch",
          path: "/dispatch",
          audience: "internal",
        },
        {
          id: "portal",
          name: "Portal",
          path: "/portal",
          audience: "public",
        },
      ]),
    );

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () =>
        listWorkspaceApps({
          includeAgentCards: false,
          audience: "public",
        }),
    );

    expect(apps.map((app) => app.id)).toEqual(["portal"]);
  });

  it("generates a concise seed description from an app prompt", () => {
    expect(
      generateWorkspaceAppDescription(
        "Build me an app that tracks customer onboarding risks and handoffs",
        "customer-onboarding",
      ),
    ).toBe("Tracks customer onboarding risks and handoffs.");
  });
});
