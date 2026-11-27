import {
  defineNitroPlugin,
  registerRecurringSweepHandler,
} from "@agent-native/core/server";

import { deleteExpiredContentFormDrafts } from "../../actions/_content-form-drafts.js";

export const CONTENT_FORM_DRAFT_CLEANUP_SWEEP_ID = "content-form-draft-cleanup";

export function registerContentFormDraftCleanupSweep() {
  return registerRecurringSweepHandler(
    CONTENT_FORM_DRAFT_CLEANUP_SWEEP_ID,
    async () => {
      await deleteExpiredContentFormDrafts();
    },
  );
}

export default defineNitroPlugin(() => {
  registerContentFormDraftCleanupSweep();
});
