import type { PrivateVaultLocalActionRegistry } from "@agent-native/private-vault-broker";
import type { DesktopPrivateContentApplicationState } from "@shared/ipc-channels";

import { PrivateVaultContentBrokerRuntimeTransport } from "./content-broker-runtime-transport.js";
import {
  createPrivateVaultContentBrokerRuntime,
  type PrivateVaultContentBrokerRuntime,
} from "./content-broker-runtime.js";
import { PrivateVaultContentDocumentRuntime } from "./content-document-runtime.js";
import type { PrivateVaultContentSession } from "./content-genesis-transport.js";
import {
  PrivateVaultContentMigrationExportRuntime,
  type PrivateVaultMigrationArchiveWriter,
} from "./content-migration-export.js";
import { PrivateVaultContentMigrationRuntime } from "./content-migration-runtime.js";
import { PrivateVaultContentMigrationTransport } from "./content-migration-transport.js";
import { PrivateVaultContentObjectRuntime } from "./content-object-runtime.js";
import { PrivateVaultContentObjectTransport } from "./content-object-transport.js";
import {
  createPrivateVaultContentRequesterRuntime,
  type PrivateVaultContentRequesterRuntime,
} from "./content-requester-runtime.js";
import { PrivateVaultContentRuntimeTransport } from "./content-runtime-transport.js";
import { createEncryptedContentIndexStore } from "./encrypted-content-index-store.js";
import { createPrivateVaultNativeServiceClient } from "./native-service-client.js";

interface BrokerLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): ReturnType<PrivateVaultContentBrokerRuntime["health"]>;
}

interface DocumentLifecycle {
  initialize(vaultId: string): Promise<void>;
  close(): void;
}

interface RequesterSurface {
  runAction(input: {
    actionName: string;
    args: unknown;
    subjectAgentId: string;
    disclosureProviderId: string;
    disclosureDestination: string;
  }): Promise<unknown>;
  listContentGrants(vaultId: string): Promise<unknown>;
  listVaultMembers(vaultId: string): Promise<unknown>;
  revokeContentGrant(vaultId: string, grantRef: string): Promise<unknown>;
}

interface MigrationSurface {
  listCandidates(vaultId: string): Promise<readonly string[]>;
  migrate(input: {
    readonly vaultId: string;
    readonly sourceDocumentIds?: readonly string[];
    readonly migrationId?: string;
  }): Promise<unknown>;
}

interface MigrationExportSurface {
  export(vaultId: string, migrationId: string): Promise<unknown>;
}

type PrivateContentDocuments = DocumentLifecycle &
  Pick<
    PrivateVaultContentDocumentRuntime,
    | "listDocuments"
    | "getDocument"
    | "searchDocuments"
    | "createDocument"
    | "updateDocument"
    | "deleteDocument"
    | "listDocumentVersions"
    | "restoreDocumentVersion"
  >;

export class PrivateVaultContentRuntimeError extends Error {
  constructor() {
    super("Private Content runtime unavailable");
    this.name = "PrivateVaultContentRuntimeError";
  }
}

/**
 * Owns the one signed-Desktop lifecycle shared by local UI and unattended
 * broker actions. Remote Content JavaScript never receives this object.
 */
