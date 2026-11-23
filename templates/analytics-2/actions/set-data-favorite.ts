import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  setDataFavorite,
  setDataFavoriteSchema,
} from "../server/model/data-favorites.js";

export default defineAction({
  description:
    "Add or remove a table from your favorites in the current workspace.",
  schema: setDataFavoriteSchema,
  outputSchema: z.object({
    connectionId: z.string().min(1),
    tableId: z.string().min(1),
    favorited: z.boolean(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: (input, context) => setDataFavorite(input, context?.caller),
});
