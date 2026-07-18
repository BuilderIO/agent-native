import {
  IPC,
  type DesktopPrivateVaultCreateGenesisResult,
  type DesktopPrivateVaultResumeGenesisResult,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { PrivateVaultGenesisAdmissionCoordinator } from "../private-vault/genesis-admission-coordinator.js";

const UNAVAILABLE = "Private Vault is unavailable in this Content surface.";

export interface ContentPrivateVaultIpcDeps {
  coordinatorForEvent(
    event: IpcMainInvokeEvent,
  ): PrivateVaultGenesisAdmissionCoordinator | null;
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
  };
}

export function registerContentPrivateVaultIpc(
  deps: ContentPrivateVaultIpcDeps,
): void {
  const handlers = createContentPrivateVaultIpcHandlers(deps);
  ipcMain.handle(IPC.CONTENT_PRIVATE_VAULT_CREATE_GENESIS, handlers.create);
  ipcMain.handle(IPC.CONTENT_PRIVATE_VAULT_RESUME_GENESIS, handlers.resume);
}
