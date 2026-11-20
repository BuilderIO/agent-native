import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { errors, evaluateAudience, ready } from "../server/core.js";
import { filterSchema } from "../shared/types.js";

export default defineAction({
  description: "Preview who matches a filter without saving: returns the total and up to 25 sample contacts. Use while building an audience.",
  schema: z.object({ filter: filterSchema.describe("Filter definition") }),
  outputSchema: z.object({ total: z.number(), sample: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  run: async ({ filter }) => {
    await ready();
    const { matched } = await evaluateAudience(filter, "dynamic", []);
    return { total: matched.length, sample: matched.slice(0, 25).map((c) => ({ id: c.id, name: c.name, email: c.email, title: c.title })) };
  },
});
