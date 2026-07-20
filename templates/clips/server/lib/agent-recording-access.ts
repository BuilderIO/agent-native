import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, or, sql, type SQL } from "drizzle-orm";

type AgentRecordingAccessOptions = {
  agentOnly?: boolean;
  userEmail?: string;
};

export function isAgentRecordingCaller(caller: string | undefined): boolean {
  return caller === "tool" || caller === "mcp" || caller === "a2a";
}

function normalizeEmail(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

/**
 * Scope agent recording reads to normal access plus public recordings the
 * current signed-in user has already opened. Public visibility alone never
 * makes a recording discoverable.
 */
export function agentRecordingAccessFilter(
  resourceTable: any,
  sharesTable: any,
  viewersTable: any,
  options: AgentRecordingAccessOptions = {},
): SQL {
  const normalAccess = accessFilter(resourceTable, sharesTable);
  if (!options.agentOnly) return normalAccess;

  const normalizedEmail = normalizeEmail(
    options.userEmail ?? getRequestUserEmail(),
  );
  if (!normalizedEmail) return sql`1 = 0`;

  const viewed = sql`exists (select 1 from ${viewersTable}
                    where ${viewersTable.recordingId} = ${resourceTable.id}
                      and lower(${viewersTable.viewerEmail}) = ${normalizedEmail})`;
  const owner = sql`lower(${resourceTable.ownerEmail}) = ${normalizedEmail}`;

  return (
    or(
      owner,
      and(
        eq(resourceTable.visibility, "public"),
        viewed,
      ),
      and(normalAccess, viewed),
    ) ?? normalAccess
  );
}

export async function hasViewedPublicRecording(
  db: any,
  viewersTable: any,
  recordingId: string,
  userEmail = getRequestUserEmail(),
): Promise<boolean> {
  const normalizedEmail = normalizeEmail(userEmail);
  if (!normalizedEmail) return false;

  const [viewer] = await db
    .select({ id: viewersTable.id })
    .from(viewersTable)
    .where(
      and(
        eq(viewersTable.recordingId, recordingId),
        sql`lower(${viewersTable.viewerEmail}) = ${normalizedEmail}`,
      ),
    )
    .limit(1);
  return Boolean(viewer);
}
