import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);

export const db = new Proxy({} as any, {
  get(_, prop) {
    return (getDb() as any)[prop];
  },
});
export { schema };
