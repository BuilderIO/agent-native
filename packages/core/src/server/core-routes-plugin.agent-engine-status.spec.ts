import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

const secretReads = vi.hoisted(() => ({
  readAppSecret: vi.fn(),
  readAppSecrets: vi.fn(),
}));

vi.mock("../secrets/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../secrets/storage.js")>()),
  readAppSecret: (...args: any[]) => secretReads.readAppSecret(...args),
  readAppSecrets: (...args: any[]) => secretReads.readAppSecrets(...args),
}));

vi.mock("../deploy/route-discovery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../deploy/route-discovery.js")>()),
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

vi.mock("../agent/default-agent-engine.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../agent/default-agent-engine.js")
  >()),
  readDefaultAgentEngineSetting: vi.fn(async () => null),
}));

vi.mock("../agent/app-model-defaults.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/app-model-defaults.js")>()),
  readAgentAppModelDefaultSettings: vi.fn(async () => null),
}));

vi.mock("./builder-oauth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./builder-oauth.js")>()),
  hasUsableBuilderOAuthSessionForReadiness: vi.fn(async () => false),
}));

vi.mock("./personal-provider-key-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./personal-provider-key-policy.js")
  >()),
  isPersonalProviderKeyUseRestricted: vi.fn(async () => false),
}));

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { getOrgContext } from "../org/context.js";
import { AppSecretDecryptionError } from "../secrets/errors.js";
import { getSession } from "./auth.js";
import {
  createCoreRoutesPlugin,
  resolveAgentEngineStatusIdentity,
  resolveAgentEngineStatus,
  type AgentEngineStatusDeps,
  type AgentEngineStatusResult,
} from "./core-routes-plugin.js";

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  getOrgContext: vi.fn(),
}));

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getSession: vi.fn(),
}));
import { runWithRequestContext } from "./request-context.js";

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(nitroApp: any, url: string) {
  const request = new Request(url);
  const responseHeaders = new Headers();
  const event = {
    method: "GET",
    url: new URL(url),
    path: new URL(url).pathname,
    context: {},
    req: request,
    headers: request.headers,
    res: { status: 200, headers: responseHeaders },
    node: {
      req: { method: "GET", url: new URL(url).pathname, headers: {} },
      res: {
        statusCode: 200,
        setHeader(name: string, value: string) {
          responseHeaders.set(name, value);
        },
      },
    },
  };

  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };

  const body = await next();
  return { body, status: event.res.status ?? event.node.res.statusCode };
}

type TestEntry = {
  name: string;
  defaultModel: string;
  supportedModels: readonly string[];
  requiredEnvVars: readonly string[];
};

const openAiEntry: TestEntry = {
  name: "ai-sdk:openai",
  defaultModel: "gpt-5",
  supportedModels: ["gpt-5"],
  requiredEnvVars: ["OPENAI_API_KEY"],
};

const builderEntry: TestEntry = {
  name: "builder",
  defaultModel: "gpt-5",
  supportedModels: ["gpt-5"],
  requiredEnvVars: ["BUILDER_GATEWAY_TOKEN", "BUILDER_GATEWAY_SPACE_ID"],
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createDeps(
  overrides: Partial<AgentEngineStatusDeps<TestEntry>> = {},
): AgentEngineStatusDeps<TestEntry> {
  return {
    readStoredEngine: async () => null,
    readOpenAiBaseUrlConfigured: () => false,
    isStoredEngineUsable: () => true,
    detectFromUserSecrets: async () => null,
    detectFromEnv: () => null,
    lookupEntry: () => openAiEntry,
    ...overrides,
  };
}

const originalAgentEngine = process.env.AGENT_ENGINE;
const originalNodeEnv = process.env.NODE_ENV;
const originalLambdaFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;

afterEach(() => {
  resetAppConfigForTests();
  if (originalAgentEngine === undefined) delete process.env.AGENT_ENGINE;
  else process.env.AGENT_ENGINE = originalAgentEngine;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalLambdaFunctionName === undefined)
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  else process.env.AWS_LAMBDA_FUNCTION_NAME = originalLambdaFunctionName;
  secretReads.readAppSecret.mockReset().mockResolvedValue(null);
  secretReads.readAppSecrets.mockReset().mockResolvedValue(new Map());
  vi.mocked(getOrgContext).mockReset();
  vi.mocked(getSession).mockReset();
});

