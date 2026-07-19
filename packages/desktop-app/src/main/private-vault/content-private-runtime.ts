import type { PrivateVaultLocalActionRegistry } from "@agent-native/private-vault-broker";

import { PrivateVaultContentBrokerRuntimeTransport } from "./content-broker-runtime-transport.js";
import {
  createPrivateVaultContentBrokerRuntime,
  type PrivateVaultContentBrokerRuntime,
} from "./content-broker-runtime.js";
import {
  createPrivateVaultContentDocumentRuntime,
  type PrivateVaultContentDocumentRuntime,
} from "./content-document-runtime.js";
import type { PrivateVaultContentSession } from "./content-genesis-transport.js";

interface BrokerLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): ReturnType<PrivateVaultContentBrokerRuntime["health"]>;
}

interface DocumentLifecycle {
  initialize(vaultId: string): Promise<void>;
  close(): void;
  actionRegistry(vaultId: string): PrivateVaultLocalActionRegistry;
}

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
  readonly #documents: DocumentLifecycle;
  readonly #broker: (
    actions: PrivateVaultLocalActionRegistry,
  ) => BrokerLifecycle;
  #active: { vaultId: string; broker: BrokerLifecycle } | null = null;
  #transition: Promise<void> | null = null;

  constructor(input: {
    descriptor: { read(): Promise<{ vaultId: string }> };
    documents: DocumentLifecycle;
    broker: (actions: PrivateVaultLocalActionRegistry) => BrokerLifecycle;
  }) {
    this.#descriptor = input.descriptor;
    this.#documents = input.documents;
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
      await active?.broker.stop();
    } catch {
      throw new PrivateVaultContentRuntimeError();
    } finally {
      this.#documents.close();
    }
  }

  health() {
    const active = this.#active;
    return active
      ? Object.freeze({
          vaultId: active.vaultId,
          broker: active.broker.health(),
        })
      : null;
  }

  async #start(): Promise<void> {
    let broker: BrokerLifecycle | null = null;
    try {
      const descriptor = await this.#descriptor.read();
      await this.#documents.initialize(descriptor.vaultId);
      broker = this.#broker(this.#documents.actionRegistry(descriptor.vaultId));
      await broker.start();
      this.#active = { vaultId: descriptor.vaultId, broker };
    } catch {
      await broker?.stop().catch(() => undefined);
      this.#documents.close();
      throw new PrivateVaultContentRuntimeError();
    }
  }
}

export function createPrivateVaultContentRuntime(input: {
  session: PrivateVaultContentSession;
  origin: string;
}): PrivateVaultContentRuntime {
  const documents: PrivateVaultContentDocumentRuntime =
    createPrivateVaultContentDocumentRuntime(input);
  const descriptor = new PrivateVaultContentBrokerRuntimeTransport(input);
  return new PrivateVaultContentRuntime({
    descriptor,
    documents,
    broker: (actions) =>
      createPrivateVaultContentBrokerRuntime({ ...input, actions }),
  });
}
