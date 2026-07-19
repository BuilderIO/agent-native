import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import type { PrivateVaultGenesisAdmissionCoordinator } from "../private-vault/genesis-admission-coordinator.js";
import { createContentPrivateVaultIpcHandlers } from "./content-private-vault.js";

const event = {} as Electron.IpcMainInvokeEvent;
const noEnrollment = {
  brokerEnrollmentForEvent: () => null,
  enrollmentCandidateForEvent: () => null,
  enrollmentAuthorizerForEvent: () => null,
};

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
      ...noEnrollment,
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

  it("enrolls a personal broker without renderer-supplied coordinates", async () => {
    const brokerEnrollmentForEvent = vi.fn(async () => ({
      vaultId: "00112233445566778899aabbccddeeff",
    }));
    const handlers = createContentPrivateVaultIpcHandlers({
      ...noEnrollment,
      brokerEnrollmentForEvent,
      coordinatorForEvent: () => coordinator(),
      recoveryForEvent: () => null,
    });

    await expect(handlers.enrollBroker(event)).resolves.toEqual({
      ok: true,
      state: "active",
      vaultId: "00112233445566778899aabbccddeeff",
    });
    await expect(
      handlers.enrollBroker(event, { vaultId: "forbidden" }),
    ).resolves.toMatchObject({ ok: false });
    expect(brokerEnrollmentForEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects every renderer-supplied argument before resolving authority", async () => {
    const coordinatorForEvent = vi.fn(() => coordinator());
    const handlers = createContentPrivateVaultIpcHandlers({
      ...noEnrollment,
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
      ...noEnrollment,
      coordinatorForEvent: () => null,
      recoveryForEvent: () => null,
    });
    const failed = createContentPrivateVaultIpcHandlers({
      ...noEnrollment,
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

  it("exposes only bounded public invitation progress for split enrollment roles", async () => {
    const invitation = Uint8Array.of(0xa1, 0x01, 0x01);
    const candidate = {
      begin: vi.fn(async () => ({
        state: "awaiting-authorizer" as const,
        invitation,
      })),
      advance: vi.fn(async () => ({
        state: "active" as const,
        result: { vaultId: "00".repeat(16) },
      })),
    };
    const authorizer = {
      advance: vi.fn(async () => ({ state: "awaiting-candidate" as const })),
    };
    const handlers = createContentPrivateVaultIpcHandlers({
      brokerEnrollmentForEvent: () => null,
      coordinatorForEvent: () => null,
      recoveryForEvent: () => null,
      enrollmentCandidateForEvent: () => candidate as never,
      enrollmentAuthorizerForEvent: () => authorizer as never,
    });
    const encoded = Buffer.from(invitation).toString("base64url");

    await expect(
      handlers.beginBrokerEnrollment(event, { vaultId: "00".repeat(16) }),
    ).resolves.toEqual({
      ok: true,
      state: "awaiting-authorizer",
      invitation: encoded,
    });
    await expect(
      handlers.advanceBrokerCandidate(event, { invitation: encoded }),
    ).resolves.toEqual({
      ok: true,
      state: "active",
      vaultId: "00".repeat(16),
    });
    await expect(
      handlers.advanceBrokerAuthorizer(event, { invitation: encoded }),
    ).resolves.toEqual({ ok: true, state: "awaiting-candidate" });
    expect(candidate.begin).toHaveBeenCalledWith("00".repeat(16));
    expect(candidate.advance).toHaveBeenCalledWith(invitation);
    expect(authorizer.advance).toHaveBeenCalledWith(invitation);
  });

  it("rejects malformed or extra enrollment bridge input before native authority", async () => {
    const enrollmentCandidateForEvent = vi.fn();
    const enrollmentAuthorizerForEvent = vi.fn();
    const handlers = createContentPrivateVaultIpcHandlers({
      brokerEnrollmentForEvent: () => null,
      coordinatorForEvent: () => null,
      recoveryForEvent: () => null,
      enrollmentCandidateForEvent,
      enrollmentAuthorizerForEvent,
    });
    const expected = {
      ok: false,
      error: "Private Vault is unavailable in this Content surface.",
    };

    await expect(
      handlers.beginBrokerEnrollment(event, {
        vaultId: "00".repeat(16),
        privateKey: "forbidden",
      }),
    ).resolves.toEqual(expected);
    await expect(
      handlers.advanceBrokerCandidate(event, { invitation: "not+base64" }),
    ).resolves.toEqual(expected);
    await expect(
      handlers.advanceBrokerAuthorizer(event, {
        invitation: "AQ",
        sasCode: "forbidden",
      }),
    ).resolves.toEqual(expected);
    expect(enrollmentCandidateForEvent).not.toHaveBeenCalled();
    expect(enrollmentAuthorizerForEvent).not.toHaveBeenCalled();
  });
});
