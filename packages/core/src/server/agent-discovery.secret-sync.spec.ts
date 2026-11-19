import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { discoverAgents } from "./agent-discovery.js";

vi.mock("../resources/store.js", () => ({
  resourceGet: vi.fn().mockResolvedValue(null),
  resourceListContentByOwnersAndPrefixes: vi.fn().mockResolvedValue([]),
  resourceList: vi.fn().mockResolvedValue([]),
  resourceListAccessible: vi.fn().mockResolvedValue([]),
  SHARED_OWNER: "__shared__",
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
}));

vi.mock("../settings/index.js", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  putSetting: vi.fn(),
}));

describe("secret sync workspace discovery", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("NETLIFY", undefined);
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["?token=value", "#fragment", "?", "#"])(
    "rejects a recipient URL with %s",
    async (suffix) => {
      await expect(
        discoverAgents("sender", {
          workspaceAppsManifest: [
            {
              id: "sibling",
              name: "Sibling",
              path: "/sibling",
              homePath: "/home",
              description: "",
              url: `https://workspace.example.test/sibling${suffix}`,
            },
          ],
          requireResolvableWorkspaceUrls: true,
        }),
      ).rejects.toThrow("Invalid workspace app URL: sibling");
    },
  );
});