describe("resolveAgentEngineStatusIdentity", () => {
  it("propagates session lookup failures", async () => {
    vi.mocked(getSession).mockRejectedValue(new Error("session read failed"));

    await expect(resolveAgentEngineStatusIdentity({} as never)).rejects.toThrow(
      "session read failed",
    );
  });

  it("propagates organization lookup failures", async () => {
    vi.mocked(getSession).mockResolvedValue({
      email: "alice@example.com",
    } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(getOrgContext).mockRejectedValue(
      new Error("organization read failed"),
    );

    await expect(resolveAgentEngineStatusIdentity({} as never)).rejects.toThrow(
      "organization read failed",
    );
  });

  it("tolerates only an unavailable organization schema", async () => {
    vi.mocked(getSession).mockResolvedValue({
      email: "alice@example.com",
    } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(getOrgContext).mockRejectedValue(
      new Error('no such table: "organizations"'),
    );

    await expect(
      resolveAgentEngineStatusIdentity({} as never),
    ).resolves.toEqual({ userEmail: "alice@example.com", orgId: undefined });
  });

  it("marks only a successfully resolved org-less identity as personal", async () => {
    vi.mocked(getSession).mockResolvedValue({
      email: "alice@example.com",
    } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(getOrgContext).mockResolvedValue({
      email: "alice@example.com",
      orgId: null,
    } as Awaited<ReturnType<typeof getOrgContext>>);

    await expect(
      resolveAgentEngineStatusIdentity({} as never),
    ).resolves.toEqual({
      userEmail: "alice@example.com",
      orgId: undefined,
      orgScope: "personal",
    });
  });
});

describe("agent-engine/status route failure handling", () => {
  it("answers a failed lookup with 503, never a 200 that claims nothing is configured", () => {
    const source = readFileSync(
      new URL("./core-routes-plugin.ts", import.meta.url),
      "utf8",
    );
    const handler = source.slice(source.indexOf("`${P}/agent-engine/status`"));
    const body = handler.slice(0, handler.indexOf("${P}/track"));

    expect(body).toContain("setResponseStatus(event, 503)");
    expect(body).toContain("memoizeAgentEngineStatus(");
    expect(body).not.toContain("getForwardedRequestOrigin(event)");
    expect(body).toContain(
      "const directLoopbackRequest = isDirectLoopbackRequest(event)",
    );
    expect(body).toContain('`http://${getHeader(event, "host")}`');
    expect(body).toContain("isLoopbackRequest: isLoopbackRequest(event)");
    expect(body).toContain("isDirectLoopbackRequest: directLoopbackRequest");
    expect(body).toContain("orgScope,");
    expect(body).not.toContain("shareAgentEngineStatusLookup");
    expect(body).not.toMatch(
      /catch\s*(\([^)]*\))?\s*\{[^}]*\}\s*return\s*\{\s*configured:\s*false/,
    );
  });

  it("returns unavailable when a saved Builder credential cannot be decrypted", async () => {
    const email = "member@example.test";
    defineAppConfig({ agent: { engine: "builder" } });
    process.env.NODE_ENV = "production";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "agent-engine-status-test";
    vi.mocked(getSession).mockResolvedValue({
      email,
      token: "session-token",
      emailVerified: true,
    } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(getOrgContext).mockResolvedValue({
      email,
      orgId: "org-1",
      role: "owner",
    } as Awaited<ReturnType<typeof getOrgContext>>);
    secretReads.readAppSecrets.mockImplementation(async ({ scope, keys }) => {
      if (scope === "org" && keys.includes("BUILDER_PRIVATE_KEY")) {
        throw new AppSecretDecryptionError();
      }
      return new Map();
    });

    const nitroApp = createNitroApp();
    await createCoreRoutesPlugin()(nitroApp);

    await expect(
      dispatch(
        nitroApp,
        "https://forms.example.test/_agent-native/agent-engine/status",
      ),
    ).resolves.toEqual({
      status: 503,
      body: { error: "Could not read the agent engine configuration." },
    });
    expect(secretReads.readAppSecrets).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "org",
        scopeId: "org-1",
        keys: expect.arrayContaining(["BUILDER_PRIVATE_KEY"]),
      }),
    );
  });
});

