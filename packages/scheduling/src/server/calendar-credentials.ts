import { BookingLifecycleError } from "./booking-service.js";

/**
 * A calendar connection can be identified two ways: a legacy credential row that a
 * provider reads by its raw id, or a workspace connection kept as
 * `workspace:<opaque connection id>`. The second form is the one an app lists on its
 * calendars page, so every calendar path — busy reads, destination writes, updates
 * and cancellations — has to be able to turn that ref into credentials before a
 * provider sees it. A provider that reads the legacy table by raw id cannot.
 */
export const WORKSPACE_CALENDAR_PREFIX = "workspace:";

/** What a host installs so a `workspace:` calendar ref can become credentials. */
export type CalendarCredentialResolver = (ref: {
  connectionId: string;
  providerKind: string;
}) => Promise<Record<string, string> | null>;

let resolver: CalendarCredentialResolver | null = null;

/**
 * Install the scoped resolver. The host owns it: only the host knows its app id and
 * its request identity, so the package must never read workspace secrets itself.
 */
export function setCalendarCredentialResolver(
  next: CalendarCredentialResolver | null,
): void {
  resolver = next;
}

export function getCalendarCredentialResolver(): CalendarCredentialResolver | null {
  return resolver;
}

export interface ResolvedCalendarCredential {
  /** The reference as persisted; never rewritten by this function. */
  credentialId: string;
  /** Provider-facing secrets for a workspace connection, absent for legacy ids. */
  credentials?: Record<string, string>;
}

export function isWorkspaceCalendarRef(
  credentialId: string | null | undefined,
): boolean {
  return typeof credentialId === "string"
    ? credentialId.startsWith(WORKSPACE_CALENDAR_PREFIX)
    : false;
}

function refusal(): BookingLifecycleError {
  return new BookingLifecycleError(
    "That calendar connection is not available.",
    502,
    "calendar_credential_unavailable",
  );
}

/**
 * Resolve a calendar ref into what a provider can use.
 *
 * A legacy id is returned untouched, exactly as before. A `workspace:` ref is
 * resolved through the installed resolver, and every refusal — no resolver, an empty
 * connection id, a resolver that answers null or one that throws — becomes the typed
 * `calendar_credential_unavailable` failure rather than a fallback to a legacy
 * lookup. The persisted reference never changes: the booking keeps the ref it was
 * authorized with, and only the provider sees the bundle.
 */
export async function resolveCalendarCredential(
  credentialId: string | null | undefined,
  providerKind: string,
): Promise<ResolvedCalendarCredential | null> {
  if (!credentialId) return null;
  if (!isWorkspaceCalendarRef(credentialId)) return { credentialId };

  const connectionId = credentialId
    .slice(WORKSPACE_CALENDAR_PREFIX.length)
    .trim();
  if (!connectionId) throw refusal();
  if (!resolver) throw refusal();

  let credentials: Record<string, string> | null;
  try {
    credentials = await resolver({ connectionId, providerKind });
  } catch {
    // A refusal is final: never fall back to a legacy id or an alternate read.
    throw refusal();
  }

  if (!credentials || Object.keys(credentials).length === 0) throw refusal();

  return { credentialId, credentials };
}

/**
 * A calendar that lives outside the legacy credential table. A workspace connection
 * is the usual case: the app lists it as `workspace:<connection id>` on its calendars
 * page, so the availability engine has to ask the host which of those the owner has
 * selected, instead of reading a table that never held them.
 */
export interface ExternalCalendarSource {
  /** The ref a provider is called with; `workspace:<id>` for a workspace connection. */
  credentialId: string;
  /** The provider kind, matching a registered calendar provider. */
  providerKind: string;
  calendarExternalIds: string[];
  /** Treated like an invalid credential row: a calendar we cannot check, not an empty one. */
  invalid?: boolean;
}

export type ExternalCalendarSourceLoader = (input: {
  userEmail: string;
}) => Promise<ExternalCalendarSource[]>;

let externalSourceLoader: ExternalCalendarSourceLoader | null = null;

/**
 * Install the host's loader for calendars outside the legacy table. The package must
 * not list a workspace connection itself: only the host knows the app id, the org
 * boundary and which calendars the owner selected.
 */
export function setExternalCalendarSource(
  loader: ExternalCalendarSourceLoader | null,
): void {
  externalSourceLoader = loader;
}

export function getExternalCalendarSource(): ExternalCalendarSourceLoader | null {
  return externalSourceLoader;
}
