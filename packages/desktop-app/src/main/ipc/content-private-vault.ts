import {
  IPC,
  type DesktopPrivateVaultCreateGenesisResult,
  type DesktopPrivateVaultRecoveryResult,
  type DesktopPrivateVaultResumeGenesisResult,
  type DesktopPrivateVaultOpenObjectRequest,
  type DesktopPrivateVaultOpenObjectResult,
  type DesktopPrivateVaultSealObjectRequest,
  type DesktopPrivateVaultSealObjectResult,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { PrivateVaultContentObjectRuntime } from "../private-vault/content-object-runtime.js";
import type { PrivateVaultContentObjectTransport } from "../private-vault/content-object-transport.js";
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
  objectContextForEvent(event: IpcMainInvokeEvent): {
    runtime: PrivateVaultContentObjectRuntime;
    transport: PrivateVaultContentObjectTransport;
  } | null;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index])
  );
}

function lowerHex(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length === bytes * 2 &&
    /^[0-9a-f]+$/.test(value)
  );
}

function positiveRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validSealRequest(
  value: unknown,
): value is DesktopPrivateVaultSealObjectRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as DesktopPrivateVaultSealObjectRequest;
  return (
    exactKeys(value, [
      "vaultId",
      "objectId",
      "revision",
      "plaintext",
      ...(input.parentRevisionIds === undefined ? [] : ["parentRevisionIds"]),
    ]) &&
    input.plaintext instanceof Uint8Array &&
    input.plaintext.byteLength > 0 &&
    input.plaintext.byteLength <= 1024 * 1024 &&
    lowerHex(input.vaultId, 16) &&
    lowerHex(input.objectId, 16) &&
    positiveRevision(input.revision) &&
    (input.parentRevisionIds === undefined ||
      (Array.isArray(input.parentRevisionIds) &&
        input.parentRevisionIds.length <= 32 &&
        input.parentRevisionIds.every((value) => lowerHex(value, 32))))
  );
}

function validOpenRequest(
  value: unknown,
): value is DesktopPrivateVaultOpenObjectRequest {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    exactKeys(value, ["vaultId", "objectId", "revision", "revisionId"]) &&
    lowerHex((value as DesktopPrivateVaultOpenObjectRequest).vaultId, 16) &&
    lowerHex((value as DesktopPrivateVaultOpenObjectRequest).objectId, 16) &&
    lowerHex((value as DesktopPrivateVaultOpenObjectRequest).revisionId, 32) &&
    positiveRevision((value as DesktopPrivateVaultOpenObjectRequest).revision)
  );
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
  sealObject(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultSealObjectResult>;
  openObject(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultOpenObjectResult>;
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
    async sealObject(event, ...arguments_) {
      try {
        const context =
          arguments_.length === 1 ? deps.objectContextForEvent(event) : null;
        const request = arguments_[0];
        if (!context || !validSealRequest(request))
          return { ok: false, error: UNAVAILABLE };
        const result = await context.runtime.sealAndUpload({
          transport: context.transport,
          ...request,
        });
        return { ok: true, ...result };
      } catch {
        return { ok: false, error: UNAVAILABLE };
      }
    },
    async openObject(event, ...arguments_) {
      try {
        const context =
          arguments_.length === 1 ? deps.objectContextForEvent(event) : null;
        const request = arguments_[0];
        if (!context || !validOpenRequest(request))
          return { ok: false, error: UNAVAILABLE };
        const result = await context.runtime.downloadAndOpen({
          transport: context.transport,
          ...request,
        });
        return {
          ok: true,
          plaintext: result.plaintext,
          epoch: result.epoch,
          writerEndpointId: result.writerEndpointId,
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
  ipcMain.handle(IPC.CONTENT_PRIVATE_VAULT_SEAL_OBJECT, handlers.sealObject);
  ipcMain.handle(IPC.CONTENT_PRIVATE_VAULT_OPEN_OBJECT, handlers.openObject);
}
