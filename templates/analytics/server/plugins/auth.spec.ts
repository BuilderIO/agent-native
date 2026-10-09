import { readFileSync } from "node:fs";

import { H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

const configuredAuthOptions = vi.hoisted(() => ({ options: undefined as any }));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  isInBackgroundFunctionRuntime: vi.fn(),
  markDefaultPluginProvided: vi.fn(),
}));

vi.mock("@agent-native/toolkit/app/auth/server", () => ({
  createToolkitAuthPlugin: (options: unknown) => {
    configuredAuthOptions.options = options;
    return vi.fn();
  },
}));

const authTsSource = readFileSync(
  new URL("./auth.ts", import.meta.url),
  "utf8",
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analytics auth plugin background startup", () => {
  it("keeps Better Auth out of durable background cold starts", () => {
    expect(authTsSource).toContain(
      'markDefaultPluginProvided(nitroApp, "auth")',
    );
    expect(authTsSource).toMatch(
      /if \(isInBackgroundFunctionRuntime\(\)\) \{[\s\S]*?return;\s*\}\s*await authPlugin\(/,
    );
  });
});

describe("Analytics session replay auth paths", () => {
  it("allows the batch route while keeping adjacent recording routes protected", async () => {
    vi.stubEnv("AUTH_DISABLED", "0");
    await import("./auth");
    const { autoMountAuth } = await import("@agent-native/core/server");

    const app: any = { use: vi.fn() };
    await autoMountAuth(app, configuredAuthOptions.options as any);
    expect(
      app.use.mock.calls.some(
        ([path]: [unknown]) => path === "/_agent-native/auth/ba",
      ),
    ).toBe(true);
    const guard = app.use.mock.calls
      .map((call: any[]) => call[0])
      .find((handler: unknown) => typeof handler === "function");
    expect(guard).toBeTypeOf("function");

    for (const path of [
      "/api/session-replay/recordings/sr_1/manifest?agent_access=token",
      "/api/session-replay/recordings/sr_1/chunks/0?agent_access=token",
      "/api/session-replay/recordings/sr_1/chunks?seqs=0&agent_access=token",
    ]) {
      await expect(
        guard(
          new H3Event(new Request(`https://analytics.example.test${path}`)),
        ),
      ).resolves.toBeUndefined();
    }

    for (const path of [
      "/api/session-replay/recordings/sr_1",
      "/api/session-replay/recordings/sr_1/events",
      "/api/session-replay/recordings/sr_1/chunks/0/raw",
    ]) {
      const event = new H3Event(
        new Request(`https://analytics.example.test${path}?agent_access=token`),
      );
      await expect(guard(event)).resolves.toEqual({ error: "Unauthorized" });
      expect(event.res.status).toBe(401);
    }
  });
});
