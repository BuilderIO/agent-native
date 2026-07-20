import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { MultiFrontierSettings } from "../../shared/multi-frontier-channels.js";

export interface MultiFrontierSettingsStore {
  read(): MultiFrontierSettings;
  update(patch: Partial<MultiFrontierSettings>): MultiFrontierSettings;
}

export interface MultiFrontierSettingsFileSystem {
  mkdirSync(path: string, options: { recursive: true }): unknown;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(
    path: string,
    contents: string,
    options: { encoding: "utf8"; mode: number },
  ): void;
  renameSync(from: string, to: string): void;
  chmodSync(path: string, mode: number): void;
  unlinkSync(path: string): void;
}

const DEFAULT_SETTINGS: MultiFrontierSettings = {
  autoContinueAfterAgreement: false,
};

export function createMultiFrontierSettingsStore(
  filePath: string,
  fileSystem: MultiFrontierSettingsFileSystem = fs,
  createSuffix: () => string = randomUUID,
): MultiFrontierSettingsStore {
  if (!path.isAbsolute(filePath)) {
    throw new Error("Multi-frontier settings require an absolute file path.");
  }

  const read = (): MultiFrontierSettings => {
    try {
      const candidate = JSON.parse(
        fileSystem.readFileSync(filePath, "utf8"),
      ) as unknown;
      return normalizeSettings(candidate);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };

  const write = (settings: MultiFrontierSettings): void => {
    const directory = path.dirname(filePath);
    fileSystem.mkdirSync(directory, { recursive: true });
    const tempPath = path.join(
      directory,
      `.${path.basename(filePath)}.${process.pid}.${createSuffix()}.tmp`,
    );
    try {
      fileSystem.writeFileSync(tempPath, JSON.stringify(settings, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      fileSystem.renameSync(tempPath, filePath);
      fileSystem.chmodSync(filePath, 0o600);
    } catch (error) {
      try {
        fileSystem.unlinkSync(tempPath);
      } catch {
        // The original failure is authoritative.
      }
      throw error;
    }
  };

  return {
    read,
    update(patch) {
      const current = read();
      const next = {
        autoContinueAfterAgreement:
          typeof patch.autoContinueAfterAgreement === "boolean"
            ? patch.autoContinueAfterAgreement
            : current.autoContinueAfterAgreement,
      };
      write(next);
      return { ...next };
    },
  };
}

function normalizeSettings(value: unknown): MultiFrontierSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }
  const input = value as Record<string, unknown>;
  return {
    autoContinueAfterAgreement:
      typeof input.autoContinueAfterAgreement === "boolean"
        ? input.autoContinueAfterAgreement
        : false,
  };
}
