import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

const configuredAuthOptions = vi.hoisted(() => ({ options: undefined as any }));

vi.mock("@agent-native/core/server", () => ({
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
  it("allows the exact recording-scoped batch path through auth middleware", async () => {
    await import("./auth");

    const publicPaths = (configuredAuthOptions.options as any).publicPaths;

    expect(publicPaths).toContain(
      "/api/session-replay/recordings/:recordingId/chunks",
    );
    expect(publicPaths).toContain(
      "/api/session-replay/recordings/:recordingId/chunks/:seq",
    );
    expect(publicPaths).not.toContain("/api/session-replay/recordings/*");
  });
});
