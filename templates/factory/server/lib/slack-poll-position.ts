/**
 * What a Slack read that stopped at its page cap leaves for the next one.
 * History comes newest first, so the messages it did not reach are the older
 * ones: the next read goes on from the cursor of the next older page, and when
 * it gets back to where this one started, the position is the newest message of
 * the whole walk, not the newest of that last slice.
 *
 * `resume` is that pair as one text, `<newest>|<cursor>`. A workflow source
 * saves it inside its position (`<position>|<resume>`) because the engine keeps
 * a position as text; the factory-wide poll keeps it in its stored history
 * cursor. A plain Slack cursor, which every row stored before this has, is a
 * resume with no newest.
 */
const SEPARATOR = "|";
/** A source's `after` is bounded to this by the poll's input schema. */
const MAX_POSITION_CHARS = 200;

export interface SlackResume {
  /** The newest message time the walk has read so far. */
  newest?: string;
  /** Slack's cursor for the next older page. */
  cursor: string;
}

export function encodeSlackResume(resume: {
  newest: string;
  cursor: string;
}): string {
  return `${resume.newest}${SEPARATOR}${resume.cursor}`;
}

export function decodeSlackResume(value: string): SlackResume {
  const at = value.indexOf(SEPARATOR);
  return at === -1
    ? { cursor: value }
    : { newest: value.slice(0, at), cursor: value.slice(at + 1) };
}

export interface SlackPosition {
  /** Everything at or before this has been read. */
  ts: string;
  /** Present while a read is part way down the history. */
  resume?: string;
}

export function encodeSlackPosition(position: SlackPosition): string {
  const encoded =
    position.resume === undefined
      ? position.ts
      : `${position.ts}${SEPARATOR}${position.resume}`;
  if (encoded.length > MAX_POSITION_CHARS) {
    throw new Error(
      `The Slack position is ${encoded.length} characters, past the ${MAX_POSITION_CHARS} a source can save, so it cannot go on from where this read stopped.`,
    );
  }
  return encoded;
}

export function decodeSlackPosition(value: string): SlackPosition {
  const at = value.indexOf(SEPARATOR);
  return at === -1
    ? { ts: value }
    : { ts: value.slice(0, at), resume: value.slice(at + 1) };
}

/** The later of two Slack message times, as written. */
export function laterSlackTs(a: string, b: string): string {
  return Number(b) > Number(a) ? b : a;
}
