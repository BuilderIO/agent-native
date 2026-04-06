import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);

// Convenience: callable as db().select()...
export function db() {
  return getDb();
}

export { schema };
