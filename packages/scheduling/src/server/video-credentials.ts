import { BookingLifecycleError } from "./booking-service.js";

/**
 * The reference format a workspace connection keeps in an event type's location:
 * `workspace:<opaque connection id>`. A location that carries one must have it
 * resolved through the framework's scoped resolver before any provider sees it —
 * a provider that reads the legacy credential table by raw id cannot use it.
 */
export const WORKSPACE_CONNECTION_PREFIX = "workspace:";

/** What a host must install so a `workspace:` ref can become provider credentials. */
export type VideoCredentialResolver = (ref: {
  connectionId: string;
  providerKind: string;
}) => Promise<Record<string, string> | null>;

let resolver: VideoCredentialResolver | null = null;

/**
 * Install the scoped resolver. The host owns it, because only the host knows its
 * app id and its request identity; the package must not read workspace secrets
 * on its own.
 */
export function setVideoCredentialResolver(
  next: VideoCredentialResolver | null,
): void {
  resolver = next;
}

export function getVideoCredentialResolver(): VideoCredentialResolver | null {
  return resolver;
}

export interface ResolvedVideoCredential {
  /** The reference as persisted on the location; never rewritten. */
  credentialId: string;
  /** Provider-facing secrets for a workspace connection, absent for legacy ids. */
  credentials?: Record<string, string>;
}

export function isWorkspaceConnectionRef(
  credentialId: string | null | undefined,
): boolean {
  return typeof credentialId === "string"
    ? credentialId.startsWith(WORKSPACE_CONNECTION_PREFIX)
    : false;
}

/**
 * Resolve a location's credential into what a provider can use.
 *
 * A legacy id is returned untouched (the provider reads it as it always has). A
 * `workspace:` ref is resolved through the installed resolver, and every refusal —
 * no resolver, a resolver that answers null, or a resolver that throws — becomes a
 * typed video failure rather than a fallback to a legacy lookup or an unhandled
 * exception. The persisted reference never changes: the location keeps the ref it
 * was authorized with.
 */
export async function resolveVideoCredential(
  credentialId: string | null | undefined,
  providerKind: string,
): Promise<ResolvedVideoCredential | null> {
  if (!credentialId) return null;
  if (!isWorkspaceConnectionRef(credentialId)) {
    return { credentialId };
  }

  const connectionId = credentialId
    .slice(WORKSPACE_CONNECTION_PREFIX.length)
    .trim();
  if (!connectionId) {
    throw new BookingLifecycleError(
      "That video connection is not available.",
      502,
      "video_meeting_creation_failed",
    );
  }

  if (!resolver) {
    throw new BookingLifecycleError(
      "That video connection is not available.",
      502,
      "video_meeting_creation_failed",
    );
  }

  let credentials: Record<string, string> | null;
  try {
    credentials = await resolver({ connectionId, providerKind });
  } catch (error) {
    // A refusal is final: never fall back to a legacy id or an alternate read.
    throw new BookingLifecycleError(
      "That video connection is not available.",
      502,
      "video_meeting_creation_failed",
    );
  }

  if (!credentials || Object.keys(credentials).length === 0) {
    throw new BookingLifecycleError(
      "That video connection is not available.",
      502,
      "video_meeting_creation_failed",
    );
  }

  return { credentialId, credentials };
}
