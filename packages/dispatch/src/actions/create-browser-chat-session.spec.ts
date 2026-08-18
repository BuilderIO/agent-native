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
const integrations = vi.hoisted(() => ({
  createRemoteDevice: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildEmbedStartPath: server.buildStartPath,
  createEmbedSessionTicket: server.createTicket,
  getRequestContext: server.getContext,
  getRequestUserEmail: server.getEmail,
  withConfiguredAppBasePath: (origin: string) => origin,
}));
vi.mock("@agent-native/core/integrations", () => ({
  createRemoteDevice: integrations.createRemoteDevice,
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
    integrations.createRemoteDevice.mockResolvedValue({
      device: { id: "remote-device-example" },
      token: "anr_example",
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
      remoteDevice: {
        id: "remote-device-example",
        token: "anr_example",
      },
      relayBaseUrl: "https://dispatch.example.com",
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
    expect(integrations.createRemoteDevice).toHaveBeenCalledWith({
      ownerEmail: "user@example.com",
      orgId: "org-example",
      label: "Agent Native for Chrome",
      platform: "chrome-extension",
      metadata: {
        browserExtension: { extensionId },
        computerCapabilities: {
          browser: {
            observe: true,
            control: true,
            provider: "agent-native-chrome-extension",
          },
        },
      },
    });
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
