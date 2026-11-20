import {
  defineNitroPlugin,
  registerRecurringSweepHandler,
} from "@agent-native/core/server";

import { trashExpiredSubmissions } from "../../actions/_collection.js";
import { getDb } from "../db/index.js";

export default defineNitroPlugin(() => {
  registerRecurringSweepHandler("forms-data-retention", async () => {
    await trashExpiredSubmissions(getDb());
  });
});
