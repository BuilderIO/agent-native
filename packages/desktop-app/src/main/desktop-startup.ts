import path from "node:path";

import { resolveDesktopUserDataDirectoryName } from "./ipc/update-policy.js";

export interface DesktopStartupDependencies {
  isPackaged: boolean;
  version: string;
  appDataPath: string;
  createDirectory: (directoryPath: string) => void;
  setUserDataPath: (directoryPath: string) => void;
  initializeSentry: () => void;
  initializeLogger: () => void;
  logError: (message: string, error: unknown) => void;
  logWarning: (message: string, error: unknown) => void;
}

export function initializeDesktopStartup({
  isPackaged,
  version,
  appDataPath,
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
  if (isolatedUserDataDirectoryName) {
    const isolatedUserDataPath = path.join(
      appDataPath,
      isolatedUserDataDirectoryName,
    );
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
