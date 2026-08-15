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

describe("chat-only webview preload", () => {
  beforeAll(async () => {
    await import("./webview-chat.js");
  });

  it("exposes only host-routed chat commands", () => {
    const chat = (
      electron.exposed as {
        chat: {
          toggle(): void;
          open(): void;
          close(): void;
        };
      }
    ).chat;

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
