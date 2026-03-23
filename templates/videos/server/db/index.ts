import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";

export const getDb = createGetDb(schema);
export { schema };
