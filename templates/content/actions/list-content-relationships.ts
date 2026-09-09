import { defineAction } from "@agent-native/core/action";

import { listContentRelationshipsInputSchema } from "../shared/relationships.js";
import { listContentRelationships } from "./_relationship-read.js";

export default defineAction({
  description:
    "List the caller-accessible canonical typed relationships for one Page or Content database, with safe edit routes and observation tokens.",
  mcpTool: true,
  schema: listContentRelationshipsInputSchema,
  http: { method: "GET" },
  readOnly: true,
  run: listContentRelationships,
});
