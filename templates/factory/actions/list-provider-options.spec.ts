import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRequestMock = vi.hoisted(() => vi.fn());
const readScopeMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  isAgentConnectionRequiredError: (error: unknown) =>
    (error as { name?: string } | null)?.name ===
    "AgentConnectionRequiredError",
}));
vi.mock("../server/lib/provider-api.js", () => ({
  FACTORY_APP_ID: "factory",
  executeProviderApiRequest: executeRequestMock,
}));
vi.mock("../server/lib/workflow-read-actions.js", () => ({
  resolveWorkflowReadScope: readScopeMock,
}));

import action from "./list-provider-options.js";

const context = {
  caller: "frontend" as const,
  userEmail: "owner@example.test",
  actionName: "list-provider-options",
  signal: new AbortController().signal,
};

type Input = {
  factoryId?: string;
  provider: "slack" | "sentry" | "github";
  resource: string;
  parent?: string;
  search?: string;
  cursor?: string;
};

// `defineAction` is mocked to a pass-through, so the strict output check it applies is repeated here.
const run = async (input: Input): Promise<Record<string, any>> => {
  const definition = action as unknown as {
    run: (i: unknown, c: unknown) => Promise<unknown>;
    outputSchema: { parse: (result: unknown) => Record<string, any> };
  };
  return definition.outputSchema.parse(
    await definition.run({ factoryId: "f1", ...input }, context),
  );
};

interface Failure extends Error {
  errorCode: string;
  statusCode: number;
  retryable: boolean;
  details: Record<string, unknown>;
}

async function failureOf(call: Promise<unknown>): Promise<Failure> {
  try {
    await call;
  } catch (error) {
    return error as Failure;
  }
  throw new Error("Expected the call to fail.");
}

function answer(json: unknown, status = 200, headers: object = {}) {
  return {
    response: {
      status,
      ok: status >= 200 && status < 300,
      truncated: false,
      json,
      headers,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readScopeMock.mockResolvedValue({
    userEmail: "owner@example.test",
    orgId: "org-1",
  });
  executeRequestMock.mockResolvedValue(
    answer({
      ok: true,
      channels: [{ id: "C1", name: "general", is_member: true }],
      response_metadata: { next_cursor: "" },
    }),
  );
});

describe("list-provider-options", () => {
  it("is a read: a GET the agent can call", () => {
    const definition = action as unknown as {
      http: { method: string };
      readOnly: boolean;
    };
    expect(definition.http.method).toBe("GET");
    expect(definition.readOnly).toBe(true);
  });

  it("lists a provider's options through the shared provider runtime", async () => {
    const result = await run({ provider: "slack", resource: "channels" });
    expect(result).toEqual({
      provider: "slack",
      resource: "channels",
      options: [{ value: "C1", label: "#general", hint: "C1" }],
    });
    expect(readScopeMock).toHaveBeenCalledWith("f1", context);
    expect(executeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "slack",
        method: "GET",
        path: "/conversations.list",
      }),
    );
  });

  it("lists Sentry projects inside the organization it is given", async () => {
    executeRequestMock.mockResolvedValue(
      answer([{ slug: "agent-native-browser", name: "Agent-Native Browser" }]),
    );
    const result = await run({
      provider: "sentry",
      resource: "projects",
      parent: "builder",
    });
    expect(result.options[0].value).toBe("builder/agent-native-browser");
    expect(executeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/organizations/builder/projects/" }),
    );
  });

  it("hands back the cursor to continue from", async () => {
    executeRequestMock.mockResolvedValue(
      answer([{ full_name: "acme/web" }], 200, {
        link: '<https://api.github.com/user/repos?page=2>; rel="next"',
      }),
    );
    const result = await run({ provider: "github", resource: "repositories" });
    expect(result.nextCursor).toBe("2");
  });

  it("fails credential_missing, with the reason and how to connect, when nothing is connected", async () => {
    executeRequestMock.mockRejectedValue(
      Object.assign(new Error("connect"), {
        name: "AgentConnectionRequiredError",
      }),
    );
    const failure = await failureOf(
      run({ provider: "slack", resource: "channels" }),
    );
    expect(failure).toMatchObject({
      errorCode: "credential_missing",
      statusCode: 412,
      retryable: false,
    });
    expect(failure.details).toMatchObject({
      provider: "slack",
      resource: "channels",
      reason: "not_connected",
    });
    expect(failure.message).toContain("request-workflow-connection");
  });

  it("fails credential_missing with the permission when Slack names one", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ ok: false, error: "missing_scope", needed: "channels:read" }),
    );
    const failure = await failureOf(
      run({ provider: "slack", resource: "channels" }),
    );
    expect(failure.errorCode).toBe("credential_missing");
    expect(failure.details).toMatchObject({
      reason: "missing_scope",
      scope: "channels:read",
    });
  });

  it("fails rate_limited as retryable", async () => {
    executeRequestMock.mockResolvedValue(answer({}, 429));
    const failure = await failureOf(
      run({ provider: "github", resource: "repositories" }),
    );
    expect(failure).toMatchObject({
      errorCode: "rate_limited",
      statusCode: 429,
      retryable: true,
    });
  });

  it("fails provider_unreadable for a list it cannot parse, never an empty one", async () => {
    executeRequestMock.mockResolvedValue(answer({ unexpected: true }));
    const failure = await failureOf(
      run({ provider: "sentry", resource: "organizations" }),
    );
    expect(failure).toMatchObject({
      errorCode: "provider_unreadable",
      statusCode: 424,
    });
  });

  it("refuses a resource no lister serves and says which exist", async () => {
    const failure = await failureOf(
      run({ provider: "slack", resource: "users" }),
    );
    expect(failure).toMatchObject({
      errorCode: "unsupported_resource",
      statusCode: 400,
    });
    expect(failure.message).toContain("slack/channels");
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("refuses Sentry projects without an organization", async () => {
    const failure = await failureOf(
      run({ provider: "sentry", resource: "projects" }),
    );
    expect(failure).toMatchObject({
      errorCode: "parent_required",
      statusCode: 400,
    });
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("refuses a cursor GitHub cannot use", async () => {
    const failure = await failureOf(
      run({ provider: "github", resource: "repositories", cursor: "abc" }),
    );
    expect(failure.errorCode).toBe("bad_cursor");
  });

  it("stays inside the workspace: a caller who is not a member never reaches the provider", async () => {
    readScopeMock.mockRejectedValue(new Error("Workspace membership required"));
    await expect(
      run({ provider: "slack", resource: "channels" }),
    ).rejects.toThrow("Workspace membership required");
    expect(executeRequestMock).not.toHaveBeenCalled();
  });
});
