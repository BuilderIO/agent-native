import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  userData: "",
  encryptionAvailable: true,
  decryptString: vi.fn((value: Buffer) => value.toString()),
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: () => electronState.userData,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => electronState.encryptionAvailable),
    decryptString: electronState.decryptString,
    encryptString: vi.fn((value: string) => Buffer.from(value)),
  },
}));

import {
  clearProtectedPreviewAccess,
  getCodeAgentProviderSettingsStatus,
  getProtectedPreviewAccessStatus,
  loadCodeAgentProviderCredentials,
  loadProtectedPreviewAccess,
  loadRemoteConnectorSettings,
  saveProtectedPreviewAccess,
} from "./app-store";

describe("desktop privacy-safe status reads", () => {
  beforeEach(() => {
    electronState.userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-privacy-"),
    );
    electronState.decryptString.mockClear();
    electronState.encryptionAvailable = true;
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

  it("rejects project-wide automation bypass credentials", () => {
    const origin = "https://candidate.example.test";

    expect(
      saveProtectedPreviewAccess(
        "content",
        `${origin}/review`,
        "example-project-wide-secret",
      ),
    ).toMatchObject({ configured: false });
  });

  it("extracts a deployment share secret without storing the bearer URL", () => {
    const origin = "https://candidate.example.test";
    const secret = "example-share-secret";
    const shareUrl = `${origin}/?_vercel_share=${secret}`;

    expect(saveProtectedPreviewAccess("content", origin, shareUrl)).toEqual({
      available: true,
      configured: true,
      origin,
      kind: "shareable-link",
    });

    const stored = fs.readFileSync(
      path.join(electronState.userData, "protected-preview-access.json"),
      "utf-8",
    );
    expect(stored).toContain('"kind": "shareable-link"');
    expect(stored).not.toContain("_vercel_share");
    expect(stored).not.toContain(secret);
    expect(loadProtectedPreviewAccess("content")).toEqual({
      origin,
      kind: "shareable-link",
      secret,
    });
    expect(getProtectedPreviewAccessStatus("content")).toMatchObject({
      available: true,
      configured: true,
      origin,
      kind: "shareable-link",
    });

    expect(clearProtectedPreviewAccess("content")).toEqual({
      available: true,
      configured: false,
    });
    expect(loadProtectedPreviewAccess("content")).toBeNull();
  });

  it("rejects a Shareable Link for a different deployment origin", () => {
    expect(
      saveProtectedPreviewAccess(
        "content",
        "https://candidate.example.test",
        "https://other-candidate.example.test/?_vercel_share=secret",
      ),
    ).toMatchObject({ configured: false });
  });

  it("fails closed when operating-system encryption is unavailable", () => {
    electronState.encryptionAvailable = false;
    expect(
      saveProtectedPreviewAccess(
        "content",
        "https://candidate.example.test",
        "https://candidate.example.test/?_vercel_share=example-share-secret",
      ),
    ).toMatchObject({
      available: false,
      configured: false,
    });
  });
});
