import path from "path";

import { app, shell } from "electron";
import type ElectronLog from "electron-log";
import log from "electron-log/main";

import { redactLogValue, redactLogString } from "./log-redaction";

const LOG_MAX_SIZE = 5 * 1024 * 1024;
const WEBVIEW_LOG_LEVELS: Record<number, ElectronLog.LogLevel> = {
  0: "verbose",
  1: "info",
  2: "warn",
  3: "error",
};

let initialized = false;

export function initializeDesktopLogger(): void {
  if (initialized) return;
  initialized = true;

  log.transports.file.maxSize = LOG_MAX_SIZE;
  log.transports.file.resolvePathFn = (vars) =>
    path.join(vars.libraryDefaultDir, "main.log");

  log.hooks.push((message) => {
    message.data = message.data.map((item) => {
      if (typeof item === "string") return redactLogString(item);
      return redactLogValue(item);
    });
    return message;
  });

  if (app.isPackaged) {
    Object.assign(console, log.functions);
  }
}

export function captureWebviewLogs(
  contents: Electron.WebContents,
  label: string,
): void {
  const scope = log.scope(label);
  contents.on("console-message", (_event, level, message) => {
    const logLevel: ElectronLog.LogLevel = WEBVIEW_LOG_LEVELS[level] ?? "debug";
    scope[logLevel](redactLogString(message ?? ""));
  });
}

export function revealLogFolder(): void {
  const file = log.transports.file.getFile();
  shell.showItemInFolder(file.path);
}

export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}
