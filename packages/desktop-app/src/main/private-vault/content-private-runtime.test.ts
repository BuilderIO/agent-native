import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentRuntime,
  PrivateVaultContentRuntimeError,
} from "./content-private-runtime.js";

const vaultId = "11".repeat(16);
const subjectAgentId = "22".repeat(16);
const disclosure = {
  disclosureProviderId: "codex-cli",
  disclosureDestination: "gpt-5.6",
} as const;

function harness() {
  const actions = { "list-documents": { run: vi.fn() } };
  const documents = {
    initialize: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const brokerActions = { create: vi.fn(async () => actions) };
  const broker = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    health: vi.fn(() => ({ state: "running" })),
  };
  const factory = vi.fn(() => broker);
  const requester = {
    runAction: vi.fn(async () => ({ id: "result" })),
    listContentGrants: vi.fn(async () => ({ grants: [] })),
    listVaultMembers: vi.fn(async () => ({ members: [] })),
    revokeContentGrant: vi.fn(async (_vaultId: string, grantRef: string) => ({
      state: "revoked",
      grantRef,
    })),
  };
  const disclosures = {
    list: vi.fn(async () => [
      {
        disclosureId: "66".repeat(16),
        endpointId: "77".repeat(16),
        jobId: "88".repeat(16),
        grantId: "99".repeat(16),
        resourceId: "aa".repeat(16),
        operation: "search-documents",
        providerId: "codex-cli",
        destination: "gpt-5.6",
        outcome: "allowed" as const,
        issuedAt: 1_784_000_000,
        expiresAt: 1_784_000_300,
        serverReceivedAt: "2026-07-18T00:00:00.000Z",
      },
    ]),
  };
  const migration = {
    listCandidates: vi.fn(async () => ["legacy-document"]),
    active: vi.fn(
      async () =>
        null as {
          ledger: {
            migrationId: string;
            state: string;
            sourceCount: number;
          };
        } | null,
    ),
    cleanup: vi.fn(async () => ({ state: "cleaned" })),
    migrate: vi.fn(async () => ({ state: "cutover" })),
  };
  const migrationExport = {
    export: vi.fn(async () => ({ exportId: "44".repeat(16) })),
  };
  const migrationRecovery = {
    verify: vi.fn(async () => ({ recoveryDrillId: "55".repeat(16) })),
  };
  const migrationEvidence = {
    exportEvidence: vi.fn(async () => ({ exportId: "44".repeat(16) })),
  };
  const authority = { refresh: vi.fn(async () => ({ sequence: 9 })) };
  const scheduled: Array<() => void> = [];
  const authorityScheduler = {
    every: vi.fn((_milliseconds: number, callback: () => void) => {
      scheduled.push(callback);
      return callback;
    }),
    clear: vi.fn(),
  };
  return {
    actions,
    broker,
    documents,
    brokerActions,
    factory,
    requester,
    disclosures,
    migration,
    migrationExport,
    migrationRecovery,
    migrationEvidence,
    authority,
    authorityScheduler,
    scheduled,
    runtime: new PrivateVaultContentRuntime({
      descriptor: { read: vi.fn(async () => ({ vaultId })) },
      documents: documents as never,
      brokerActions,
      broker: factory as never,
      requester,
      disclosures,
      migration,
      migrationExport,
      migrationRecovery,
      migrationEvidence,
      authority,
      authorityScheduler,
    }),
  };
}

