import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listRuns,
  requireOwnerEmail,
  runResponse,
} from "../server/lib/email-automation.js";

export default defineAction({
  description:
    "List the latest daily digest test runs, including explicit preview-only delivery status and failures.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const ownerEmail = requireOwnerEmail();
    return (await listRuns(ownerEmail)).map(runResponse);
  },
});
