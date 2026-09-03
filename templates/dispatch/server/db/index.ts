import { createGetDb } from "@agent-native/core/db";
import { schema } from "@agent-native/dispatch/db";

export const getDb = createGetDb(schema);

export { schema };
