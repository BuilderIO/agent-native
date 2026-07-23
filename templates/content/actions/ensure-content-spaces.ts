import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { reconcileContentFilesMemberships } from "./_content-files.js";
import { provisionContentSpaces } from "./_content-spaces.js";

export default defineAction({
  description:
    "Provision and reconcile the signed-in user's personal and organization Content spaces.",
  schema: z.object({}),
  run: async () => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const db = getDb();
    const result = await provisionContentSpaces(db, userEmail);
    const reconciliation = await reconcileContentFilesMemberships(
      db,
      userEmail,
    );
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { ...result, reconciliation };
  },
});
