/**
 * Registry of the transactional emails an app can send.
 *
 * An app declares each email it sends here so the workspace can answer, without
 * reading the app's source: what emails exist, what makes one send, who it goes
 * to, who it comes from, and what it looks like. Dispatch aggregates these
 * across every mounted app via the `list-transactional-emails` action.
 *
 * Declare emails next to the code that sends them, then import that module from
 * a server plugin so registration happens at startup:
 *
 *   defineTransactionalEmail({
 *     id: "calendar.booking-confirmed",
 *     name: "Booking confirmed",
 *     trigger: "A guest completes a booking on a public scheduling page.",
 *     recipient: "The guest email captured on the booking form.",
 *     sender: "EMAIL_FROM, with reply-to set to the event host.",
 *     preview: () => renderBookingConfirmedEmail(SAMPLE_BOOKING),
 *   });
 *
 * The `id` doubles as the SendGrid category `sendEmail` tags the message with,
 * which is how per-email delivery and open metrics are attributed later.
 */

import { getAppSlug } from "../server/app-name.js";
import type { RenderedEmailMessage } from "../server/email-templates.js";

export interface TransactionalEmailDefinition {
  /**
   * Stable, globally unique id in `<app>.<email>` form, e.g.
   * `calendar.booking-confirmed`. Used as the SendGrid category, so changing it
   * orphans historical metrics for this email.
   */
  id: string;
  /** Human-readable name, e.g. "Booking confirmed". */
  name: string;
  /**
   * App slug this email belongs to. Defaults to the running app, which is
   * correct for every app-declared email; core system emails set it explicitly.
   */
  app?: string;
  /** Plain-language description of the condition that causes a send. */
  trigger: string;
  /** Plain-language description of how the recipient address is chosen. */
  recipient: string;
  /**
   * Two-to-four word summary of the recipient for table cells, e.g.
   * "Booking guest". The full `recipient` sentence is shown on the detail view.
   */
  recipientLabel: string;
  /** Plain-language description of how From and Reply-To are chosen. */
  sender: string;
  /** Two-to-four word summary of the sender, e.g. "Default, reply-to host". */
  senderLabel: string;
  /**
   * Render the email with representative dummy data. Must not read from the
   * database or touch the network — previews are rendered on demand from
   * Dispatch, for apps whose data the caller may not be able to see.
   */
  preview: () => RenderedEmailMessage;
}

/** A definition with its app resolved, as returned to callers. */
export type RegisteredTransactionalEmail = TransactionalEmailDefinition & {
  app: string;
};

const registry = new Map<string, RegisteredTransactionalEmail>();

function resolveDefinition(
  definition: TransactionalEmailDefinition,
): RegisteredTransactionalEmail {
  return {
    ...definition,
    app: definition.app ?? getAppSlug() ?? "unknown",
  };
}

function assertCanRegister(
  resolved: RegisteredTransactionalEmail,
  existing: RegisteredTransactionalEmail | undefined,
): void {
  if (
    existing &&
    (existing.app !== resolved.app ||
      existing.name !== resolved.name ||
      existing.trigger !== resolved.trigger ||
      existing.recipient !== resolved.recipient ||
      existing.recipientLabel !== resolved.recipientLabel ||
      existing.sender !== resolved.sender ||
      existing.senderLabel !== resolved.senderLabel)
  ) {
    // Two emails sharing an id would silently merge their metrics and make the
    // catalog claim one exists when the other actually sent.
    throw new Error(
      `Duplicate transactional email id "${resolved.id}". Ids must be unique across the app.`,
    );
  }
}

/**
 * Register a transactional email. Returns the definition so the call site can
 * export it and reuse `id` when sending.
 */
export function defineTransactionalEmail(
  definition: TransactionalEmailDefinition,
): RegisteredTransactionalEmail {
  const resolved = resolveDefinition(definition);
  // HMR recreates preview functions, so stable catalog metadata is the collision boundary.
  assertCanRegister(resolved, registry.get(resolved.id));
  registry.set(definition.id, resolved);
  return resolved;
}

