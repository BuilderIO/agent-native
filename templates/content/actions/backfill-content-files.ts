import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { reconcileContentFilesMemberships } from "./_content-files.js";
import { provisionContentSpaces } from "./_content-spaces.js";

export default defineAction({
  description:
    "Assign legacy pages to Content spaces and reconcile their canonical Files database memberships.",
  schema: z.object({}),
  run: async () => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    await provisionContentSpaces(getDb(), userEmail);
    const result = await reconcileContentFilesMemberships(getDb(), userEmail);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return result;
  },
});
