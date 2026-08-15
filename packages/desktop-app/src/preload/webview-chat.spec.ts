import { beforeAll, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  exposed: undefined as unknown,
  sendToHost: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, value: unknown) => {
      electron.exposed = value;
    }),
  },
  ipcRenderer: {
    sendToHost: electron.sendToHost,
  },
}));

describe("chat webview preload", () => {
  beforeAll(async () => {
    await import("./webview-chat.js");
  });

  it("exposes host-routed chat commands and platform attribution", () => {
    const chat = (
      electron.exposed as {
        analytics: { clientPlatform: string };
        chat: {
          toggle(): void;
          open(): void;
          close(): void;
        };
      }
    ).chat;

    expect(
      (electron.exposed as { analytics: { clientPlatform: string } }).analytics
        .clientPlatform,
    ).toBe("electron");

    chat.toggle();
    chat.open();
    chat.close();

    expect(electron.sendToHost).toHaveBeenNthCalledWith(
      1,
      "agent-native:chat-command",
      "toggle",
    );
    expect(electron.sendToHost).toHaveBeenNthCalledWith(
      2,
      "agent-native:chat-command",
      "open",
    );
    expect(electron.sendToHost).toHaveBeenNthCalledWith(
      3,
      "agent-native:chat-command",
      "close",
    );
  });
});
