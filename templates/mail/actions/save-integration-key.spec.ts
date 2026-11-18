import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialContext: vi.fn(),
  saveIntegrationKey: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
}));
vi.mock("../server/lib/integration-keys.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/integration-keys.js")
  >()),
  saveIntegrationKey: mocks.saveIntegrationKey,
}));

import saveAction from "./save-integration-key";

const ctx = { userEmail: "user@example.com", orgId: null };

describe("save-integration-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentialContext.mockReturnValue(ctx);
  });

  it("is a private UI-only action the agent cannot call or read back", () => {
    expect(saveAction.uiOnly).toBe(true);
    expect(saveAction.agentTool).toBe(false);
    expect(saveAction.mcpTool).toBe(false);
    expect(saveAction.toolCallable).toBe(false);
    expect(saveAction.persistInChatHistory).toBe(false);
  });

  it("refuses a call that does not come from the app UI", async () => {
    await expect(
      saveAction.run(
        { provider: "gong", apiKey: "example-gong-key" },
        { caller: "tool" },
      ),
    ).rejects.toThrow("signed-in app UI");
    expect(mocks.saveIntegrationKey).not.toHaveBeenCalled();
  });

  it("saves through the credential store and returns no key", async () => {
    const result = await saveAction.run(
      { provider: "gong", apiKey: "example-gong-key" },
      { caller: "frontend" },
    );

    expect(mocks.saveIntegrationKey).toHaveBeenCalledWith(
      "gong",
      "example-gong-key",
      ctx,
    );
    expect(result).toEqual({ saved: true });
  });

  it("requires an authenticated request context", async () => {
    mocks.getCredentialContext.mockReturnValue(null);

    await expect(
      saveAction.run(
        { provider: "gong", apiKey: "example-gong-key" },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({
      message: "no authenticated user",
      errorCode: "authentication_required",
      statusCode: 401,
    });
    expect(mocks.saveIntegrationKey).not.toHaveBeenCalled();
  });
});
