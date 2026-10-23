import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listCuratedCommunityApps } from "../server/lib/community-apps.js";

export default defineAction({
  description:
    "List reviewed, pinned community app templates that can be installed in the associated workspace. This catalog is separate from deployed agents in Connect.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listCuratedCommunityApps(),
});
