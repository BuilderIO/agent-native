import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  companyContextSourceId,
  createSource,
  isCompanyContextIntakeSource,
  serializeSource,
} from "../server/lib/brain.js";
import { isBrainAdmin } from "../server/lib/zoom-governance.js";
import { COMPANY_CONTEXT_INTAKE_KEY } from "../shared/types.js";

async function readIntakeSource(id: string, orgId: string) {
  // guard:allow-unscoped — admins may not own the shared intake source; access
  // is re-checked with assertAccess before it is returned.
  const [source] = await getDb()
    .select()
    .from(schema.brainSources)
    .where(
      and(eq(schema.brainSources.id, id), eq(schema.brainSources.orgId, orgId)),
    )
    .limit(1);
  return source;
}

export default defineAction({
  description:
    "Return the organization's shared Company Context intake source, creating it on first use. It is a manual, organization-visible source that Brain admins (org owners and admins) reuse for every recurring Markdown upload via import-markdown-files with its sourceId. Admin only.",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
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
    const email = getRequestUserEmail();
    const orgId = getRequestOrgId();
    if (!email || !orgId || !(await isBrainAdmin(email, orgId))) {
      fail("Only organization owners and admins can upload Company Context.", {
        errorCode: "brain_admin_required",
        statusCode: 403,
      });
    }
    const id = companyContextSourceId(orgId);
    let created = false;
    let source = await readIntakeSource(id, orgId);
    if (!source) {
      try {
        source = await createSource({
          id,
          title: "Company context",
          provider: "manual",
          visibility: "org",
          config: { [COMPANY_CONTEXT_INTAKE_KEY]: true },
        });
        created = true;
      } catch (error) {
        // Another admin created it concurrently; reuse theirs.
        source = await readIntakeSource(id, orgId);
        if (!source) throw error;
      }
    }
    if (
      !isCompanyContextIntakeSource(source) ||
      source.status === "archived" ||
      source.visibility !== "org"
    ) {
      fail(
        "The Company Context source is archived or no longer visible to the organization. Restore it to active and organization-visible before uploading.",
        { errorCode: "company_context_intake_unavailable", statusCode: 409 },
      );
    }
    const access = await assertAccess("brain-source", id, "editor");
    return { created, source: serializeSource(access.resource) };
  },
});
