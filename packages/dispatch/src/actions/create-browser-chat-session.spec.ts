import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  buildStartPath: vi.fn(
    (ticket: string) => `/_agent-native/embed/start?ticket=${ticket}`,
  ),
  createTicket: vi.fn(),
  getContext: vi.fn(),
  getEmail: vi.fn(),
}));
const dispatch = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildEmbedStartPath: server.buildStartPath,
  createEmbedSessionTicket: server.createTicket,
  getRequestContext: server.getContext,
  getRequestUserEmail: server.getEmail,
}));
vi.mock("../server/index.js", () => ({
  getDispatchConfig: dispatch.getConfig,
}));

import action from "./create-browser-chat-session.js";

const nonce = "browser-chat-nonce-1234567890";
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const parentOrigin = `chrome-extension://${extensionId}`;

describe("create-browser-chat-session", () => {
  beforeEach(() => {
    server.createTicket.mockReset();
    server.getContext.mockReturnValue({
      orgId: "org-example",
      requestOrigin: "https://dispatch.example.com",
    });
    server.getEmail.mockReturnValue("user@example.com");
    dispatch.getConfig.mockReturnValue({
      browserExtensionIds: [extensionId],
    });
  });

  it("mints a one-time ticket bound to the bridge nonce and parent origin", async () => {
    server.createTicket.mockResolvedValue({
      ticket: "ticket-example",
      ticketHash: "hash-example",
      expiresAt: 12345,
    });

    await expect(action.run({ nonce, extensionId })).resolves.toEqual({
      startPath: "/_agent-native/embed/start?ticket=ticket-example",
      expiresAt: 12345,
      parentOrigin,
    });
    expect(server.createTicket).toHaveBeenCalledWith({
      ownerEmail: "user@example.com",
      orgId: "org-example",
      targetPath:
        "/browser-chat?browserChatNonce=browser-chat-nonce-1234567890&browserChatParentOrigin=chrome-extension%3A%2F%2Fabcdefghijklmnopabcdefghijklmnop",
      scope: "browser-chat",
      ttlSeconds: 60,
    });
    expect(action.agentTool).toBe(false);
    expect(action.toolCallable).toBe(false);
  });

  it("fails closed without an authenticated Dispatch identity", async () => {
    server.getEmail.mockReturnValue(undefined);

    await expect(action.run({ nonce, extensionId })).rejects.toThrow(
      "Sign in to Dispatch",
    );
    expect(server.createTicket).not.toHaveBeenCalled();
  });

  it("rejects an extension id that is not configured in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    dispatch.getConfig.mockReturnValue({ browserExtensionIds: [] });
    try {
      await expect(action.run({ nonce, extensionId })).rejects.toThrow(
        "not allowed",
      );
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
    expect(server.createTicket).not.toHaveBeenCalled();
  });
});
