import { z } from "zod";

/**
 * What a workflow's inbox-poll source saves between live runs, as the engine's
 * source cursor. The engine keeps it as text and hands it back untouched; only
 * the inbox host reads it.
 */
const storedStartSchema = z.strictObject({
  v: z.literal(1),
  /** The place the source reads: the Slack channel, the repository or the Sentry project its node names. */
  scope: z.string().max(200),
  /** The provider's own position: a Slack message time, or an ISO instant for GitHub and Sentry. */
  position: z.string().min(1).max(200),
  /** When the source started. A row stored before this was already in the inbox, and is never offered. */
  since: z.iso.datetime({ offset: true }),
});

export type StoredStart = z.infer<typeof storedStartSchema>;

export function encodeStart(start: Omit<StoredStart, "v">): string {
  return JSON.stringify({ v: 1, ...start });
}

export type DecodedStart =
  | { ok: true; start: StoredStart }
  | { ok: false; message: string };

/** A saved position that cannot be read is reported, never read as "none": a source that restarted from now would skip whatever arrived since. */
export function decodeStart(value: string): DecodedStart {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // coercion-ok: the unreadable text becomes the typed failure returned on the next line
    return { ok: false, message: "it is not JSON" };
  }
  const checked = storedStartSchema.safeParse(parsed);
  if (checked.success) return { ok: true, start: checked.data };
  return {
    ok: false,
    message: checked.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; "),
  };
}
