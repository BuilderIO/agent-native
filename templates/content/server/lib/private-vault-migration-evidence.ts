import type { AncV1MigrationEvidence } from "@agent-native/core/e2ee";

import type {
  PrivateVaultMigrationScope,
  PrivateVaultMigrationStore,
} from "./private-vault-migration.js";

export interface PrivateVaultMigrationEvidencePrincipal extends PrivateVaultMigrationScope {
  readonly endpointId: string;
}

export interface StoredPrivateVaultMigrationEvidence {
  readonly scope: PrivateVaultMigrationScope;
  readonly endpointId: string;
  readonly kind: "export" | "recovery_drill";
  readonly migrationId: string;
  readonly evidenceId: string;
  readonly exportId: string;
  readonly exportBundleHash: string;
  readonly plaintextHash: string;
  readonly sourceSnapshotHash: string;
  readonly objectCount: number;
  readonly createdAt: string;
}

export interface PrivateVaultMigrationEvidenceStore {
  put(
    evidence: StoredPrivateVaultMigrationEvidence,
  ): Promise<"stored" | "existing" | "conflict">;
  getExport(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
    exportBundleHash: string,
  ): Promise<StoredPrivateVaultMigrationEvidence | null>;
  getLatestExport(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
  ): Promise<StoredPrivateVaultMigrationEvidence | null>;
  getRecoveryDrill(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
    recoveryDrillId: string,
    exportBundleHash: string,
  ): Promise<StoredPrivateVaultMigrationEvidence | null>;
}

export class PrivateVaultMigrationEvidenceError extends Error {
  constructor() {
    super("Private Vault migration evidence unavailable");
    this.name = "PrivateVaultMigrationEvidenceError";
  }
}

function fail(): never {
  throw new PrivateVaultMigrationEvidenceError();
}

export class PrivateVaultMigrationEvidenceService {
  readonly #migrations: Pick<PrivateVaultMigrationStore, "get">;
  readonly #evidence: PrivateVaultMigrationEvidenceStore;
  readonly #now: () => string;

  constructor(input: {
    migrations: Pick<PrivateVaultMigrationStore, "get">;
    evidence: PrivateVaultMigrationEvidenceStore;
    now?: () => string;
  }) {
    this.#migrations = input.migrations;
    this.#evidence = input.evidence;
    this.#now = input.now ?? (() => new Date().toISOString());
  }

  async append(
    principal: PrivateVaultMigrationEvidencePrincipal,
    evidence: AncV1MigrationEvidence,
  ) {
    if (evidence.vaultId !== principal.vaultId) fail();
    const current = await this.#migrations.get(principal, evidence.migrationId);
    if (
      !current ||
      (current.ledger.state !== "cutover" &&
        current.ledger.state !== "cleanup_eligible") ||
      current.ledger.vaultId !== evidence.vaultId ||
      current.ledger.sourceSnapshotHash !== evidence.sourceSnapshotHash ||
      current.ledger.sourceCount !== evidence.objectCount ||
      current.ledger.verifiedCount !== evidence.objectCount
    )
      fail();

    if (evidence.kind === "recovery_drill") {
      const exported = await this.#evidence.getExport(
        principal,
        evidence.migrationId,
        evidence.exportBundleHash,
      );
      if (
        !exported ||
        exported.exportId !== evidence.exportId ||
        exported.plaintextHash !== evidence.plaintextHash ||
        exported.sourceSnapshotHash !== evidence.sourceSnapshotHash ||
        exported.objectCount !== evidence.objectCount
      )
        fail();
    }

    const evidenceId =
      evidence.kind === "export" ? evidence.exportId : evidence.recoveryDrillId;
    const result = await this.#evidence.put({
      scope: {
        ownerEmail: principal.ownerEmail,
        orgId: principal.orgId,
        vaultId: principal.vaultId,
      },
      endpointId: principal.endpointId,
      kind: evidence.kind,
      migrationId: evidence.migrationId,
      evidenceId,
      exportId: evidence.exportId,
      exportBundleHash: evidence.exportBundleHash,
      plaintextHash: evidence.plaintextHash,
      sourceSnapshotHash: evidence.sourceSnapshotHash,
      objectCount: evidence.objectCount,
      createdAt: this.#now(),
    });
    if (result === "conflict") fail();
    return {
      kind: evidence.kind,
      migrationId: evidence.migrationId,
      evidenceId,
    };
  }

  async verifyExport(input: {
    scope: PrivateVaultMigrationScope;
    migrationId: string;
    exportBundleHash: string;
  }): Promise<boolean> {
    return Boolean(
      await this.#evidence.getExport(
        input.scope,
        input.migrationId,
        input.exportBundleHash,
      ),
    );
  }

  async latestExport(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
  ): Promise<PrivateVaultMigrationExportEvidenceProjection> {
    const evidence = await this.#evidence.getLatestExport(scope, migrationId);
    if (!evidence) fail();
    return {
      exportId: evidence.exportId,
      exportBundleHash: evidence.exportBundleHash,
      plaintextHash: evidence.plaintextHash,
      sourceSnapshotHash: evidence.sourceSnapshotHash,
      objectCount: evidence.objectCount,
    };
  }

  async verifyRecoveryDrill(input: {
    scope: PrivateVaultMigrationScope;
    migrationId: string;
    recoveryDrillId: string;
    exportBundleHash: string;
  }): Promise<boolean> {
    return Boolean(
      await this.#evidence.getRecoveryDrill(
        input.scope,
        input.migrationId,
        input.recoveryDrillId,
        input.exportBundleHash,
      ),
    );
  }
}

export interface PrivateVaultMigrationExportEvidenceProjection {
  readonly exportId: string;
  readonly exportBundleHash: string;
  readonly plaintextHash: string;
  readonly sourceSnapshotHash: string;
  readonly objectCount: number;
}
