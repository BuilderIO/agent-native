import {
  defineNitroPlugin,
  registerRecurringSweepHandler,
} from "@agent-native/core/server";

import {
  CONTENT_TRASH_RETENTION_SWEEP_ID,
  runContentTrashRetention,
} from "../lib/content-trash-retention.js";

function startOfNextUtcDay(now: number) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime();
}

export function registerContentTrashRetentionSweep() {
  let quietUntil = 0;
  return registerRecurringSweepHandler(
    CONTENT_TRASH_RETENTION_SWEEP_ID,
    async ({ deadlineAt, signal }) => {
      const now = Date.now();
      if (now < quietUntil) return;
      const run = await runContentTrashRetention({ deadlineAt, signal });
      quietUntil =
        run.outcome === "in-progress" || run.outcome === "started"
          ? 0
          : startOfNextUtcDay(now);
    },
  );
}

export default defineNitroPlugin(() => {
  registerContentTrashRetentionSweep();
});
