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
      }),
      authorizer: new PrivateVaultContentEnrollmentAuthorizer({
        native: this.#native,
        hosted,
      }),
    });
    byOrigin.set(input.origin, roles);
    return roles;
  }
}

export function createPrivateVaultContentEnrollmentRuntime(): PrivateVaultContentEnrollmentRuntime {
  return new PrivateVaultContentEnrollmentRuntime(
    createPrivateVaultNativeServiceClient(),
  );
}
