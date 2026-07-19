import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import type { PrivateVaultGenesisAdmissionCoordinator } from "../private-vault/genesis-admission-coordinator.js";
import { createContentPrivateVaultIpcHandlers } from "./content-private-vault.js";

const event = {} as Electron.IpcMainInvokeEvent;

function coordinator(input?: {
  create?: () => Promise<unknown>;
  resume?: () => Promise<unknown>;
}): PrivateVaultGenesisAdmissionCoordinator {
  return {
    create:
      input?.create ??
      (async () => ({
        vaultId: "00112233445566778899aabbccddeeff",
        accountId: "account_12345678",
        workspaceId: "workspace_12345678",
      })),
    resume:
      input?.resume ??
      (async () => [
        {
          vaultId: "00112233445566778899aabbccddeeff",
          accountId: "account_12345678",
          workspaceId: "workspace_12345678",
        },
      ]),
  } as PrivateVaultGenesisAdmissionCoordinator;
}

describe("Content Private Vault IPC", () => {
  it("returns only the public admitted identity from fixed no-argument calls", async () => {
    const handlers = createContentPrivateVaultIpcHandlers({
      coordinatorForEvent: () => coordinator(),
      recoveryForEvent: async () => ({
        vaultId: "00112233445566778899aabbccddeeff",
        head: { sequence: 7, hash: "42".repeat(32) },
      }),
      objectContextForEvent: () => null,
    });

    await expect(handlers.create(event)).resolves.toEqual({
      ok: true,
      vaultId: "00112233445566778899aabbccddeeff",
      accountId: "account_12345678",
      workspaceId: "workspace_12345678",
    });
    await expect(handlers.resume(event)).resolves.toEqual({
      ok: true,
      vaults: [
        {
          vaultId: "00112233445566778899aabbccddeeff",
          accountId: "account_12345678",
          workspaceId: "workspace_12345678",
        },
      ],
    });
    await expect(handlers.recover(event)).resolves.toEqual({
      ok: true,
      vaultId: "00112233445566778899aabbccddeeff",
      sequence: 7,
      headHash: "42".repeat(32),
    });
  });

  it("rejects every renderer-supplied argument before resolving authority", async () => {
    const coordinatorForEvent = vi.fn(() => coordinator());
    const handlers = createContentPrivateVaultIpcHandlers({
      coordinatorForEvent,
      recoveryForEvent: async () => ({
        vaultId: "00112233445566778899aabbccddeeff",
        head: { sequence: 7, hash: "42".repeat(32) },
      }),
      objectContextForEvent: () => null,
    });

    await expect(
      handlers.create(event, { recoveryMnemonic: "forbidden" }),
    ).resolves.toEqual({
      ok: false,
      error: "Private Vault is unavailable in this Content surface.",
    });
    await expect(handlers.resume(event, "001122")).resolves.toEqual({
      ok: false,
      error: "Private Vault is unavailable in this Content surface.",
    });
    await expect(
      handlers.recover(event, { vaultId: "forbidden" }),
    ).resolves.toEqual({
      ok: false,
      error: "Private Vault is unavailable in this Content surface.",
    });
    expect(coordinatorForEvent).not.toHaveBeenCalled();
  });

  it("collapses denied surfaces and every ceremony failure", async () => {
    const denied = createContentPrivateVaultIpcHandlers({
      coordinatorForEvent: () => null,
      recoveryForEvent: () => null,
      objectContextForEvent: () => null,
    });
    const failed = createContentPrivateVaultIpcHandlers({
      coordinatorForEvent: () =>
        coordinator({
          create: async () => {
            throw new Error("sensitive internal detail");
          },
          resume: async () => {
            throw new Error("sensitive internal detail");
          },
        }),
      recoveryForEvent: async () => {
        throw new Error("sensitive internal detail");
      },
      objectContextForEvent: () => null,
    });
    const expected = {
      ok: false,
      error: "Private Vault is unavailable in this Content surface.",
    };

    await expect(denied.create(event)).resolves.toEqual(expected);
    await expect(failed.create(event)).resolves.toEqual(expected);
    await expect(failed.resume(event)).resolves.toEqual(expected);
    await expect(denied.recover(event)).resolves.toEqual(expected);
    await expect(failed.recover(event)).resolves.toEqual(expected);
  });

  it("exposes only bounded seal-upload and download-open workflows", async () => {
    const sealAndUpload = vi.fn(async () => ({
      revisionId: "30".repeat(32),
      epoch: 7,
      plaintextLength: 16,
      ciphertextByteLength: 512,
    }));
    const downloadAndOpen = vi.fn(async () => ({
      plaintext: Uint8Array.from(Buffer.from('{"title":"Moon"}')),
      epoch: 7,
      writerEndpointId: "40".repeat(16),
      metadata: {},
    }));
    const context = {
      runtime: { sealAndUpload, downloadAndOpen },
      transport: {},
    };
    const handlers = createContentPrivateVaultIpcHandlers({
      coordinatorForEvent: () => null,
      recoveryForEvent: () => null,
      objectContextForEvent: () => context as never,
    });
    const sealRequest = {
      vaultId: "10".repeat(16),
      objectId: "20".repeat(16),
      revision: 3,
      plaintext: Uint8Array.from(Buffer.from('{"title":"Moon"}')),
    };
    await expect(handlers.sealObject(event, sealRequest)).resolves.toEqual({
      ok: true,
      revisionId: "30".repeat(32),
      epoch: 7,
      plaintextLength: 16,
      ciphertextByteLength: 512,
    });
    await expect(
      handlers.openObject(event, {
        vaultId: sealRequest.vaultId,
        objectId: sealRequest.objectId,
        revision: 3,
        revisionId: "30".repeat(32),
      }),
    ).resolves.toMatchObject({
      ok: true,
      epoch: 7,
      writerEndpointId: "40".repeat(16),
    });
    expect(sealAndUpload).toHaveBeenCalledWith({
      transport: context.transport,
      ...sealRequest,
    });

    await expect(
      handlers.sealObject(event, { ...sealRequest, extra: true }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      handlers.openObject(event, {
        vaultId: sealRequest.vaultId,
        objectId: sealRequest.objectId,
        revision: 3,
        revisionId: "30".repeat(32),
        ciphertext: Uint8Array.of(1),
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(sealAndUpload).toHaveBeenCalledOnce();
    expect(downloadAndOpen).toHaveBeenCalledOnce();
  });
});
