import { contextBridge, ipcRenderer } from "electron";

const agentNativeDesktop = {
  chat: {
    toggle: () => ipcRenderer.sendToHost("agent-native:chat-command", "toggle"),
    open: () => ipcRenderer.sendToHost("agent-native:chat-command", "open"),
    close: () => ipcRenderer.sendToHost("agent-native:chat-command", "close"),
  },
};

contextBridge.exposeInMainWorld("agentNativeDesktop", agentNativeDesktop);
