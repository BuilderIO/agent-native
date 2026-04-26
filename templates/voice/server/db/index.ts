import * as schema from "./schema.js";
import { createGetDb, getDbExec } from "@agent-native/core/db";

export const getDb = createGetDb(schema);
export { schema, getDbExec };
