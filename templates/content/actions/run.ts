import { runScript } from "@agent-native/core/scripts";

import { registerContentProtectedMutationTables } from "../server/db/protected-mutation-tables.js";

registerContentProtectedMutationTables();
runScript();
