import { defineAction } from "@agent-native/core/action";

import {
  dataRecentRefSchema,
  touchDataRecent,
  touchDataRecentSchema,
} from "../server/model/data-recents.js";

export default defineAction({
  description:
    "Record an opened table for your user and current workspace using its exact connection ID and opaque table ID. Access and save failures are errors.",
  schema: touchDataRecentSchema,
  outputSchema: dataRecentRefSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: (input, context) => touchDataRecent(input, context?.caller),
});
