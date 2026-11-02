import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { removeDiagnosticContext } from "../server/lib/diagnostic-context.js";
export default defineAction({
  audit: { recordInputs: false },
  description:
    "Remove private diagnostic access immediately and persist private-object cleanup for retry. Video access remains independent.",
  schema: z.object({ contextId: z.string() }),
  outputSchema: z.object({ removed: z.literal(true) }),
  run: ({ contextId }) => removeDiagnosticContext(contextId),
});
