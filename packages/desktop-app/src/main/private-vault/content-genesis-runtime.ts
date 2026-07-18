import {
  PrivateVaultContentBootstrapTransport,
  type PrivateVaultBootstrapPageConsumer,
} from "./content-bootstrap-transport.js";
import { PrivateVaultContentGenesisTransport } from "./content-genesis-transport.js";
import {
  PrivateVaultGenesisAdmissionCoordinator,
  type PrivateVaultTrustedGenesisOperator,
} from "./genesis-admission-coordinator.js";
import { createPrivateVaultNativeServiceClient } from "./native-service-client.js";

interface ContentGenesisSession {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

/**
 * Process-local composition root for Content's trusted first-device ceremony.
 *
 * Each Electron session/origin pair gets one serialized coordinator. The
 * renderer supplies neither coordinates nor ceremony bytes; its only power is
 * to ask the signed native UI to begin or resume the fixed ceremony.
 */
export class PrivateVaultContentGenesisRuntime {
  readonly #native: PrivateVaultTrustedGenesisOperator &
    PrivateVaultBootstrapPageConsumer;
  readonly #coordinators = new WeakMap<
    ContentGenesisSession,
    Map<string, PrivateVaultGenesisAdmissionCoordinator>
  >();

  constructor(
    native: PrivateVaultTrustedGenesisOperator &
      PrivateVaultBootstrapPageConsumer,
  ) {
    this.#native = native;
  }

  coordinator(input: {
    session: ContentGenesisSession;
    origin: string;
  }): PrivateVaultGenesisAdmissionCoordinator {
    let byOrigin = this.#coordinators.get(input.session);
    if (!byOrigin) {
      byOrigin = new Map();
      this.#coordinators.set(input.session, byOrigin);
    }
    const existing = byOrigin.get(input.origin);
    if (existing) return existing;

    const coordinator = new PrivateVaultGenesisAdmissionCoordinator({
      native: this.#native,
      hosted: new PrivateVaultContentGenesisTransport(input),
    });
    byOrigin.set(input.origin, coordinator);
    return coordinator;
  }

  recover(input: { session: ContentGenesisSession; origin: string }) {
    return new PrivateVaultContentBootstrapTransport(input).transfer(
      this.#native,
    );
  }
}

export function createPrivateVaultContentGenesisRuntime(): PrivateVaultContentGenesisRuntime {
  return new PrivateVaultContentGenesisRuntime(
    createPrivateVaultNativeServiceClient(),
  );
}
