import { fail } from "@agent-native/core/action";
import { visualEditCapabilityDesignId } from "@agent-native/core/server";
import { getRequestAuthCapability } from "@agent-native/core/server/request-context";
import { count, eq, type SQL } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/** A signed-out board file holds inline HTML, never uploaded media. */
export const VISUAL_EDIT_BOARD_MAX_FILE_BYTES = 1024 * 1024;
export const VISUAL_EDIT_BOARD_MAX_FILES = 40;

/**
 * The design the current request's visual-edit capability is scoped to, or
 * `null` when the request carries no visual-edit design capability.
 */
export function requestVisualEditCapabilityDesignId(): string | null {
  const capability = getRequestAuthCapability();
  if (!capability?.startsWith("capability:visual-edit:")) return null;
  const designId = visualEditCapabilityDesignId(capability);
  if (!designId) {
    fail("This visual-edit capability does not name a design.", {
      errorCode: "visual_edit_capability_invalid",
      statusCode: 403,
    });
  }
  return designId;
}

/**
 * Refuse a write to any design other than the one a visual-edit capability
 * names. Signed-out boards share one local principal per workspace, so the
 * principal's ownership of another board must never stand in for this check.
 */
export function assertVisualEditCapabilityDesign(designId: string): void {
  const capabilityDesignId = requestVisualEditCapabilityDesignId();
  if (capabilityDesignId === null || capabilityDesignId === designId) return;
  fail("This visual-edit capability is scoped to a different design.", {
    errorCode: "visual_edit_capability_design_mismatch",
    statusCode: 403,
  });
}

/**
 * Row scope for looking up a design file. A capability session is not an
 * account, so owner and share filters never match it; it reaches only the
 * files of its own design, and the action's access check still applies.
 */
export function visualEditCapabilityFileScope(accountScope: SQL): SQL {
  const designId = requestVisualEditCapabilityDesignId();
  return designId === null
    ? accountScope
    : eq(schema.designFiles.designId, designId);
}

/**
 * Row scope for reading one design. A capability session reaches its own
 * design and nothing else; account sessions keep their owner/share filter.
 */
export function visualEditCapabilityDesignScope(
  designId: string,
  accountScope: SQL,
): SQL {
  return requestVisualEditCapabilityDesignId() === designId
    ? eq(schema.designs.id, designId)
    : accountScope;
}

export function assertVisualEditBoardFileSize(content: string | undefined) {
  if (content === undefined || requestVisualEditCapabilityDesignId() === null) {
    return;
  }
  if (Buffer.byteLength(content, "utf8") > VISUAL_EDIT_BOARD_MAX_FILE_BYTES) {
    fail(
      "A signed-out board file is limited to 1 MB. Sign in to save larger files.",
      { errorCode: "visual_edit_board_file_too_large", statusCode: 413 },
    );
  }
}

export async function assertVisualEditBoardFileCount(designId: string) {
  if (requestVisualEditCapabilityDesignId() === null) return;
  // COUNT(*) always returns exactly one row.
  const [{ files }] = await getDb()
    .select({ files: count() })
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId));
  if (files >= VISUAL_EDIT_BOARD_MAX_FILES) {
    fail(
      `A signed-out board holds at most ${VISUAL_EDIT_BOARD_MAX_FILES} files. Sign in to add more.`,
      { errorCode: "visual_edit_board_file_limit", statusCode: 409 },
    );
  }
}
