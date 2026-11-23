import { defineAction } from "@agent-native/core/action";

import { listPublishedAppAccess } from "../server/model/published-app-access.js";
import {
  listPublishedAppAccessInput,
  listPublishedAppAccessOutput,
} from "../shared/project-sharing.js";

export default defineAction({
  description:
    "List current published app access, shareable roles and the mounted link.",
  schema: listPublishedAppAccessInput,
  outputSchema: listPublishedAppAccessOutput,
  outputErrorStrategy: "strict",
  mcpOutputSchema: true,
  persistInBrowser: false,
  readOnly: true,
  http: { method: "GET" },
  run: listPublishedAppAccess,
});
