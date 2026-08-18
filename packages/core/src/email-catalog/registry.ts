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
/** Source definitions, so re-registering the same one is a no-op rather than a clash. */
const sources = new Map<string, TransactionalEmailDefinition>();

/**
 * Register a transactional email. Returns the definition so the call site can
 * export it and reuse `id` when sending.
 */
export function defineTransactionalEmail(
  definition: TransactionalEmailDefinition,
): RegisteredTransactionalEmail {
  const existing = sources.get(definition.id);
  if (existing && existing !== definition) {
    // Two emails sharing an id would silently merge their metrics and make the
    // catalog claim one exists when the other actually sent.
    throw new Error(
      `Duplicate transactional email id "${definition.id}". Ids must be unique across the app.`,
    );
  }
  const resolved: RegisteredTransactionalEmail = {
    ...definition,
    app: definition.app ?? getAppSlug() ?? "unknown",
  };
  registry.set(definition.id, resolved);
  sources.set(definition.id, definition);
  return resolved;
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
  sources.clear();
}
