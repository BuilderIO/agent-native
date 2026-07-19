import {
  IPC,
  type DesktopPrivateVaultCreateGenesisResult,
  type DesktopPrivateVaultRecoveryResult,
  type DesktopPrivateVaultResumeGenesisResult,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { PrivateVaultGenesisAdmissionCoordinator } from "../private-vault/genesis-admission-coordinator.js";

const UNAVAILABLE = "Private Vault is unavailable in this Content surface.";

export interface ContentPrivateVaultIpcDeps {
  coordinatorForEvent(
    event: IpcMainInvokeEvent,
  ): PrivateVaultGenesisAdmissionCoordinator | null;
  recoveryForEvent(event: IpcMainInvokeEvent): Promise<{
    vaultId: string;
    head: { sequence: number; hash: string };
  }> | null;
}

export function createContentPrivateVaultIpcHandlers(
  deps: ContentPrivateVaultIpcDeps,
): {
  create(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultCreateGenesisResult>;
  resume(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultResumeGenesisResult>;
  recover(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultRecoveryResult>;
} {
  return {
    async create(event, ...arguments_) {
      try {
        const coordinator =
          arguments_.length === 0 ? deps.coordinatorForEvent(event) : null;
        if (!coordinator) return { ok: false, error: UNAVAILABLE };
        const result = await coordinator.create();
        return { ok: true, ...result };
      } catch {
        return { ok: false, error: UNAVAILABLE };
      }
    },
    async resume(event, ...arguments_) {
      try {
        const coordinator =
          arguments_.length === 0 ? deps.coordinatorForEvent(event) : null;
        if (!coordinator) return { ok: false, error: UNAVAILABLE };
        const results = await coordinator.resume();
        return {
          ok: true,
          vaults: results.map((result) => ({ ...result })),
        };
      } catch {
        return { ok: false, error: UNAVAILABLE };
      }
    },
    async recover(event, ...arguments_) {
      try {
        const recovery =
          arguments_.length === 0 ? deps.recoveryForEvent(event) : null;
        if (!recovery) return { ok: false, error: UNAVAILABLE };
        const result = await recovery;
        return {
          ok: true,
          vaultId: result.vaultId,
          sequence: result.head.sequence,
          headHash: result.head.hash,
        };
      } catch {
        return { ok: false, error: UNAVAILABLE };
      }
    },
  };
}

export function registerContentPrivateVaultIpc(
  deps: ContentPrivateVaultIpcDeps,
): void {
  const handlers = createContentPrivateVaultIpcHandlers(deps);
  ipcMain.handle(IPC.CONTENT_PRIVATE_VAULT_CREATE_GENESIS, handlers.create);
  ipcMain.handle(IPC.CONTENT_PRIVATE_VAULT_RESUME_GENESIS, handlers.resume);
  ipcMain.handle(IPC.CONTENT_PRIVATE_VAULT_RECOVER, handlers.recover);
}