describe("resolveAgentEngineStatus", () => {
  it("reports configured engine and model before stored defaults", async () => {
    defineAppConfig({
      agent: { engine: "ai-sdk:openai", model: "configured-model" },
    });
    const entry = {
      ...openAiEntry,
      supportedModels: ["gpt-5", "configured-model"],
    };
    const result = await resolveAgentEngineStatus(
      createDeps({
        readStoredEngine: async () => ({
          engine: "stored-engine",
          model: "gpt-5",
        }),
        readAppDefault: async () => ({
          engine: "app-engine",
          model: "app-model",
        }),
        lookupEntry: () => entry,
      }),
    );
    expect(result).toMatchObject({
      engine: "ai-sdk:openai",
      model: "configured-model",
      source: "env",
    });
  });

  it("uses an app's model when configuration pins only the same engine", async () => {
    defineAppConfig({ agent: { engine: "ai-sdk:openai" } });
    const entry = { ...openAiEntry, supportedModels: ["gpt-5", "app-model"] };
    const result = await resolveAgentEngineStatus(
      createDeps({
        readStoredEngine: async () => ({
          engine: "ai-sdk:openai",
          model: "gpt-5",
        }),
        readAppDefault: async () => ({
          engine: "ai-sdk:openai",
          model: "app-model",
        }),
        lookupEntry: () => entry,
      }),
    );
    expect(result).toMatchObject({
      engine: "ai-sdk:openai",
      model: "app-model",
    });
  });

  it("reports the app override instead of the organization default", async () => {
    delete process.env.AGENT_ENGINE;
    const appEntry = {
      ...openAiEntry,
      name: "app-engine",
      defaultModel: "app-model",
      supportedModels: ["app-model"],
    };
    const result = await resolveAgentEngineStatus(
      createDeps({
        readStoredEngine: async () => ({
          engine: "ai-sdk:openai",
          model: "gpt-5",
        }),
        readAppDefault: async () => ({
          engine: "app-engine",
          model: "app-model",
        }),
        lookupEntry: (name) => (name === "app-engine" ? appEntry : openAiEntry),
      }),
    );
    expect(result).toMatchObject({
      engine: "app-engine",
      model: "app-model",
      source: "app-default",
    });
  });

  it("does not turn an unreadable app default into a successful status", async () => {
    delete process.env.AGENT_ENGINE;
    await expect(
      resolveAgentEngineStatus(
        createDeps({
          readAppDefault: async () => {
            throw new Error("app default unreadable");
          },
        }),
      ),
    ).rejects.toThrow("app default unreadable");
  });

  it("starts the stored-setting and base-URL lookups concurrently", async () => {
    delete process.env.AGENT_ENGINE;
    const stored = deferred<{ engine?: string; model?: string } | null>();
    const baseUrl = deferred<boolean>();
    const started: string[] = [];

    const result = resolveAgentEngineStatus(
      createDeps({
        readStoredEngine: () => {
          started.push("stored");
          return stored.promise;
        },
        readOpenAiBaseUrlConfigured: () => {
          started.push("baseUrl");
          return baseUrl.promise;
        },
      }),
    );

    expect(started).toEqual(["stored", "baseUrl"]);

    stored.resolve({ engine: "ai-sdk:openai" });
    baseUrl.resolve(true);
    await expect(result).resolves.toMatchObject({
      configured: true,
      engine: "ai-sdk:openai",
      openAiBaseUrlConfigured: true,
    });
  });

  it("skips the app_secrets sweep when the stored engine already answers", async () => {
    delete process.env.AGENT_ENGINE;
    let sweeps = 0;

    const result = await resolveAgentEngineStatus(
      createDeps({
        readStoredEngine: async () => ({ engine: "ai-sdk:openai" }),
        detectFromUserSecrets: async () => {
          sweeps += 1;
          return null;
        },
      }),
    );

    expect(result.configured).toBe(true);
    expect(sweeps).toBe(0);
  });

  it("still sweeps app_secrets when no cheaper source answers", async () => {
    delete process.env.AGENT_ENGINE;

    const result = await resolveAgentEngineStatus(
      createDeps({
        detectFromUserSecrets: async () => openAiEntry,
      }),
    );

    expect(result).toMatchObject({
      configured: true,
      engine: "ai-sdk:openai",
      source: "app_secrets",
      envVar: "OPENAI_API_KEY",
    });
  });

  it("reports the resolved base-URL flag even when nothing is configured", async () => {
    delete process.env.AGENT_ENGINE;

    await expect(
      resolveAgentEngineStatus(
        createDeps({ readOpenAiBaseUrlConfigured: () => true }),
      ),
    ).resolves.toEqual({ configured: false, openAiBaseUrlConfigured: true });
  });

  it("lets synthetic checks fall through an unusable deploy engine to user secrets", async () => {
    process.env.AGENT_ENGINE = "builder";

    const result = await runWithRequestContext(
      { isSyntheticTraffic: true },
      () =>
        resolveAgentEngineStatus(
          createDeps({
            lookupEntry: (name) =>
              name === "builder" ? builderEntry : openAiEntry,
            isStoredEngineUsable: (stored) =>
              (stored as { engine?: string }).engine !== "builder",
            detectFromUserSecrets: async () => openAiEntry,
          }),
        ),
    );

    expect(result).toMatchObject({
      configured: true,
      engine: "ai-sdk:openai",
      source: "app_secrets",
    });
  });
});
