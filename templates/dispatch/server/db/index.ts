import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);

export function db() {
  return getDb();
}

export { schema };
