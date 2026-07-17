import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  createPrivateVaultNativeServiceClient,
  createPrivateVaultNativeServiceClientForTest,
  PrivateVaultNativeServiceClientError,
} from "./native-service-client";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(currentDirectory, "..", "..", "..");
const nativeRoot = join(desktopRoot, "native", "private-vault-xpc-client");
const nativeSource = readFileSync(join(nativeRoot, "addon.mm"), "utf8");
const serviceRoot = join(desktopRoot, "native", "private-vault-service");
const serviceSource = readFileSync(join(serviceRoot, "main.m"), "utf8");
const serviceIdentity = readFileSync(
  join(serviceRoot, "PrivateVaultServiceIdentity.h"),
  "utf8",
);
const wrapperSource = readFileSync(
  join(currentDirectory, "native-service-client.ts"),
  "utf8",
);
const buildSource = readFileSync(
  join(desktopRoot, "native", "build-private-vault-xpc-client.sh"),
  "utf8",
);

function clientFor(value: unknown) {
  return createPrivateVaultNativeServiceClientForTest(async () => ({
    request: vi.fn(async () => value),
  }));
}

describe("Private Vault native service client", () => {
  it("normalizes the exact health and lock service contracts", async () => {
    await expect(
      clientFor({
        version: 1,
        operation: "health",
        state: "locked",
        available: true,
      }).health(),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "health",
      state: "locked",
      available: true,
      ready: true,
      unlocked: false,
    });
    await expect(
      clientFor({ version: 1, operation: "lock", state: "locked" }).lock(),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "lock",
      state: "locked",
    });
  });

  it("binds rotation resume to one exact vault and proof tuple", async () => {
    const vaultId = "00112233445566778899aabbccddeeff";
    const request = vi.fn(async () => ({
      version: 1,
      operation: "resume_rotation",
      state: "consumed",
      vaultId,
      custodyGeneration: 3,
      activeEpoch: 5,
      sequence: 20,
      headHash: "ab".repeat(32),
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(client.resumeRotation(vaultId)).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "resume_rotation",
      state: "consumed",
      vaultId,
      custodyGeneration: 3,
      activeEpoch: 5,
      sequence: 20,
      headHash: "ab".repeat(32),
    });
    expect(request).toHaveBeenCalledWith("resume_rotation", vaultId);
    await expect(client.resumeRotation(vaultId.toUpperCase())).rejects.toEqual(
      new PrivateVaultNativeServiceClientError(),
    );
    expect(request).toHaveBeenCalledTimes(1);

    for (const mutation of [
      { headHash: "AB".repeat(32) },
      { vaultId: "ff".repeat(16) },
      { custodyGeneration: 0 },
      { activeEpoch: Number.MAX_SAFE_INTEGER + 1 },
      { extra: true },
    ]) {
      const malformed = createPrivateVaultNativeServiceClientForTest(
        async () => ({
          request: vi.fn(async () => ({
            version: 1,
            operation: "resume_rotation",
            state: "consumed",
            vaultId,
            custodyGeneration: 3,
            activeEpoch: 5,
            sequence: 20,
            headHash: "ab".repeat(32),
            ...mutation,
          })),
        }),
      );
      await expect(malformed.resumeRotation(vaultId)).rejects.toEqual(
        new PrivateVaultNativeServiceClientError(),
      );
    }
  });

  it("fails closed for unavailable, malformed, oversized, or unknown replies", async () => {
    const hostileValues = [
      null,
      { version: 1, operation: "health", state: "locked", available: false },
      {
        version: 1,
        operation: "health",
        state: "locked",
        available: true,
        vaultId: "forbidden",
      },
      {
        version: 1,
        operation: "health",
        state: "x".repeat(10_000),
        available: true,
      },
    ];
    for (const value of hostileValues) {
      await expect(clientFor(value).health()).resolves.toMatchObject({
        state: "unavailable",
        available: false,
        ready: false,
        unlocked: false,
      });
      await expect(clientFor(value).lock()).rejects.toEqual(
        new PrivateVaultNativeServiceClientError(),
      );
    }

    const unavailable = createPrivateVaultNativeServiceClientForTest(
      async () => {
        throw new Error("sensitive transport detail");
      },
    );
    await expect(unavailable.health()).resolves.toMatchObject({
      state: "unavailable",
    });
    await expect(unavailable.lock()).rejects.not.toThrow(
      /sensitive transport detail/,
    );
  });

  it("coalesces repeated calls and preserves lock order with a bounded queue", async () => {
    let releaseHealth!: () => void;
    const healthGate = new Promise<void>((resolve) => {
      releaseHealth = resolve;
    });
    const request = vi.fn(
      async (operation: "health" | "lock" | "resume_rotation") => {
        if (operation === "health") {
          await healthGate;
          return {
            version: 1,
            operation: "health",
            state: "locked",
            available: true,
          };
        }
        return { version: 1, operation: "lock", state: "locked" };
      },
    );
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));

    const healthCalls = Array.from({ length: 256 }, () => client.health());
    const lockCalls = Array.from({ length: 256 }, () => client.lock());
    expect(new Set(healthCalls).size).toBe(1);
    expect(new Set(lockCalls).size).toBe(1);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenNthCalledWith(1, "health");

    releaseHealth();
    await Promise.all(healthCalls);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenNthCalledWith(2, "lock");
    await Promise.all(lockCalls);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("offers no production dependency or path override", () => {
    expect(createPrivateVaultNativeServiceClient.length).toBe(0);
    expect(wrapperSource).toContain(
      'path.join(resourcesPath, "native", PACKAGED_ADDON_NAME)',
    );
    expect(wrapperSource).toContain("if (!app.isPackaged)");
    expect(wrapperSource).toContain('process.platform !== "darwin"');
    expect(wrapperSource).not.toContain("addonPath:");
    expect(wrapperSource).not.toContain("resourcesPath:");
    expect(wrapperSource).toContain(
      'process.env.VITEST !== "true" || process.versions.electron',
    );
    expect(wrapperSource).toContain(
      "composition must\n  // verify the universal addon and sign it",
    );
    expect(wrapperSource).toContain("before this require is reachable");
    expect(buildSource).not.toContain("codesign");
  });

  it("binds the connection to the signed service before resume", () => {
    expect(nativeSource).toContain(
      '"com.agentnative.desktop.private-vault-service"',
    );
    expect(nativeSource).toContain('"W3PMF2T3MW"');
    expect(nativeSource).toContain("anchor apple generic");
    expect(nativeSource).toContain(
      "xpc_connection_set_peer_code_signing_requirement",
    );
    expect(nativeSource.indexOf("requirementStatus")).toBeLessThan(
      nativeSource.indexOf("xpc_connection_resume(connection)"),
    );
    expect(serviceIdentity).toContain(
      'PV_CLIENT_IDENTIFIER "com.agentnative.desktop"',
    );
    expect(serviceIdentity).toContain('PV_TEAM_IDENTIFIER "W3PMF2T3MW"');
    expect(serviceSource).toContain(
      "xpc_connection_set_peer_code_signing_requirement",
    );
    expect(serviceSource).toContain("SecCodeCreateWithXPCMessage");
    expect(serviceSource).toContain("SecCodeCheckValidity");
  });

  it("keeps Electron as the XPC peer and never trusts caller metadata", () => {
    expect(nativeSource).toContain("napi_create_async_work");
    expect(nativeSource).toContain("napi_queue_async_work");
    expect(nativeSource).toContain("if (!gRequestGate.tryAcquire())");
    expect(nativeSource.indexOf("gRequestGate.tryAcquire()")).toBeLessThan(
      nativeSource.indexOf("napi_queue_async_work"),
    );
    expect(nativeSource).toContain("dispatch_semaphore_wait");
    expect(nativeSource).toContain("PV_REQUEST_TIMEOUT_NANOSECONDS");
    expect(nativeSource).toContain("xpc_connection_cancel(connection)");
    expect(nativeSource).toContain("xpc_release(connection)");
    expect(nativeSource).toContain("dispatch_release(queue)");
    expect(nativeSource).toContain("dispatch_release(semaphore_)");
    expect(nativeSource).not.toContain("send_message_with_reply_sync");
    expect(nativeSource).not.toMatch(/child_process|spawn|exec|stdout|stderr/);
    expect(nativeSource).not.toMatch(
      /caller(Id|Identity)|executablePath|\bpid\b/i,
    );
  });

  it("rejects concurrent native work immediately while one slot is held", () => {
    expect(
      execFileSync(join(nativeRoot, "run-request-gate-tests.sh"), {
        encoding: "utf8",
      }),
    ).toContain("request gate tests passed");
  });

  it("builds and loads one N-API addon with both macOS architectures", async () => {
    const outputRoot = join(nativeRoot, "build-test");
    const addonPath = execFileSync(
      join(desktopRoot, "native", "build-private-vault-xpc-client.sh"),
      [outputRoot],
      { encoding: "utf8" },
    ).trim();
    expect(statSync(addonPath).isFile()).toBe(true);
    const architectures = execFileSync("lipo", ["-archs", addonPath], {
      encoding: "utf8",
    });
    expect(architectures).toContain("arm64");
    expect(architectures).toContain("x86_64");

    const require = createRequire(import.meta.url);
    const addon = require(addonPath) as {
      request(operation: string, vaultId?: string): Promise<unknown>;
    };
    expect(Object.keys(addon)).toEqual(["request"]);
    await expect(addon.request("health")).rejects.toThrow(
      "Private Vault native service request failed",
    );
    expect(() => addon.request("unknown")).toThrow(
      "Private Vault native service request failed",
    );
    expect(() => addon.request("x".repeat(17))).toThrow(
      "Private Vault native service request failed",
    );
    expect(() => addon.request("resume_rotation")).toThrow(
      "Private Vault native service request failed",
    );
    expect(() =>
      addon.request("resume_rotation", "00112233445566778899AABBCCDDEEFF"),
    ).toThrow("Private Vault native service request failed");
    await expect(
      addon.request("resume_rotation", "00112233445566778899aabbccddeeff"),
    ).rejects.toThrow("Private Vault native service request failed");
  });
});
