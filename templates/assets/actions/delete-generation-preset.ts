import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import deleteTemplate from "./delete-template.js";

export default defineAction({
  description: "Deprecated — use delete-template. Delete a generation preset.",
  schema: z.object({ id: z.string() }),
  run: async (args) => deleteTemplate.run(args),
});
