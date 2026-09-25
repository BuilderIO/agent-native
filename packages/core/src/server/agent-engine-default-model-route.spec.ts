import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();
const mockResolveAuthority = vi.fn();
const mockClear = vi.fn();
const mockRecordRefusal = vi.fn();
const mockSelectDefault = vi.fn();
const mockWriteAppSecret = vi.fn();
const mockDeleteAppSecret = vi.fn();

vi.mock("./auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: unknown[]) => mockGetOrgContext(...args),
}));

vi.mock("../agent/default-agent-engine.js", () => ({
  resolveDefaultAgentEngineAuthority: (...args: unknown[]) =>
    mockResolveAuthority(...args),
  clearDefaultAgentEngineSelection: (...args: unknown[]) => mockClear(...args),
  recordDefaultAgentEngineRefusal: (...args: unknown[]) =>
    mockRecordRefusal(...args),
}));

vi.mock("../scripts/agent-engines/set-agent-engine.js", () => ({
  selectDefaultAgentEngine: (...args: unknown[]) => mockSelectDefault(...args),
}));

vi.mock("../secrets/storage.js", () => ({
  writeAppSecret: (...args: unknown[]) => mockWriteAppSecret(...args),
  deleteAppSecret: (...args: unknown[]) => mockDeleteAppSecret(...args),
}));

vi.mock("./credential-provider.js", () => ({
  clearProviderCredentialAuthFailure: vi.fn(),
  isTrustedSelfHostedRuntime: () => false,
}));

import { createAgentEngineApiKeyHandler } from "./agent-engine-api-key-route.js";
import {
  createAgentEngineDisconnectHandler,
  readDefaultModelSelectionRequest,
  selectDefaultModelForSavedKey,
} from "./agent-engine-default-model-route.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

function postEvent(path: string, body?: unknown, method = "POST") {
  return {
    req: new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    }),
    res: { headers: new Headers(), status: 200 },
    context: {},
  } as any;
}

const adminAuthority = {
  allowed: true,
  scope: "org",
  orgId: "org-a",
  userEmail: "admin@a.test",
};
const memberRefusal = {
  allowed: false,
  reason: "not-admin",
  message: "Only organization owners and admins can change the default model.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ email: "admin@a.test" });
  mockGetOrgContext.mockResolvedValue({ orgId: "org-a", role: "admin" });
});

describe("POST /agent-engine/disconnect", () => {
  it("clears the org default for an owner or admin", async () => {
    mockResolveAuthority.mockResolvedValue(adminAuthority);
    const event = postEvent("/_agent-native/agent-engine/disconnect");

    await expect(createAgentEngineDisconnectHandler()(event)).resolves.toEqual({
      ok: true,
      scope: "org",
    });
    expect(mockResolveAuthority).toHaveBeenCalledWith({
      userEmail: "admin@a.test",
      orgId: "org-a",
    });
    expect(mockClear).toHaveBeenCalledWith(adminAuthority, {
      actionName: "agent-engine-disconnect",
      caller: "http",
    });
  });

  it("refuses a member with 403 and records the attempt", async () => {
    mockGetSession.mockResolvedValue({ email: "member@a.test" });
    mockResolveAuthority.mockResolvedValue(memberRefusal);
    const event = postEvent("/_agent-native/agent-engine/disconnect");

    await expect(createAgentEngineDisconnectHandler()(event)).resolves.toEqual({
      ok: false,
      error: memberRefusal.message,
    });
    expect(event.res.status).toBe(403);
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockRecordRefusal).toHaveBeenCalledWith(
      { userEmail: "member@a.test", orgId: "org-a" },
      memberRefusal,
      "clear",
      { actionName: "agent-engine-disconnect", caller: "http" },
    );
  });

  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const event = postEvent("/_agent-native/agent-engine/disconnect");

    await expect(createAgentEngineDisconnectHandler()(event)).resolves.toEqual({
      error: "unauthorized",
    });
    expect(event.res.status).toBe(401);
    expect(mockResolveAuthority).not.toHaveBeenCalled();
  });

  it("fails loudly instead of clearing a personal default when the org can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetOrgContext.mockRejectedValue(new Error("db down"));
    const event = postEvent("/_agent-native/agent-engine/disconnect");

    await expect(createAgentEngineDisconnectHandler()(event)).resolves.toEqual({
      ok: false,
      error: "Could not clear the default model.",
    });
    expect(event.res.status).toBe(500);
    expect(mockResolveAuthority).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });
});

