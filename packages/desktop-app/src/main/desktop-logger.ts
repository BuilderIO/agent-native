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

  // --- File transport: rotate at 5 MB, keep one old file ---
  log.transports.file.maxSize = LOG_MAX_SIZE;
  log.transports.file.resolvePathFn = (vars) =>
    path.join(vars.libraryDefaultDir, "main.log");

  // --- Redact every log message before it reaches any transport ---
  log.hooks.push((message) => {
    message.data = message.data.map((item) => {
      if (typeof item === "string") return redactLogString(item);
      return redactLogValue(item);
    });
    return message;
  });

  // --- Mirror console.* to the log file in packaged builds ---
  if (app.isPackaged) {
    Object.assign(console, log.functions);
  }
}

/**
 * Wire the console-message event from a specific WebContents into the log
 * file.  Call this in web-contents-created / before any webview is shown so
 * that renderer logs (including Clips recording errors) are captured even
 * when DevTools is closed.
 */
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

/** Reveal the log folder in Finder / Explorer. */
export function revealLogFolder(): void {
  const file = log.transports.file.getFile();
  shell.showItemInFolder(file.path);
}

/** Returns the path to the current log file so it can be displayed to the user. */
export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}
