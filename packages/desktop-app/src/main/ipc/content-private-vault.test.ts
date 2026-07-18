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
});