describe("provider key save picks the default model", () => {
  it("parses an optional defaultModel request", () => {
    expect(readDefaultModelSelectionRequest({})).toEqual({
      ok: true,
      request: null,
    });
    expect(
      readDefaultModelSelectionRequest({
        defaultModel: { engine: " ai-sdk:openai ", model: " gpt-5.5 " },
      }),
    ).toEqual({
      ok: true,
      request: { engine: "ai-sdk:openai", model: "gpt-5.5" },
    });
    expect(
      readDefaultModelSelectionRequest({ defaultModel: { model: "x" } }),
    ).toEqual({ ok: false, error: "defaultModel.engine is required." });
  });

  it("selects the engine in the same save when an admin saves an org key", async () => {
    mockSelectDefault.mockImplementation(async () => ({
      status: "selected",
      engine: "ai-sdk:openai",
      model: "gpt-5.5",
      requestedModel: "gpt-5.5",
      label: "OpenAI",
      // The engine check resolves the just-saved org key through this context.
      seenContext: {
        userEmail: getRequestUserEmail(),
        orgId: getRequestOrgId(),
      },
    }));
    const event = postEvent("/_agent-native/agent-engine/api-key", {
      key: "OPENAI_API_KEY",
      value: "sk-test-fake-key",
      scope: "org",
      defaultModel: { engine: "ai-sdk:openai", model: "gpt-5.5" },
    });

    await expect(createAgentEngineApiKeyHandler()(event)).resolves.toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      scope: "org",
      defaultModel: {
        status: "selected",
        engine: "ai-sdk:openai",
        model: "gpt-5.5",
      },
    });
    expect(mockWriteAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({ key: "OPENAI_API_KEY", scope: "org" }),
    );
    expect(mockSelectDefault).toHaveBeenCalledWith(
      { engine: "ai-sdk:openai", model: "gpt-5.5" },
      { actionName: "agent-engine-api-key", caller: "http" },
      { userEmail: "admin@a.test", orgId: "org-a" },
    );
    const seen = await mockSelectDefault.mock.results[0]!.value;
    expect(seen.seenContext).toEqual({
      userEmail: "admin@a.test",
      orgId: "org-a",
    });
  });

  it("only saves the key when no defaultModel is requested", async () => {
    const event = postEvent("/_agent-native/agent-engine/api-key", {
      key: "OPENAI_API_KEY",
      value: "sk-test-fake-key",
      scope: "org",
    });

    await expect(createAgentEngineApiKeyHandler()(event)).resolves.toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      scope: "org",
    });
    expect(mockSelectDefault).not.toHaveBeenCalled();
  });

  it("rejects a malformed defaultModel before writing the key", async () => {
    const event = postEvent("/_agent-native/agent-engine/api-key", {
      key: "OPENAI_API_KEY",
      value: "sk-test-fake-key",
      scope: "org",
      defaultModel: "ai-sdk:openai",
    });

    await expect(createAgentEngineApiKeyHandler()(event)).resolves.toEqual({
      error: "defaultModel must be an object.",
    });
    expect(event.res.status).toBe(400);
    expect(mockWriteAppSecret).not.toHaveBeenCalled();
  });

  it("does not let an org member's personal key change the org default", async () => {
    mockGetSession.mockResolvedValue({ email: "member@a.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-a", role: "member" });

    await expect(
      selectDefaultModelForSavedKey(postEvent("/x"), {
        keyScope: "user",
        keyScopeId: "member@a.test",
        request: { engine: "ai-sdk:openai" },
      }),
    ).resolves.toEqual({ status: "skipped", reason: "personal-key" });
    expect(mockSelectDefault).not.toHaveBeenCalled();
  });

  it("selects a no-org user's own default for their personal key", async () => {
    mockGetSession.mockResolvedValue({ email: "solo@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: null, role: null });
    mockSelectDefault.mockResolvedValue({
      status: "selected",
      engine: "anthropic",
      model: "claude-sonnet-5",
    });

    await expect(
      selectDefaultModelForSavedKey(postEvent("/x"), {
        keyScope: "user",
        keyScopeId: "solo@example.test",
        request: { engine: "anthropic" },
      }),
    ).resolves.toEqual({
      status: "selected",
      engine: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(mockSelectDefault.mock.calls[0]![2]).toEqual({
      userEmail: "solo@example.test",
      orgId: null,
    });
  });

  it("reports a refused or invalid selection without hiding it", async () => {
    mockSelectDefault.mockResolvedValueOnce({
      status: "refused",
      message: memberRefusal.message,
    });
    await expect(
      selectDefaultModelForSavedKey(postEvent("/x"), {
        keyScope: "org",
        keyScopeId: "org-a",
        request: { engine: "ai-sdk:openai" },
      }),
    ).resolves.toEqual({ status: "skipped", reason: "not-allowed" });

    mockSelectDefault.mockResolvedValueOnce({
      status: "missing-credentials",
      message: "Engine needs OPENAI_API_KEY.",
    });
    await expect(
      selectDefaultModelForSavedKey(postEvent("/x"), {
        keyScope: "org",
        keyScopeId: "org-a",
        request: { engine: "ai-sdk:openai" },
      }),
    ).resolves.toEqual({
      status: "failed",
      error: "Engine needs OPENAI_API_KEY.",
    });
  });
});
