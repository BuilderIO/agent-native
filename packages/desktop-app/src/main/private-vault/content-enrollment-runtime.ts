import { PrivateVaultContentBootstrapTransport } from "./content-bootstrap-transport.js";
import { PrivateVaultContentEnrollmentCoordinator } from "./content-enrollment-coordinator.js";
import {
  PrivateVaultContentEnrollmentAuthorizer,
  PrivateVaultContentEnrollmentCandidate,
} from "./content-enrollment-roles.js";
import { PrivateVaultContentEnrollmentTransport } from "./content-enrollment-transport.js";
import {
  createPrivateVaultNativeServiceClient,
  type PrivateVaultNativeServiceClient,
} from "./native-service-client.js";

interface ContentEnrollmentSession {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

interface EnrollmentRoles {
  readonly candidate: PrivateVaultContentEnrollmentCandidate;
  readonly authorizer: PrivateVaultContentEnrollmentAuthorizer;
}

/** Process-local composition root for the two cross-device enrollment roles. */
export class PrivateVaultContentEnrollmentRuntime {
  readonly #native: PrivateVaultNativeServiceClient;
  readonly #roles = new WeakMap<
    ContentEnrollmentSession,
    Map<string, EnrollmentRoles>
  >();
  readonly #coordinators = new WeakMap<
    ContentEnrollmentSession,
    Map<string, PrivateVaultContentEnrollmentCoordinator>
  >();

  constructor(native: PrivateVaultNativeServiceClient) {
    this.#native = native;
  }

  roles(input: {
    readonly session: ContentEnrollmentSession;
    readonly origin: string;
  }): EnrollmentRoles {
    let byOrigin = this.#roles.get(input.session);
    if (!byOrigin) {
      byOrigin = new Map();
      this.#roles.set(input.session, byOrigin);
    }
    const existing = byOrigin.get(input.origin);
    if (existing) return existing;
    const hosted = new PrivateVaultContentEnrollmentTransport(input);
    const roles = Object.freeze({
      candidate: new PrivateVaultContentEnrollmentCandidate({
        native: this.#native,
        hosted,
        bootstrap: new PrivateVaultContentBootstrapTransport(input),
      }),
      authorizer: new PrivateVaultContentEnrollmentAuthorizer({
        native: this.#native,
        hosted,
      }),
    });
    byOrigin.set(input.origin, roles);
    return roles;
  }

  coordinator(input: {
    readonly session: ContentEnrollmentSession;
    readonly origin: string;
  }): PrivateVaultContentEnrollmentCoordinator {
    let byOrigin = this.#coordinators.get(input.session);
    if (!byOrigin) {
      byOrigin = new Map();
      this.#coordinators.set(input.session, byOrigin);
    }
    const existing = byOrigin.get(input.origin);
    if (existing) return existing;
    const coordinator = new PrivateVaultContentEnrollmentCoordinator({
      native: this.#native,
      hosted: new PrivateVaultContentEnrollmentTransport(input),
    });
    byOrigin.set(input.origin, coordinator);
    return coordinator;
  }
}

export function createPrivateVaultContentEnrollmentRuntime(): PrivateVaultContentEnrollmentRuntime {
  return new PrivateVaultContentEnrollmentRuntime(
    createPrivateVaultNativeServiceClient(),
  );
}
