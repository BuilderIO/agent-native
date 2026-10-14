import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  ACCESS_REQUEST_NOTE_MAX_LENGTH,
  requestResourceAccess,
} from "../access-requests.js";

export default defineAction({
  description:
    "Ask the owner and admins of a shareable resource the signed-in viewer can't open to give them access. Asking again while a request is open sends nothing.",
  schema: z.object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    note: z.string().max(ACCESS_REQUEST_NOTE_MAX_LENGTH).optional(),
  }),
  // It emails other people, so only the person holding the link asks, from
  // the access screen.
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: (args) => requestResourceAccess(args),
});
