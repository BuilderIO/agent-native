import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  userData: "",
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => {
      throw new Error("Safe Storage must not be accessed");
    }),
    decryptString: vi.fn(() => {
      throw new Error("Safe Storage must not be accessed");
    }),
    encryptString: vi.fn(() => {
      throw new Error("Safe Storage must not be accessed");
    }),
  },
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: () => electronState.userData,
  },
  safeStorage: electronState.safeStorage,
}));

import {
  getCodeAgentProviderProcessEnv,
  getCodeAgentProviderSettingsStatus,
  loadCodeAgentProviderCredentials,
  loadRemoteConnectorSettings,
  saveCodeAgentProviderCredentials,
} from "./app-store";

describe("desktop file-backed provider credentials", () => {
  beforeEach(() => {
    electronState.userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-privacy-"),
    );
    for (const method of Object.values(electronState.safeStorage)) {
      method.mockClear();
    }
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
          OPENAI_API_KEY: {
            encoding: "local-file-v1",
            value: "sk-test-example",
          },
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(electronState.userData, { recursive: true, force: true });
  });

  it("ignores legacy Keychain entries without touching Safe Storage", () => {
    const status = getCodeAgentProviderSettingsStatus();

    expect(status.configuredProviders).not.toContain("Builder.io");
    expect(status.configuredProviders).toContain("OpenAI");
    expect(
      status.providers.find((provider) => provider.id === "builder"),
    ).toMatchObject({ savedKeys: [] });
    expect(
      Object.values(electronState.safeStorage).every(
        (method) => method.mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it("loads only file-backed credentials", () => {
    expect(loadCodeAgentProviderCredentials()).toEqual({
      OPENAI_API_KEY: "sk-test-example",
    });
    expect(
      Object.values(electronState.safeStorage).every(
        (method) => method.mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it("exposes saved credentials only through the runner environment", () => {
    const env = getCodeAgentProviderProcessEnv({ NODE_ENV: "test" });

    expect(env).toMatchObject({
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-test-example",
    });
    expect(env.BUILDER_PRIVATE_KEY).toBeUndefined();
    expect(env.BUILDER_PUBLIC_KEY).toBeUndefined();
  });

  it("writes new credentials without invoking Safe Storage", () => {
    saveCodeAgentProviderCredentials({ ANTHROPIC_API_KEY: "sk-anthropic" });

    const store = JSON.parse(
      fs.readFileSync(
        path.join(electronState.userData, "code-agent-providers.json"),
        "utf-8",
      ),
    );
    expect(store.credentials.ANTHROPIC_API_KEY).toMatchObject({
      encoding: "local-file-v1",
      value: "sk-anthropic",
    });
    expect(
      Object.values(electronState.safeStorage).every(
        (method) => method.mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it("defaults the background connector to disabled", () => {
    expect(loadRemoteConnectorSettings()).toEqual({ enabled: false });
  });
});
