import { fail } from "@agent-native/core/action";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export async function resolveDefaultDesignSystemId(
  ownerEmail: string,
): Promise<string | null> {
  const orgId = getRequestOrgId();
  const rows = await getDb()
    .select({ id: schema.designSystems.id })
    .from(schema.designSystems)
    .where(
      and(
        eq(
          sql`lower(${schema.designSystems.ownerEmail})`,
          ownerEmail.trim().toLowerCase(),
        ),
        eq(schema.designSystems.isDefault, true),
        orgId
          ? eq(schema.designSystems.orgId, orgId)
          : isNull(schema.designSystems.orgId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function resolveDesignSystemIdByTitle(
  title: string,
): Promise<string> {
  const trimmed = title.trim();
  const rows = await getDb()
    .select({ id: schema.designSystems.id })
    .from(schema.designSystems)
    .where(
      and(
        accessFilter(schema.designSystems, schema.designSystemShares),
        eq(sql`lower(${schema.designSystems.title})`, trimmed.toLowerCase()),
      ),
    );
  if (rows.length === 0) {
    fail(
      `No accessible design system titled "${trimmed}". Call list-design-systems and pass an exact title or designSystemId.`,
      { errorCode: "design_system_not_found", statusCode: 404 },
    );
  }
  if (rows.length > 1) {
    fail(
      `Design system title "${trimmed}" is ambiguous (ids: ${rows.map((r) => r.id).join(", ")}). Pass designSystemId.`,
      { errorCode: "design_system_ambiguous", statusCode: 409 },
    );
  }
  return rows[0].id;
}