export class PrivateVaultContentRuntime {
  readonly #descriptor: { read(): Promise<{ vaultId: string }> };
  readonly #documents: PrivateContentDocuments;
  readonly #brokerActions: {
    create(vaultId: string): Promise<PrivateVaultLocalActionRegistry | null>;
  };
  readonly #broker: (
    actions: PrivateVaultLocalActionRegistry,
  ) => BrokerLifecycle;
  readonly #requester: RequesterSurface;
  readonly #migration: MigrationSurface;
  readonly #migrationExport: MigrationExportSurface;
  #active: {
    vaultId: string;
    broker: BrokerLifecycle | null;
  } | null = null;
  #transition: Promise<void> | null = null;
  #applicationState: DesktopPrivateContentApplicationState = Object.freeze({
    view: "list",
  });

  constructor(input: {
    descriptor: { read(): Promise<{ vaultId: string }> };
    documents: PrivateContentDocuments;
    brokerActions: {
      create(vaultId: string): Promise<PrivateVaultLocalActionRegistry | null>;
    };
    broker: (actions: PrivateVaultLocalActionRegistry) => BrokerLifecycle;
    requester: RequesterSurface;
    migration: MigrationSurface;
    migrationExport: MigrationExportSurface;
  }) {
    this.#descriptor = input.descriptor;
    this.#documents = input.documents;
    this.#brokerActions = input.brokerActions;
    this.#broker = input.broker;
    this.#requester = input.requester;
    this.#migration = input.migration;
    this.#migrationExport = input.migrationExport;
  }

  start(): Promise<void> {
    if (this.#active || this.#transition)
      return Promise.reject(new PrivateVaultContentRuntimeError());
    const transition = this.#start();
    this.#transition = transition;
    return transition.finally(() => {
      if (this.#transition === transition) this.#transition = null;
    });
  }

  ensureStarted(): Promise<void> {
    if (this.#active) return Promise.resolve();
    if (this.#transition) return this.#transition;
    return this.start();
  }

  async stop(): Promise<void> {
    await this.#transition;
    const active = this.#active;
    this.#active = null;
    this.#applicationState = Object.freeze({ view: "list" });
    try {
      await active?.broker?.stop();
    } catch {
      throw new PrivateVaultContentRuntimeError();
    } finally {
      this.#documents.close();
    }
  }

  health() {
    const active = this.#active;
    if (!active) return null;
    const broker = active.broker?.health() ?? null;
    return Object.freeze({
      brokerState: broker?.state === "running" ? "online" : "offline",
      broker,
    });
  }

  activeVaultId(): string {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    return this.#active.vaultId;
  }

  documents(): PrivateContentDocuments {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    return this.#documents;
  }

  async listAgentGrants() {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    try {
      return await this.#requester.listContentGrants(this.#active.vaultId);
    } catch {
      throw new PrivateVaultContentRuntimeError();
    }
  }

  async listVaultMembers() {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    try {
      return await this.#requester.listVaultMembers(this.#active.vaultId);
    } catch {
      throw new PrivateVaultContentRuntimeError();
    }
  }

  async revokeAgentGrant(grantRef: string) {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    try {
      return await this.#requester.revokeContentGrant(
        this.#active.vaultId,
        grantRef,
      );
    } catch {
      throw new PrivateVaultContentRuntimeError();
    }
  }

  async runAgentAction(input: {
    actionName: string;
    args: unknown;
    subjectAgentId: string;
    disclosureProviderId: string;
    disclosureDestination: string;
  }) {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    if (input.actionName === "view-screen") return this.applicationState();
    try {
      return await this.#requester.runAction(input);
    } catch {
      throw new PrivateVaultContentRuntimeError();
    }
  }

  async migrateLegacyContent(input: {
    readonly sourceDocumentIds?: readonly string[];
    readonly migrationId?: string;
  }) {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    try {
      return await this.#migration.migrate({
        vaultId: this.#active.vaultId,
        ...input,
      });
    } catch {
      throw new PrivateVaultContentRuntimeError();
    }
  }

  async listLegacyMigrationCandidates() {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    try {
      return await this.#migration.listCandidates(this.#active.vaultId);
    } catch {
      throw new PrivateVaultContentRuntimeError();
    }
  }

  async exportLegacyMigration(migrationId: string) {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    try {
      return await this.#migrationExport.export(
        this.#active.vaultId,
        migrationId,
      );
    } catch {
      throw new PrivateVaultContentRuntimeError();
    }
  }

  applicationState(): DesktopPrivateContentApplicationState {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    return this.#applicationState;
  }

  setApplicationState(state: DesktopPrivateContentApplicationState): void {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    this.#applicationState = Object.freeze({ ...state });
  }

  async #start(): Promise<void> {
    try {
      const descriptor = await this.#descriptor.read();
      await this.#documents.initialize(descriptor.vaultId);
      let broker: BrokerLifecycle | null = null;
      try {
        const actions = await this.#brokerActions.create(descriptor.vaultId);
        if (actions) {
          broker = this.#broker(actions);
          await broker.start();
        }
      } catch {
        await broker?.stop().catch(() => undefined);
        broker = null;
      }
      this.#active = {
        vaultId: descriptor.vaultId,
        broker,
      };
      this.#applicationState = Object.freeze({ view: "list" });
    } catch {
      this.#documents.close();
      throw new PrivateVaultContentRuntimeError();
    }
  }
}

export function createPrivateVaultContentRuntime(input: {
  session: PrivateVaultContentSession;
  origin: string;
  brokerActions: {
    create(vaultId: string): Promise<PrivateVaultLocalActionRegistry | null>;
  };
  archiveWriter: PrivateVaultMigrationArchiveWriter;
}): PrivateVaultContentRuntime {
  const index = createEncryptedContentIndexStore();
  const transport = new PrivateVaultContentObjectTransport(input);
  const native = createPrivateVaultNativeServiceClient();
  const objects = new PrivateVaultContentObjectRuntime(native);
  const migrationHosted = new PrivateVaultContentMigrationTransport(input);
  const documents = new PrivateVaultContentDocumentRuntime({
    index,
    transport,
    objects,
  });
  const migration = new PrivateVaultContentMigrationRuntime({
    hosted: migrationHosted,
    index,
    objects: {
      sealAndUpload: (request) =>
        objects.sealAndUpload({ transport, ...request }),
      downloadAndOpen: (request) =>
        objects.downloadAndOpen({ transport, ...request }),
    },
  });
  const migrationExport = new PrivateVaultContentMigrationExportRuntime({
    hosted: migrationHosted,
    objects: {
      downloadAndOpen: (request) =>
        objects.downloadAndOpen({ transport, ...request }),
    },
    native,
    writer: input.archiveWriter,
  });
  const descriptor = new PrivateVaultContentRuntimeTransport(input);
  const requester: PrivateVaultContentRequesterRuntime =
    createPrivateVaultContentRequesterRuntime({
      ...input,
      descriptor: new PrivateVaultContentBrokerRuntimeTransport(input),
    });
  return new PrivateVaultContentRuntime({
    descriptor,
    documents,
    brokerActions: input.brokerActions,
    broker: (actions) =>
      createPrivateVaultContentBrokerRuntime({ ...input, actions }),
    requester,
    migration,
    migrationExport,
  });
}
