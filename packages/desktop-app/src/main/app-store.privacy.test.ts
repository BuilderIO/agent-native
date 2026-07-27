import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  userData: "",
  decryptString: vi.fn(() => "sk-test-example"),
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: () => electronState.userData,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: electronState.decryptString,
    encryptString: vi.fn((value: string) => Buffer.from(value)),
  },
}));

import {
  getCodeAgentProviderSettingsStatus,
  loadCodeAgentProviderCredentials,
  loadRemoteConnectorSettings,
} from "./app-store";

describe("desktop privacy-safe status reads", () => {
  beforeEach(() => {
    electronState.userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-privacy-"),
    );
    electronState.decryptString.mockClear();
    fs.writeFileSync(
      path.join(electronState.userData, "code-agent-providers.json"),
      JSON.stringify({
        version: 1,
        credentials: {
          BUILDER_PRIVATE_KEY: {
            encoding: "safeStorage-v1",
            value: "ZmFrZQ==",
          },
          BUILDER_PUBLIC_KEY: {
            encoding: "safeStorage-v1",
            value: "ZmFrZQ==",
          },
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(electronState.userData, { recursive: true, force: true });
  });

  it("reports saved provider keys without unlocking Keychain", () => {
    const status = getCodeAgentProviderSettingsStatus();

    expect(status.configuredProviders).toContain("Builder.io");
    expect(electronState.decryptString).not.toHaveBeenCalled();
  });

  it("unlocks saved keys only for an explicit credential load", () => {
    loadCodeAgentProviderCredentials();
    expect(electronState.decryptString).toHaveBeenCalledTimes(2);
  });

  it("defaults the background connector to disabled", () => {
    expect(loadRemoteConnectorSettings()).toEqual({ enabled: false });
  });
});
