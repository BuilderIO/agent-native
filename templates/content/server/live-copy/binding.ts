import {
  createBoundedTaskRunner,
  defineLiveCopy,
} from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";

import { LIVE_BODY_FIELD } from "../../shared/live-body.js";
import { liveBodyWriterGate } from "../lib/live-body-writer.js";
import { drizzleOverExec } from "./exec-db.js";
import { persistContentLiveCopy } from "./persist.js";
import source from "./tasks.ts?bounded-task";
import { liveBodyConversionFor } from "./write-cause.js";

/** Edits `tasks.ts` defines, by name. */
export const CONTENT_LIVE_COPY_EDITS = {
  replaceBody: "replace-body",
} as const;

/**
 * Content's page bodies as live copies. A page is covered while the D2 gate
 * says `live_copy`, and while it is being switched. The gate reads through
 * `getDbExec()` so a caller's transaction sees its own writes.
 */
export const contentLiveCopy = defineLiveCopy({
  name: "content-body",
  appliesTo: async (documentId) =>
    liveBodyConversionFor(documentId) !== undefined ||
    (await liveBodyWriterGate(documentId, { db: drizzleOverExec(getDbExec()) }))
      .writePath === "live_copy",
  runner: createBoundedTaskRunner({ source }),
  field: LIVE_BODY_FIELD,
  persist: persistContentLiveCopy,
});