describe("PrivateVaultContentRuntime", () => {
  it("binds attended migration to the internally active vault", async () => {
    const source = harness();
    await source.runtime.start();
    await expect(
      source.runtime.migrateLegacyContent({
        sourceDocumentIds: ["legacy-document"],
      }),
    ).resolves.toEqual({ state: "cutover" });
    expect(source.migration.migrate).toHaveBeenCalledWith({
      vaultId,
      sourceDocumentIds: ["legacy-document"],
    });
    await expect(
      source.runtime.listLegacyMigrationCandidates(),
    ).resolves.toEqual(["legacy-document"]);
    expect(source.migration.listCandidates).toHaveBeenCalledWith(vaultId);
    await expect(
      source.runtime.exportLegacyMigration("33".repeat(16)),
    ).resolves.toEqual({ exportId: "44".repeat(16) });
    expect(source.migrationExport.export).toHaveBeenCalledWith(
      vaultId,
      "33".repeat(16),
    );
    await expect(
      source.runtime.verifyLegacyMigrationRecovery("33".repeat(16)),
    ).resolves.toEqual({ recoveryDrillId: "55".repeat(16) });
    expect(source.migrationRecovery.verify).toHaveBeenCalledWith(
      vaultId,
      "33".repeat(16),
    );
    await expect(
      source.runtime.cleanupLegacyMigration("33".repeat(16)),
    ).resolves.toEqual({ state: "cleaned" });
    expect(source.migration.cleanup).toHaveBeenCalledWith(
      vaultId,
      "33".repeat(16),
    );
  });

  it("reconstructs attended migration ceremony state after restart", async () => {
    const source = harness();
    source.migration.active.mockResolvedValueOnce({
      ledger: {
        migrationId: "33".repeat(16),
        state: "cutover",
        sourceCount: 2,
      },
    });
    await source.runtime.start();
    await expect(source.runtime.legacyMigrationStatus()).resolves.toEqual({
      current: {
        migrationId: "33".repeat(16),
        state: "cutover",
        sourceCount: 2,
        exportSaved: true,
      },
    });
    expect(source.migrationEvidence.exportEvidence).toHaveBeenCalledWith(
      vaultId,
      "33".repeat(16),
    );
  });

  it("starts documents before a separately constructed broker registry", async () => {
    const source = harness();
    await source.runtime.start();
    expect(source.documents.initialize).toHaveBeenCalledWith(vaultId);
    expect(source.brokerActions.create).toHaveBeenCalledWith(vaultId);
    expect(source.factory).toHaveBeenCalledWith(source.actions);
    expect(source.runtime.health()).toEqual({
      brokerState: "online",
      broker: { state: "running" },
    });
    source.broker.health.mockReturnValue({ state: "revoked" });
    expect(source.runtime.health()).toEqual({
      brokerState: "offline",
      broker: { state: "revoked" },
    });
    await source.runtime.stop();
    expect(source.broker.stop).toHaveBeenCalledOnce();
    expect(source.documents.close).toHaveBeenCalledOnce();
  });

  it("renews endpoint-witnessed authority at startup and on a five-minute cadence", async () => {
    const source = harness();
    await source.runtime.start();
    expect(source.authority.refresh).toHaveBeenCalledWith(vaultId);
    expect(source.authorityScheduler.every).toHaveBeenCalledWith(
      5 * 60 * 1000,
      expect.any(Function),
    );
    source.scheduled[0]!();
    await vi.waitFor(() =>
      expect(source.authority.refresh).toHaveBeenCalledTimes(2),
    );
    await source.runtime.stop();
    expect(source.authorityScheduler.clear).toHaveBeenCalledOnce();
  });

  it("keeps endpoint documents open while a failed broker stays offline", async () => {
    const source = harness();
    source.broker.start.mockRejectedValueOnce(new Error("locked"));
    await expect(source.runtime.start()).resolves.toBeUndefined();
    expect(source.documents.close).not.toHaveBeenCalled();
    expect(source.runtime.health()).toEqual({
      brokerState: "offline",
      broker: null,
    });
  });

  it("serializes lifecycle transitions", async () => {
    const source = harness();
    const first = source.runtime.start();
    await expect(source.runtime.start()).rejects.toBeInstanceOf(
      PrivateVaultContentRuntimeError,
    );
    await first;
  });

  it("lets trusted agent and UI startup converge on one transition", async () => {
    const source = harness();
    const first = source.runtime.ensureStarted();
    const second = source.runtime.ensureStarted();
    await Promise.all([first, second]);
    await source.runtime.ensureStarted();
    expect(source.documents.initialize).toHaveBeenCalledOnce();
  });

  it("keeps agent jobs behind the active signed runtime lifecycle", async () => {
    const source = harness();
    await expect(
      source.runtime.runAgentAction({
        actionName: "list-documents",
        args: {},
        subjectAgentId,
        ...disclosure,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultContentRuntimeError);
    await source.runtime.start();
    expect(source.runtime.applicationState()).toEqual({ view: "list" });
    source.runtime.setApplicationState({
      view: "editor",
      documentId: "33".repeat(16),
    });
    await expect(
      source.runtime.runAgentAction({
        actionName: "view-screen",
        args: {},
        subjectAgentId,
        ...disclosure,
      }),
    ).resolves.toEqual({
      view: "editor",
      documentId: "33".repeat(16),
    });
    expect(source.requester.runAction).not.toHaveBeenCalled();
    await expect(
      source.runtime.runAgentAction({
        actionName: "list-documents",
        args: {},
        subjectAgentId,
        ...disclosure,
      }),
    ).resolves.toEqual({ id: "result" });
    expect(source.requester.runAction).toHaveBeenCalledWith({
      actionName: "list-documents",
      args: {},
      subjectAgentId,
      ...disclosure,
    });
    await source.runtime.stop();
    await expect(
      source.runtime.runAgentAction({
        actionName: "list-documents",
        args: {},
        subjectAgentId,
        ...disclosure,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultContentRuntimeError);
  });

  it("keeps grant inventory and revocation behind the active signed runtime", async () => {
    const source = harness();
    const grantRef = "33".repeat(32);
    await expect(source.runtime.listAgentGrants()).rejects.toBeInstanceOf(
      PrivateVaultContentRuntimeError,
    );
    await source.runtime.start();
    await expect(source.runtime.listAgentGrants()).resolves.toEqual({
      grants: [],
    });
    await expect(source.runtime.listVaultMembers()).resolves.toEqual({
      members: [],
    });
    await expect(source.runtime.listDisclosureActivity()).resolves.toEqual([
      expect.objectContaining({
        operation: "search-documents",
        outcome: "allowed",
      }),
    ]);
    await expect(source.runtime.revokeAgentGrant(grantRef)).resolves.toEqual({
      state: "revoked",
      grantRef,
    });
    expect(source.requester.listContentGrants).toHaveBeenCalledWith(vaultId);
    expect(source.requester.listVaultMembers).toHaveBeenCalledWith(vaultId);
    expect(source.disclosures.list).toHaveBeenCalledWith(vaultId);
    expect(source.requester.revokeContentGrant).toHaveBeenCalledWith(
      vaultId,
      grantRef,
    );
  });
});
