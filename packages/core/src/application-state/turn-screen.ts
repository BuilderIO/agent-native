import { z } from "zod";

import { getRequestRunContext } from "../server/request-context.js";
import {
  AGENT_SCREEN_METADATA_KEY,
  MAX_SCREEN_STATE_KEYS,
  MAX_SCREEN_STATE_TOTAL_CHARS,
  MAX_SCREEN_STATE_VALUE_CHARS,
  NAVIGATION_COMMAND_KEYS,
  SCREEN_STATE_KEY_PATTERN,
  type TurnScreenSnapshot,
} from "../shared/turn-screen-snapshot.js";

export {
  AGENT_SCREEN_METADATA_KEY,
  buildTurnScreenSnapshot,
  FRAMEWORK_SCREEN_STATE_KEYS,
  MAX_SCREEN_STATE_VALUE_CHARS,
  type TurnScreenSnapshot,
} from "../shared/turn-screen-snapshot.js";

const screenStateKeySchema = z
  .string()
  .regex(SCREEN_STATE_KEY_PATTERN)
  .refine(
    (key) => !(NAVIGATION_COMMAND_KEYS as readonly string[]).includes(key),
    "navigation commands are not screen state",
  );

const turnScreenSnapshotSchema = z
  .object({
    v: z.literal(1),
    browserTabId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
    capturedAt: z.number().finite(),
    values: z.record(
      screenStateKeySchema,
      z.record(z.string(), z.unknown()).nullable(),
    ),
    omitted: z
      .array(screenStateKeySchema)
      .max(MAX_SCREEN_STATE_KEYS)
      .optional(),
    released: z.boolean().optional(),
  })
  .superRefine((snapshot, ctx) => {
    const entries = Object.entries(snapshot.values);
    if (entries.length > MAX_SCREEN_STATE_KEYS) {
      ctx.addIssue({ code: "custom", message: "too many screen state keys" });
      return;
    }
    let total = 0;
    for (const [key, value] of entries) {
      const size = JSON.stringify(value).length;
      total += size;
      if (size > MAX_SCREEN_STATE_VALUE_CHARS) {
        ctx.addIssue({ code: "custom", message: `${key} is too large` });
      }
    }
    if (total > MAX_SCREEN_STATE_TOTAL_CHARS) {
      ctx.addIssue({ code: "custom", message: "screen state is too large" });
    }
  });

/**
 * Per-tab record of the last snapshot a turn released. A continuation the
 * client starts carries the original snapshot but not the release.
 */
export const TURN_SCREEN_RELEASED_KEY = "turn-screen-released";

export interface TurnScreen {
  source: "message" | "turn-start";
  /** The same object the request body carries, so a release reaches later segments. */
  snapshot: TurnScreenSnapshot;
}

export type SubmittedTurnScreen =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | { status: "other-tab" }
  | { status: "ok"; snapshot: TurnScreenSnapshot };

export function readSubmittedTurnScreen(
  metadata: Record<string, unknown> | undefined,
  browserTabId: string | undefined,
): SubmittedTurnScreen {
  const submitted = metadata?.[AGENT_SCREEN_METADATA_KEY];
  if (submitted === undefined) return { status: "absent" };
  const parsed = turnScreenSnapshotSchema.safeParse(submitted);
  if (!parsed.success) {
    return { status: "invalid", reason: parsed.error.message };
  }
  if (parsed.data.browserTabId !== browserTabId) return { status: "other-tab" };
  return { status: "ok", snapshot: parsed.data };
}

function activeSnapshot(): TurnScreenSnapshot | undefined {
  const snapshot = getRequestRunContext()?.turnScreen?.snapshot;
  return snapshot && !snapshot.released ? snapshot : undefined;
}

function pinnedBaseKey(
  key: string,
  snapshot: TurnScreenSnapshot,
): string | undefined {
  const suffix = `:${snapshot.browserTabId}`;
  const base = key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
  return Object.prototype.hasOwnProperty.call(snapshot.values, base)
    ? base
    : undefined;
}

/**
 * The bare key resolves to the snapshot too: a value that was absent when the
 * message was sent must stay absent, not fall through to another tab's write.
 */
export function readPinnedScreenState(
  key: string,
): { value: Record<string, unknown> | null } | undefined {
  const snapshot = activeSnapshot();
  if (!snapshot) return undefined;
  const base = pinnedBaseKey(key, snapshot);
  return base === undefined ? undefined : { value: snapshot.values[base] };
}

/**
 * The turn moved or rewrote the screen itself, so it reads live state from
 * here on. Returns the snapshot this write released, if any.
 */
export function noteScreenStateWrite(
  key: string,
): TurnScreenSnapshot | undefined {
  const snapshot = activeSnapshot();
  if (!snapshot) return undefined;
  const isCommand = NAVIGATION_COMMAND_KEYS.some(
    (command) =>
      key === command || key === `${command}:${snapshot.browserTabId}`,
  );
  if (!isCommand && pinnedBaseKey(key, snapshot) === undefined) {
    return undefined;
  }
  snapshot.released = true;
  return snapshot;
}