function resolveDefinitions(
  definitions: readonly TransactionalEmailDefinition[],
): RegisteredTransactionalEmail[] {
  const resolved = definitions.map(resolveDefinition);
  const seen = new Set<string>();

  for (const definition of resolved) {
    if (seen.has(definition.id)) {
      throw new Error(
        `Duplicate transactional email id "${definition.id}". Ids must be unique across the app.`,
      );
    }
    seen.add(definition.id);
  }

  return resolved;
}

function validateDefinitions(
  definitions: readonly TransactionalEmailDefinition[],
): RegisteredTransactionalEmail[] {
  const resolved = resolveDefinitions(definitions);
  for (const definition of resolved) {
    assertCanRegister(definition, registry.get(definition.id));
  }
  return resolved;
}

function commitDefinitions(
  definitions: readonly RegisteredTransactionalEmail[],
): RegisteredTransactionalEmail[] {
  for (const definition of definitions) {
    registry.set(definition.id, definition);
  }
  return [...definitions];
}

/** Register a catalog as one atomic operation, allowing safe HMR refreshes. */
export function defineTransactionalEmails(
  definitions: readonly TransactionalEmailDefinition[],
): RegisteredTransactionalEmail[] {
  return commitDefinitions(validateDefinitions(definitions));
}

/** Replace one app-owned catalog snapshot after validating the full replacement. */
export function replaceTransactionalEmails(
  ownerApp: string,
  idPrefix: string,
  definitions: readonly TransactionalEmailDefinition[],
): RegisteredTransactionalEmail[] {
  const runtimeApp = getAppSlug();
  if (!ownerApp || ownerApp.includes(".") || idPrefix !== `${ownerApp}.`) {
    throw new Error(
      "Transactional email replacement requires an owner app and its exact namespace prefix.",
    );
  }

  const resolved = resolveDefinitions(definitions);
  if (
    resolved.some(({ id, app }) => app !== ownerApp || !id.startsWith(idPrefix))
  ) {
    throw new Error(
      `Transactional email replacement must contain only ${ownerApp} email definitions in the "${idPrefix}" scope.`,
    );
  }

  for (const [id, existing] of registry) {
    if (id.startsWith(idPrefix) && existing.app !== ownerApp) {
      throw new Error(
        `Transactional email replacement cannot modify "${id}" owned by "${existing.app}".`,
      );
    }
  }

  const hasExplicitOwner =
    resolved.length > 0 && resolved.every(({ app }) => app === ownerApp);
  if (
    (runtimeApp && runtimeApp !== ownerApp) ||
    (!runtimeApp && !hasExplicitOwner)
  ) {
    throw new Error(
      "Transactional email replacement requires a recognized runtime owner or a non-empty snapshot with explicit owner metadata.",
    );
  }

  const nextIds = new Set(resolved.map(({ id }) => id));
  for (const id of registry.keys()) {
    if (id.startsWith(idPrefix) && !nextIds.has(id)) {
      registry.delete(id);
    }
  }

  return commitDefinitions(resolved);
}

/** Every registered email, sorted by app then name. */
export function listTransactionalEmails(): RegisteredTransactionalEmail[] {
  return [...registry.values()].sort(
    (a, b) => a.app.localeCompare(b.app) || a.name.localeCompare(b.name),
  );
}

export function getTransactionalEmail(
  id: string,
): RegisteredTransactionalEmail | undefined {
  return registry.get(id);
}

/**
 * Render one email's preview. Throws when the id is unknown or the renderer
 * fails — a preview that silently returns an empty body would look like an
 * email that legitimately renders blank.
 */
export function renderTransactionalEmailPreview(
  id: string,
): RenderedEmailMessage {
  const definition = registry.get(id);
  if (!definition) {
    throw new Error(`Unknown transactional email "${id}".`);
  }
  return definition.preview();
}

/** Test seam — drops all registrations. */
export function resetTransactionalEmailRegistry(): void {
  registry.clear();
}
