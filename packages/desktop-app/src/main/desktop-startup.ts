import path from "node:path";

import { resolveDesktopUserDataDirectoryName } from "./ipc/update-policy.js";

export interface DesktopStartupDependencies {
  isPackaged: boolean;
  version: string;
  appDataPath: string;
  requestedUserDataPath?: string;
  createDirectory: (directoryPath: string) => void;
  setUserDataPath: (directoryPath: string) => void;
  initializeSentry: () => void;
  initializeLogger: () => void;
  logError: (message: string, error: unknown) => void;
  logWarning: (message: string, error: unknown) => void;
}

export function desktopRequestedUserDataPath(
  commandLineValue: string,
  argv: string[],
) {
  const explicitSwitch = commandLineValue.trim();
  if (explicitSwitch) return explicitSwitch;
  return argv
    .find((argument) => argument.startsWith("--user-data-dir="))
    ?.slice("--user-data-dir=".length)
    .trim();
}

export interface DesktopStartupStep {
  start: () => Promise<unknown>;
  isShuttingDown: () => boolean;
  abort?: () => Promise<void>;
}

export function resolveDesktopSsoBrokerStatePath(userDataPath: string): string {
  return path.join(userDataPath, "desktop-sso.json");
}

export async function runDesktopStartupStep({
  start,
  isShuttingDown,
  abort,
}: DesktopStartupStep): Promise<boolean> {
  await start();
  if (!isShuttingDown()) return true;
  await abort?.();
  return false;
}

export function initializeDesktopStartup({
  isPackaged,
  version,
  appDataPath,
  requestedUserDataPath,
  createDirectory,
  setUserDataPath,
  initializeSentry,
  initializeLogger,
  logError,
  logWarning,
}: DesktopStartupDependencies): void {
  const isolatedUserDataDirectoryName = resolveDesktopUserDataDirectoryName(
    isPackaged,
    version,
  );
  const isolatedUserDataPath = requestedUserDataPath
    ? path.resolve(requestedUserDataPath)
    : isolatedUserDataDirectoryName
      ? path.join(appDataPath, isolatedUserDataDirectoryName)
      : !isPackaged
        ? path.join(appDataPath, "Agent Native Dev")
        : null;
  if (isolatedUserDataPath) {
    try {
      createDirectory(isolatedUserDataPath);
      setUserDataPath(isolatedUserDataPath);
    } catch (error) {
      if (isPackaged) {
        logError(
          "[main] failed to isolate packaged userData directory:",
          error,
        );
        throw error;
      }
      logWarning("[main] failed to isolate userData directory:", error);
    }
  }

  initializeSentry();
  initializeLogger();
}
