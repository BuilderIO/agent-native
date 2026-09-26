
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { RecordingPageAccessRole } from "./recording-page-access.js";
import type { RecordingVisibility } from "./recordings.js";

export interface RecordingShareGrantInput {
  recordingId: string;
  role: RecordingPageAccessRole;
  visibility: RecordingVisibility;
  hasPassword: boolean;
  isAgentCaller?: boolean;
  userEmail?: string | null;
  orgId?: string | null;
}

export async function hasExplicitRecordingShare(
  input: RecordingShareGrantInput,
): Promise<boolean> {
  if (input.role === "owner") return true;
  if (input.visibility !== "public") return false;
  if (!input.hasPassword && input.isAgentCaller) return true;

  const userEmail = (
    input.userEmail === undefined ? getRequestUserEmail() : input.userEmail
  )
    ?.trim()
    .toLowerCase();
  const orgId = input.orgId === undefined ? getRequestOrgId() : input.orgId;

  const principals = [];
  if (userEmail) {
    principals.push(
      and(
        eq(schema.recordingShares.principalType, "user"),
        sql`lower(${schema.recordingShares.principalId}) = ${userEmail}`,
      ),
    );
  }
  if (orgId) {
    principals.push(
      and(
        eq(schema.recordingShares.principalType, "org"),
        eq(schema.recordingShares.principalId, orgId),
      ),
    );
  }
  if (principals.length === 0) return false;

  const [share] = await getDb()
    .select({ id: schema.recordingShares.id })
    .from(schema.recordingShares)
    .where(
      and(
        eq(schema.recordingShares.resourceId, input.recordingId),
        or(...principals),
      ),
    )
    .limit(1);
  return Boolean(share);
}
