import type { EndOutcome } from "../contract.js";

/**
 * Failed attempts an item may spend before it goes to a person, across nodes
 * and ticks. Coming through a node, or being released to come back, starts the
 * count again: a stretch of trouble ends when the item works.
 */
export const MAX_ITEM_ATTEMPTS = 3;

/** Waits before each retry of a call that failed with nothing done. One call plus these retries. */
export const RETRY_BACKOFF_MS: readonly number[] = [1_000, 4_000];

/**
 * An item that failed at a node, with attempts left, waits this long times
 * 2^(attempts - 1) before it re-enters that node: 5 minutes, then 10.
 */
export const RETRY_PARK_BASE_MS = 5 * 60_000;

/**
 * A parked item whose thread or condition cannot be read keeps waiting, with no
 * attempt spent, until every look since the first failed one has failed for
 * this long (24 looks at a 5-minute cadence). Then a person is told.
 */
export const READ_FAILURE_PATIENCE_MS = 2 * 60 * 60_000;

/**
 * The parked items one tick picks up, over as many store pages as it takes. It
 * must stay above the most items one node can hold (`MAX_INLINE_ITEMS`), so a
 * batch a stopped run set aside in front of a Combine comes back in one pass.
 */
export const MAX_RESUMED_ITEMS = 200;

export const ATTEMPTS_COUNTER = "attempts";
export const NUDGES_COUNTER = "nudges";

/**
 * How many runs in a row may find an item too big to set aside for the next
 * run, and build it again from its source, before it goes to a person and the
 * window moves on without it.
 */
export const UNHELD_COUNTER = "unheld";

/**
 * A row held for an item built from it is parked this long after that item's
 * own due time. It is let go before then when the item ends or leaves; this
 * is how long a hold left behind by a run that died waits before the next run
 * looks at it.
 */
export const HOLD_GRACE_MS = 60 * 60_000;

/** How long a run that has not finished may be left running before the next tick calls it dead, beyond the scheduler's own hard timeout. */
export const RUN_STALE_MARGIN_MS = 5 * 60_000;

/**
 * Passes through the graph an item has finished by being released to come back
 * next tick, or by being sent back around a loop. A write's receipt key starts
 * at the round, so a repeat visit (a second nudge, the next pass of a loop) is
 * a new write while a re-run of the same visit (a paused tick picked up again,
 * a woken item that failed at a later node) finds its receipt and does not
 * repeat it.
 */
export const ROUNDS_COUNTER = "rounds";
export const ROUND_STRIDE = 1000;

/** Receipt keys already spent by failed calls that one effect may skip over. */
export const MAX_SPENT_RECEIPT_KEYS = 20;

/**
 * The inbox status each outcome writes when the End node names none.
 * `released` writes nothing: the item stays as it was for the next tick.
 */
export const END_STATUS: Readonly<Record<EndOutcome, string | null>> = {
  done: "resolved",
  dismissed: "dismissed",
  needsManual: "needs_manual",
  released: null,
};

/** The reaction that answers a reply Wait when the node names none. */
export const DEFAULT_ACK_REACTION = "white_check_mark";

/** A condition Wait's result, kept on the item only when it is this small. */
export const MAX_OBSERVED_BYTES = 2048;

/** A reply's text, as kept on the item a reply Wait wakes. */
export const MAX_REPLY_TEXT_BYTES = 500;
