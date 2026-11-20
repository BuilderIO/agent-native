import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { errors, evaluateAudience, ready } from "../server/core.js";
import { filterSchema } from "../shared/types.js";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Read one audience with its filter definition, member count and a sample of up to 25 matching contacts.",
  schema: z.object({ id: z.string().min(1).describe("Audience id") }),
  outputSchema: z.object({ audience: z.record(z.string(), z.unknown()) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    await ready();
    const [a] = await getDb().select().from(schema.audiences).where(eq(schema.audiences.id, id));
    if (!a) return errors.noWrite("Audience not found.", "not_found", { statusCode: 404 });
    const { matched } = await evaluateAudience(filterSchema.parse(a.filter), a.kind, a.memberIds as string[]);
    return { audience: { ...a, size: matched.length, sample: matched.slice(0, 25).map((c) => ({ id: c.id, name: c.name, email: c.email, title: c.title })) } };
  },
});
