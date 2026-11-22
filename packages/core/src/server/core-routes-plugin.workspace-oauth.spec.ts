import { H3, type H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../deploy/route-discovery.js", async (original) => ({
  ...(await original<typeof import("../deploy/route-discovery.js")>()),
  getMissingDefaultPlugins: vi.fn(async () => []),
}));
vi.mock("./auth.js", async (original) => ({
  ...(await original<typeof import("./auth.js")>()),
  getSession: vi.fn(async () => null),
}));

import {
  getWorkspaceConnectionOAuth,
  listWorkspaceConnectionProviders,
} from "../connections/catalog.js";
import { createCoreRoutesPlugin } from "./core-routes-plugin.js";
import { WORKSPACE_PROVIDER_OAUTH_PROVIDERS } from "./workspace-provider-oauth.js";

afterEach(() => vi.unstubAllEnvs());

describe("workspace provider OAuth routes", () => {
  it("mounts start and callback handlers for every supported provider", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "oauth-routes-test");
    const middleware: Array<
      (event: H3Event, next: () => Promise<unknown>) => unknown
    > = [];
    const plugin = createCoreRoutesPlugin({
      disableHealth: true,
      disableAppState: true,
      disableEmbedRoute: true,
      disablePing: true,
    });
    await plugin({ h3: { "~middleware": middleware } } as Parameters<
      typeof plugin
    >[0]);
    const app = new H3();
    app.use((event: H3Event) => {
      let index = 0;
      const next = async (): Promise<unknown> => {
        const handler = middleware.at(index++);
        return handler ? handler(event, next) : undefined;
      };
      return next();
    });

    const providers = new Set([
      ...WORKSPACE_PROVIDER_OAUTH_PROVIDERS,
      ...listWorkspaceConnectionProviders()
        .filter((provider) => getWorkspaceConnectionOAuth(provider))
        .map((provider) => provider.id),
    ]);
    for (const provider of providers) {
      for (const phase of ["start", "callback"] as const) {
        const response = await app.fetch(
          new Request(
            `https://app.example.test/_agent-native/connections/oauth/${provider}/${phase}`,
          ),
        );
        expect(response.status, `${provider}/${phase}`).toBe(401);
        expect(await response.json()).toEqual({
          error: "Authentication required",
        });
      }
    }
  });
});
