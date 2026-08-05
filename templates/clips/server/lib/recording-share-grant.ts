/**
 * Explicit share-grant lookup for the direct `/r/:id` recording page.
 *
 * Lives beside `recording-page-access.ts` rather than inside it so that module
 * stays free of database imports and their registration side effects. Every
 * surface that decides whether a viewer may open the authenticated recording
 * page — the player action and the public share endpoint that auto-redirects
 * into it — must use this helper, or the share page and the page it redirects
 * to will disagree and ping-pong.
 */

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
  /** Agent/MCP/A2A callers, which may open password-less public clips. */
  isAgentCaller?: boolean;
  /** Omit to read the ambient request context. */
  userEmail?: string | null;
  /** Omit to read the ambient request context. */
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
