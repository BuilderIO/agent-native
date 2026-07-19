import type { PrivateVaultLocalActionRegistry } from "@agent-native/private-vault-broker";

import {
  createPrivateVaultContentBrokerRuntime,
  type PrivateVaultContentBrokerRuntime,
} from "./content-broker-runtime.js";
import {
  createPrivateVaultContentDocumentRuntime,
  type PrivateVaultContentDocumentRuntime,
} from "./content-document-runtime.js";
import type { PrivateVaultContentSession } from "./content-genesis-transport.js";
import { PrivateVaultContentRuntimeTransport } from "./content-runtime-transport.js";

interface BrokerLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): ReturnType<PrivateVaultContentBrokerRuntime["health"]>;
}

interface DocumentLifecycle {
  initialize(vaultId: string): Promise<void>;
  close(): void;
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
  #active: {
    vaultId: string;
    broker: BrokerLifecycle | null;
  } | null = null;
  #transition: Promise<void> | null = null;

  constructor(input: {
    descriptor: { read(): Promise<{ vaultId: string }> };
    documents: PrivateContentDocuments;
    brokerActions: {
      create(vaultId: string): Promise<PrivateVaultLocalActionRegistry | null>;
    };
    broker: (actions: PrivateVaultLocalActionRegistry) => BrokerLifecycle;
  }) {
    this.#descriptor = input.descriptor;
    this.#documents = input.documents;
    this.#brokerActions = input.brokerActions;
    this.#broker = input.broker;
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

  async stop(): Promise<void> {
    await this.#transition;
    const active = this.#active;
    this.#active = null;
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
      vaultId: active.vaultId,
      brokerState: broker?.state === "running" ? "online" : "offline",
      broker,
    });
  }

  documents(): PrivateContentDocuments {
    if (!this.#active) throw new PrivateVaultContentRuntimeError();
    return this.#documents;
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
}): PrivateVaultContentRuntime {
  const documents: PrivateVaultContentDocumentRuntime =
    createPrivateVaultContentDocumentRuntime(input);
  const descriptor = new PrivateVaultContentRuntimeTransport(input);
  return new PrivateVaultContentRuntime({
    descriptor,
    documents,
    brokerActions: input.brokerActions,
    broker: (actions) =>
      createPrivateVaultContentBrokerRuntime({ ...input, actions }),
  });
}
