import {
  IPC,
  type DesktopPrivateVaultAdvanceBrokerAuthorizerResult,
  type DesktopPrivateVaultAdvanceBrokerCandidateResult,
  type DesktopPrivateVaultBeginBrokerEnrollmentResult,
  type DesktopPrivateVaultCreateGenesisResult,
  type DesktopPrivateVaultEnrollBrokerResult,
  type DesktopPrivateVaultRecoveryResult,
  type DesktopPrivateVaultResumeGenesisResult,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type {
  PrivateVaultContentEnrollmentAuthorizer,
  PrivateVaultContentEnrollmentCandidate,
} from "../private-vault/content-enrollment-roles.js";
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
  brokerEnrollmentForEvent(event: IpcMainInvokeEvent): Promise<{
    vaultId: string;
  }> | null;
  enrollmentCandidateForEvent(
    event: IpcMainInvokeEvent,
  ): PrivateVaultContentEnrollmentCandidate | null;
  enrollmentAuthorizerForEvent(
    event: IpcMainInvokeEvent,
  ): PrivateVaultContentEnrollmentAuthorizer | null;
}

function exactRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && key in record ? record : null;
}

function invitationBytes(value: unknown): Uint8Array | null {
  const record = exactRecord(value, "invitation");
  if (
    !record ||
    typeof record.invitation !== "string" ||
    record.invitation.length === 0 ||
    record.invitation.length > 2731 ||
    !/^[A-Za-z0-9_-]+$/u.test(record.invitation)
  ) {
    return null;
  }
  const decoded = Buffer.from(record.invitation, "base64url");
  return decoded.byteLength > 0 &&
    decoded.byteLength <= 2048 &&
    decoded.toString("base64url") === record.invitation
    ? Uint8Array.from(decoded)
    : null;
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
  enrollBroker(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultEnrollBrokerResult>;
  beginBrokerEnrollment(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultBeginBrokerEnrollmentResult>;
  advanceBrokerCandidate(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultAdvanceBrokerCandidateResult>;
  advanceBrokerAuthorizer(
    event: IpcMainInvokeEvent,
    ...arguments_: unknown[]
  ): Promise<DesktopPrivateVaultAdvanceBrokerAuthorizerResult>;
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
    async enrollBroker(event, ...arguments_) {
      try {
        const enrollment =
          arguments_.length === 0 ? deps.brokerEnrollmentForEvent(event) : null;
        if (!enrollment) return { ok: false, error: UNAVAILABLE };
        const result = await enrollment;
        return { ok: true, state: "active", vaultId: result.vaultId };
      } catch {
        return { ok: false, error: UNAVAILABLE };
      }
    },
    async beginBrokerEnrollment(event, ...arguments_) {
      try {
        const request =
          arguments_.length === 1
            ? exactRecord(arguments_[0], "vaultId")
            : null;
        const candidate = request
          ? deps.enrollmentCandidateForEvent(event)
          : null;
        if (
          !candidate ||
          typeof request?.vaultId !== "string" ||
          !/^[0-9a-f]{32}$/u.test(request.vaultId)
        ) {
          return { ok: false, error: UNAVAILABLE };
        }
        const progress = await candidate.begin(request.vaultId);
        if (progress.state !== "awaiting-authorizer") {
          return { ok: false, error: UNAVAILABLE };
        }
        return {
          ok: true,
          state: progress.state,
          invitation: Buffer.from(progress.invitation).toString("base64url"),
        };
      } catch {
        return { ok: false, error: UNAVAILABLE };
      }
    },
    async advanceBrokerCandidate(event, ...arguments_) {
      try {
        const invitation =
          arguments_.length === 1 ? invitationBytes(arguments_[0]) : null;
        const candidate = invitation
          ? deps.enrollmentCandidateForEvent(event)
          : null;
        if (!candidate || !invitation) {
          return { ok: false, error: UNAVAILABLE };
        }
        const progress = await candidate.advance(invitation);
        if (progress.state === "awaiting-authorizer") {
          return {
            ok: true,
            state: progress.state,
            invitation: Buffer.from(progress.invitation).toString("base64url"),
          };
        }
        if (progress.state === "active") {
          return {
            ok: true,
            state: progress.state,
            vaultId: progress.result.vaultId,
          };
        }
        return { ok: true, state: progress.state };
      } catch {
        return { ok: false, error: UNAVAILABLE };
      }
    },
    async advanceBrokerAuthorizer(event, ...arguments_) {
      try {
        const invitation =
          arguments_.length === 1 ? invitationBytes(arguments_[0]) : null;
        const authorizer = invitation
          ? deps.enrollmentAuthorizerForEvent(event)
          : null;
        if (!authorizer || !invitation) {
          return { ok: false, error: UNAVAILABLE };
        }
        const progress = await authorizer.advance(invitation);
        return { ok: true, state: progress.state };
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
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_VAULT_ENROLL_BROKER,
    handlers.enrollBroker,
  );
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_VAULT_BEGIN_BROKER_ENROLLMENT,
    handlers.beginBrokerEnrollment,
  );
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_VAULT_ADVANCE_BROKER_CANDIDATE,
    handlers.advanceBrokerCandidate,
  );
  ipcMain.handle(
    IPC.CONTENT_PRIVATE_VAULT_ADVANCE_BROKER_AUTHORIZER,
    handlers.advanceBrokerAuthorizer,
  );
}
