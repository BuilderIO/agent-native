import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  dataFavoritesSchema,
  listDataFavorites,
} from "../server/model/data-favorites.js";

export default defineAction({
  description:
    "List your favorite tables in the current workspace, rechecking table access.",
  schema: z.object({}).strict(),
  outputSchema: dataFavoritesSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (_input, context) => listDataFavorites(context?.caller),
});
