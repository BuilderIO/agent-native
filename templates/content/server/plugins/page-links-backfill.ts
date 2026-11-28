import {
  defineNitroPlugin,
  registerRecurringSweepHandler,
} from "@agent-native/core/server";

import {
  nextPageLinksBackfillDueAt,
  PAGE_LINKS_BACKFILL_SWEEP_ID,
  runPageLinksBackfillSweep,
} from "../lib/page-links-backfill.js";

export function registerPageLinksBackfillSweep() {
  return registerRecurringSweepHandler(
    PAGE_LINKS_BACKFILL_SWEEP_ID,
    async ({ deadlineAt, signal }) => {
      await runPageLinksBackfillSweep({ deadlineAt, signal });
    },
    { nextDueAt: nextPageLinksBackfillDueAt },
  );
}

export default defineNitroPlugin(() => {
  registerPageLinksBackfillSweep();
});
