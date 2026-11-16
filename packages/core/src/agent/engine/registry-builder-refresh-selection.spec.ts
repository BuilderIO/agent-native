import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/builder-oauth.js", () => ({
  BUILDER_OAUTH_SCOPE: "builder:ai:invoke",
  resolveBuilderOAuthRequestAccessState: vi.fn(),
}));

describe("automatic engine selection during a Builder refresh outage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("AGENT_ENGINE", undefined);
    vi.stubEnv("AGENT_ENGINE_PREFER_BYO_KEY", undefined);
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", undefined);
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", undefined);
  });

  it.each([
    ["fast", true],
    ["general", true],
    ["fast", false],
    ["general", false],
  ] as const)(
    "uses the available provider, or Builder for retry, in the %s path (alternate=%s)",
    async (path, hasAlternate) => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestContext: () => ({ orgScope: "personal" }),
        getRequestUserEmail: () => "member@example.test",
        getRequestOrgId: () => undefined,
      }));
      vi.doMock("../default-agent-engine.js", async (original) => ({
        ...(await original<typeof import("../default-agent-engine.js")>()),
        readDefaultAgentEngineSetting: vi.fn(async () => null),
      }));
      vi.doMock("../app-model-defaults.js", async (original) => ({
        ...(await original<typeof import("../app-model-defaults.js")>()),
        getAgentAppModelDefaultForCurrentRequest: vi.fn(async () => null),
      }));
      const readAppSecret = vi.fn(
        async ({ key }: { key: string; scope?: string; scopeId?: string }) =>
          hasAlternate && key === "ANTHROPIC_API_KEY"
            ? { key, value: "test-provider-key" }
            : null,
      );
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret,
        readAppSecrets: async ({
          keys,
          scope,
          scopeId,
        }: {
          keys: string[];
          scope: string;
          scopeId: string;
        }) => {
          const entries = await Promise.all(
            keys.map(async (key) => {
              const secret = await readAppSecret({ key, scope, scopeId });
              return secret ? ([key, secret] as const) : null;
            }),
          );
          return new Map(entries.filter((entry) => entry !== null));
        },
      }));
      vi.doMock("../../server/credential-provider.js", async (original) => ({
        ...(await original<
          typeof import("../../server/credential-provider.js")
        >()),
        getProviderCredentialAuthFailure: vi.fn(async () => null),
        canUseDeployCredentialFallbackForRequest: vi.fn(() => false),
        resolveBuilderGatewayCredentialsDetailed: vi.fn(async () => ({
          privateKey: null,
          publicKey: null,
          source: null,
          lookupFailed: false,
        })),
      }));
      const { McpOAuthRefreshUnavailableError } =
        await import("../../mcp-client/oauth-client.js");
      const oauth = await import("../../server/builder-oauth.js");
      vi.mocked(oauth.resolveBuilderOAuthRequestAccessState).mockRejectedValue(
        new McpOAuthRefreshUnavailableError(),
      );
      const { registerAgentEngine, resolveEngine } =
        await import("./registry.js");
      const builder = {
        name: "builder",
        label: "Builder",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["BUILDER_PRIVATE_KEY"],
        create: vi.fn(() => ({ name: "builder", defaultModel: "m" }) as any),
      };
      const other = {
        name: "anthropic",
        label: "Anthropic",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["ANTHROPIC_API_KEY"],
        create: vi.fn(() => ({ name: "anthropic", defaultModel: "m" }) as any),
      };
      if (path === "general")
        registerAgentEngine({ ...other, name: "missing", requiredEnvVars: [] });
      registerAgentEngine(builder);
      registerAgentEngine(other);

      const expected = hasAlternate ? "anthropic" : "builder";
      expect((await resolveEngine({})).name).toBe(expected);
      expect(oauth.resolveBuilderOAuthRequestAccessState).toHaveBeenCalledWith({
        ownerEmail: "member@example.test",
        orgId: null,
        requiredScope: "builder:ai:invoke",
      });
    },
  );
});
