import { contextBridge, ipcRenderer } from "electron";

type AgentChatCommandOptions = { focus?: boolean };

function sendChatCommand(
  command: "toggle" | "open" | "close",
  options?: AgentChatCommandOptions,
) {
  if (options) {
    ipcRenderer.sendToHost("agent-native:chat-command", command, options);
  } else {
    ipcRenderer.sendToHost("agent-native:chat-command", command);
  }
}

const agentNativeDesktop = {
  analytics: {
    clientPlatform: "electron" as const,
  },
  chat: {
    toggle: (options?: AgentChatCommandOptions) =>
      sendChatCommand("toggle", options),
    open: (options?: AgentChatCommandOptions) =>
      sendChatCommand("open", options),
    close: (options?: AgentChatCommandOptions) =>
      sendChatCommand("close", options),
  },
};

contextBridge.exposeInMainWorld("agentNativeDesktop", agentNativeDesktop);
