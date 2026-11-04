import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, like, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createSource, serializeSource } from "../server/lib/brain.js";
import { assertBrainAdmin } from "../server/lib/zoom-governance.js";
import { COMPANY_CONTEXT_INTAKE_KEY } from "../shared/types.js";

export default defineAction({
  description:
    "Return the organization's shared Company Context intake source, creating it on first use. It is a manual, organization-visible source that Brain admins (org owners and admins) reuse for every recurring Markdown upload via import-markdown-files with its sourceId. Admin only.",
  schema: z.object({}),
  outputSchema: z.object({
    created: z.boolean(),
    source: z.object({
      id: z.string(),
      title: z.string(),
      provider: z.string(),
      status: z.string(),
      visibility: z.string(),
      config: z.record(z.string(), z.unknown()),
      cursor: z.unknown(),
      lastSyncedAt: z.string().nullable(),
      lastError: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  }),
  run: async () => {
    const { orgId } = await assertBrainAdmin();
    // guard:allow-unscoped — admins may not own the shared intake source; access
    // is re-checked with assertAccess below.
    const [existing] = await getDb()
      .select()
      .from(schema.brainSources)
      .where(
        and(
          eq(schema.brainSources.orgId, orgId),
          eq(schema.brainSources.provider, "manual"),
          ne(schema.brainSources.status, "archived"),
          eq(schema.brainSources.visibility, "org"),
          like(
            schema.brainSources.configJson,
            `%"${COMPANY_CONTEXT_INTAKE_KEY}":true%`,
          ),
        ),
      )
      .orderBy(asc(schema.brainSources.createdAt))
      .limit(1);
    if (existing) {
      const access = await assertAccess("brain-source", existing.id, "editor");
      return { created: false, source: serializeSource(access.resource) };
    }
    const source = await createSource({
      title: "Company context",
      provider: "manual",
      visibility: "org",
      config: { [COMPANY_CONTEXT_INTAKE_KEY]: true },
    });
    return { created: true, source: serializeSource(source) };
  },
});
