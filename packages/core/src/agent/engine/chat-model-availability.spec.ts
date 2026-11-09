import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: vi.fn<() => string | undefined>(),
  resolveOwnerEngineApiKey: vi.fn(),
  resolveChatEngine: vi.fn(),
  isUsable: vi.fn(),
}));

vi.mock("../../app-config/index.js", () => ({
  getAppConfig: () => ({ app: { id: "clips", template: "clips" } }),
}));
vi.mock("../../server/credential-provider.js", () => ({
  readDeployCredentialEnv: () => undefined,
}));
vi.mock("../../server/request-context.js", () => ({
  getRequestUserEmail: mocks.email,
  getRequestOrgId: () => "org_1",
}));
vi.mock("../production-agent.js", () => ({
  resolveOwnerEngineApiKey: mocks.resolveOwnerEngineApiKey,
  resolveChatEngine: mocks.resolveChatEngine,
}));
vi.mock("./index.js", () => ({
  registerBuiltinEngines: vi.fn(),
  isResolvedEngineUsableForRequest: mocks.isUsable,
}));

import {
  resetChatModelAvailabilityCache,
  resolveChatModelAvailability,
} from "./chat-model-availability.js";

describe("resolveChatModelAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChatModelAvailabilityCache();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.email.mockReturnValue("owner@example.com");
    mocks.resolveOwnerEngineApiKey.mockResolvedValue({ apiKey: "k" });
    mocks.resolveChatEngine.mockResolvedValue({ name: "builder" });
  });

  it("is available when the resolved engine can run", async () => {
    mocks.isUsable.mockResolvedValue(true);
    await expect(resolveChatModelAvailability()).resolves.toBe("available");
  });

  it("is available for a provider-key user with no Builder", async () => {
    mocks.resolveChatEngine.mockResolvedValue({ name: "anthropic" });
    mocks.isUsable.mockResolvedValue(true);
    await expect(resolveChatModelAvailability()).resolves.toBe("available");
    expect(mocks.isUsable).toHaveBeenCalledWith(
      { name: "anthropic" },
      expect.objectContaining({ apiKey: "k" }),
    );
  });

  it("is unavailable when no engine has a credential", async () => {
    mocks.isUsable.mockResolvedValue(false);
    await expect(resolveChatModelAvailability()).resolves.toBe("unavailable");
  });

  it("is unknown, not unavailable, when resolution throws", async () => {
    mocks.resolveChatEngine.mockRejectedValue(new Error("store down"));
    await expect(resolveChatModelAvailability()).resolves.toBe("unknown");
  });

  it("is unknown with no owner and no request user", async () => {
    mocks.email.mockReturnValue(undefined);
    await expect(resolveChatModelAvailability()).resolves.toBe("unknown");
    expect(mocks.resolveChatEngine).not.toHaveBeenCalled();
  });

  it("uses a passed owner when there is no request user", async () => {
    mocks.email.mockReturnValue(undefined);
    mocks.isUsable.mockResolvedValue(true);
    await expect(
      resolveChatModelAvailability({ ownerEmail: "bg@example.com" }),
    ).resolves.toBe("available");
    expect(mocks.resolveOwnerEngineApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "bg@example.com" }),
    );
  });

  it("answers repeat calls for one user from the cache", async () => {
    mocks.isUsable.mockResolvedValue(true);
    await resolveChatModelAvailability();
    await resolveChatModelAvailability();
    expect(mocks.resolveChatEngine).toHaveBeenCalledTimes(1);
  });

  it("does not cache an unknown answer", async () => {
    mocks.resolveChatEngine.mockRejectedValueOnce(new Error("store down"));
    await expect(resolveChatModelAvailability()).resolves.toBe("unknown");
    mocks.isUsable.mockResolvedValue(true);
    await expect(resolveChatModelAvailability()).resolves.toBe("available");
  });

  it("looks up a passed owner with no org instead of the request's org", async () => {
    mocks.isUsable.mockResolvedValue(true);
    await resolveChatModelAvailability({ ownerEmail: "bg@example.com" });
    expect(mocks.resolveChatEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialIdentity: { userEmail: "bg@example.com", orgId: null },
      }),
    );
  });
});
