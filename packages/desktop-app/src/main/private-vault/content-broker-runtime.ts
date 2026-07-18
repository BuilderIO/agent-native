import {
  PrivateVaultBrokerSupervisor,
  PrivateVaultBrokerWorker,
  PrivateVaultContentActionExecutor,
  SignedHostedBrokerTransport,
  type BrokerStateStore,
  type PrivateVaultBrokerSupervisorHealth,
  type PrivateVaultLocalActionRegistry,
} from "@agent-native/private-vault-broker";

import {
  PrivateVaultContentBrokerRuntimeTransport,
  type PrivateVaultContentBrokerRuntimeDescriptor,
} from "./content-broker-runtime-transport.js";
import { createEncryptedBrokerStateStore } from "./encrypted-broker-state-store.js";
import {
  createPrivateVaultNativeServiceClient,
  type PrivateVaultNativeServiceClient,
} from "./native-service-client.js";

interface RuntimeSession {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

interface RuntimeSupervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): PrivateVaultBrokerSupervisorHealth;
}

export class PrivateVaultContentBrokerRuntimeError extends Error {
  constructor() {
    super("Private Vault Content broker runtime unavailable");
    this.name = "PrivateVaultContentBrokerRuntimeError";
  }
}

interface RuntimeComposeInput {
  readonly descriptor: PrivateVaultContentBrokerRuntimeDescriptor;
  readonly origin: string;
  readonly native: PrivateVaultNativeServiceClient;
  readonly store: BrokerStateStore;
  readonly actions: PrivateVaultLocalActionRegistry;
}

export interface PrivateVaultContentBrokerRuntimeOptions {
  readonly origin: string;
  readonly descriptor: {
    read(): Promise<PrivateVaultContentBrokerRuntimeDescriptor>;
  };
  readonly native: PrivateVaultNativeServiceClient;
  readonly store: BrokerStateStore;
  readonly actions: PrivateVaultLocalActionRegistry;
  readonly compose?: (input: RuntimeComposeInput) => RuntimeSupervisor;
}

function composeSupervisor(
  input: RuntimeComposeInput & {
    readonly descriptorTransport: {
      read(): Promise<PrivateVaultContentBrokerRuntimeDescriptor>;
    };
  },
): RuntimeSupervisor {
  const signer = {
    signEndpointRequest: async (unsignedProof: Uint8Array) =>
      (
        await input.native.signEndpointRequest({
          version: 1,
          suite: "anc/v1",
          operation: "signEndpointRequest",
          unsignedProof,
        })
      ).signature,
  };
  const transport = new SignedHostedBrokerTransport({
    baseUrl: input.origin,
    vaultId: input.descriptor.vaultId,
    endpointId: input.descriptor.endpointId,
    signer,
  });
  const worker = new PrivateVaultBrokerWorker({
    vaultId: input.descriptor.vaultId,
    endpointId: input.descriptor.endpointId,
    native: input.native,
    transport,
    executor: new PrivateVaultContentActionExecutor(input.actions),
  });
  return new PrivateVaultBrokerSupervisor({
    vaultId: input.descriptor.vaultId,
    endpointId: input.descriptor.endpointId,
    native: {
      health: () => input.native.health(),
      unlock: (request) => input.native.unlock(request.vaultId),
      lock: () => input.native.lock(),
    },
    worker,
    store: input.store,
    revocation: {
      verify: async ({ vaultId, endpointId }) => {
        const current = await input.descriptorTransport.read();
        return current.vaultId === vaultId && current.endpointId === endpointId
          ? "active"
          : "revoked";
      },
    },
  });
}

/** One serialized broker lifecycle for one authenticated Content session. */
export class PrivateVaultContentBrokerRuntime {
  readonly #options: PrivateVaultContentBrokerRuntimeOptions;
  #supervisor: RuntimeSupervisor | null = null;
  #transition: Promise<void> | null = null;

  constructor(options: PrivateVaultContentBrokerRuntimeOptions) {
    this.#options = options;
  }

  start(): Promise<void> {
    if (this.#supervisor || this.#transition)
      return Promise.reject(new PrivateVaultContentBrokerRuntimeError());
    const operation = this.#start();
    this.#transition = operation;
    return operation.finally(() => {
      if (this.#transition === operation) this.#transition = null;
    });
  }

  async stop(): Promise<void> {
    await this.#transition;
    const supervisor = this.#supervisor;
    this.#supervisor = null;
    if (!supervisor) return;
    try {
      await supervisor.stop();
    } catch {
      throw new PrivateVaultContentBrokerRuntimeError();
    }
  }

  health(): PrivateVaultBrokerSupervisorHealth | null {
    return this.#supervisor?.health() ?? null;
  }

  async #start(): Promise<void> {
    try {
      const descriptor = await this.#options.descriptor.read();
      const compose =
        this.#options.compose ??
        ((input) =>
          composeSupervisor({
            ...input,
            descriptorTransport: this.#options.descriptor,
          }));
      const supervisor = compose({
        descriptor,
        origin: this.#options.origin,
        native: this.#options.native,
        store: this.#options.store,
        actions: this.#options.actions,
      });
      await supervisor.start();
      this.#supervisor = supervisor;
    } catch {
      await this.#options.native.lock().catch(() => undefined);
      throw new PrivateVaultContentBrokerRuntimeError();
    }
  }
}

export function createPrivateVaultContentBrokerRuntime(input: {
  readonly session: RuntimeSession;
  readonly origin: string;
  readonly actions: PrivateVaultLocalActionRegistry;
}): PrivateVaultContentBrokerRuntime {
  return new PrivateVaultContentBrokerRuntime({
    origin: input.origin,
    descriptor: new PrivateVaultContentBrokerRuntimeTransport(input),
    native: createPrivateVaultNativeServiceClient(),
    store: createEncryptedBrokerStateStore(),
    actions: input.actions,
  });
}
