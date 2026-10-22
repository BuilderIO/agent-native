import {
  createBoundedTaskRunner,
  defineLiveCopy,
} from "@agent-native/core/collab";

import { LIVE_BODY_FIELD } from "../../shared/live-body.js";
import { liveBodyWriterGate } from "../lib/live-body-writer.js";
import { persistContentLiveCopy } from "./persist.js";
import source from "./tasks.ts?bounded-task";
import { liveBodyConversionFor } from "./write-cause.js";

/** Edits `tasks.ts` defines, by name. */
export const CONTENT_LIVE_COPY_EDITS = {
  replaceBody: "replace-body",
  rebaseBody: "rebase-body",
} as const;

/**
 * Content's page bodies as live copies. A page is covered while the D2 gate
 * says `live_copy`, and while it is being switched. Eligibility uses the
 * request's flag snapshot; persist rechecks flags in its locked transaction.
 */
export const contentLiveCopy = defineLiveCopy({
  name: "content-body",
  appliesTo: async (documentId) => {
    if (liveBodyConversionFor(documentId) !== undefined) return true;
    return (await liveBodyWriterGate(documentId)).writePath === "live_copy";
  },
  runner: createBoundedTaskRunner({ source }),
  field: LIVE_BODY_FIELD,
  persist: persistContentLiveCopy,
});
