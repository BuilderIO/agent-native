import { fail } from "@agent-native/core/action";
import { visualEditCapabilityDesignId } from "@agent-native/core/server";
import { getRequestAuthCapability } from "@agent-native/core/server/request-context";
import { getSetting, putSetting } from "@agent-native/core/settings";
import { count, eq, inArray, sql, type SQL } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/** A signed-out board file holds inline HTML, never uploaded media. */
export const VISUAL_EDIT_BOARD_MAX_FILE_BYTES = 1024 * 1024;
export const VISUAL_EDIT_BOARD_MAX_FILES = 40;
/** Board data holds canvas layout and screen metadata, not screen content. */
export const VISUAL_EDIT_BOARD_MAX_DATA_BYTES = 1024 * 1024;

export function firstRow<T>(rows: readonly T[]): T | undefined {
  return rows.length > 0 ? rows[0] : undefined;
}

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

// Design data is writable through the capability and every signed-out board
// in a workspace shares one principal, so neither the data's connection ids
// nor connection ownership can say which connections a board may reach. Only
// open-visual-edit, which no capability can call, writes this record.
const BOARD_CONNECTIONS_SETTING_PREFIX =
  "design-visual-edit-board-connections:";

function boardConnectionsSettingKey(designId: string): string {
  return `${BOARD_CONNECTIONS_SETTING_PREFIX}${designId}`;
}

function linkedConnectionIds(value: Record<string, unknown> | null): string[] {
  const ids = value?.connectionIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

/** Record the local connections open-visual-edit placed on a design. */
export async function linkVisualEditBoardConnections(
  designId: string,
  connectionIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = connectionIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length === 0) return;
  const key = boardConnectionsSettingKey(designId);
  const existing = linkedConnectionIds(
    await getSetting(key, { bypassCache: true }),
  );
  const merged = [...new Set([...existing, ...ids])];
  if (merged.length === existing.length) return;
  await putSetting(key, { connectionIds: merged });
}

/**
 * The connections the request's visual-edit capability may reach, or `null`
 * when the request carries no visual-edit capability. A board created without
 * a bridge links none.
 */
export async function visualEditCapabilityConnectionIds(): Promise<
  string[] | null
> {
  const designId = requestVisualEditCapabilityDesignId();
  if (designId === null) return null;
  return linkedConnectionIds(
    await getSetting(boardConnectionsSettingKey(designId)),
  );
}

export async function assertVisualEditCapabilityConnections(
  connectionIds: Iterable<string | null | undefined>,
): Promise<void> {
  assertLinkedVisualEditConnections(
    await visualEditCapabilityConnectionIds(),
    connectionIds,
  );
}

/** For callers that read the linked set before opening a transaction. */
export function assertLinkedVisualEditConnections(
  linked: readonly string[] | null,
  connectionIds: Iterable<string | null | undefined>,
): void {
  if (linked === null) return;
  for (const connectionId of connectionIds) {
    if (!connectionId || !linked.includes(connectionId)) {
      fail("This visual-edit board is not linked to that local connection.", {
        errorCode: "visual_edit_connection_not_linked",
        statusCode: 403,
      });
    }
  }
}

/**
 * Extra row filter for `design_localhost_connections` reads: under a
 * visual-edit capability, only the board's linked connections match.
 */
export async function visualEditCapabilityConnectionClause(): Promise<
  SQL | undefined
> {
  const linked = await visualEditCapabilityConnectionIds();
  if (linked === null) return undefined;
  return linked.length > 0
    ? inArray(schema.designLocalhostConnections.id, linked)
    : sql`false`;
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

/** Check the design data a capability write would store, not its input. */
export function assertVisualEditBoardDataSize(nextData: string) {
  if (requestVisualEditCapabilityDesignId() === null) return;
  if (Buffer.byteLength(nextData, "utf8") > VISUAL_EDIT_BOARD_MAX_DATA_BYTES) {
    fail(
      "A signed-out board's design data is limited to 1 MB. Sign in to save larger boards.",
      { errorCode: "visual_edit_board_data_too_large", statusCode: 413 },
    );
  }
}

/**
 * Run inside the transaction that inserts the file, after it holds the
 * design's source-mutation lock: a count read outside it lets concurrent
 * creates all pass.
 */
export async function assertVisualEditBoardFileCount(
  designId: string,
  tx: Pick<ReturnType<typeof getDb>, "select">,
) {
  if (requestVisualEditCapabilityDesignId() === null) return;
  const rows = await tx
    .select({ files: count() })
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId));
  const files = firstRow(rows)?.files ?? 0;
  if (files >= VISUAL_EDIT_BOARD_MAX_FILES) {
    fail(
      `A signed-out board holds at most ${VISUAL_EDIT_BOARD_MAX_FILES} files. Sign in to add more.`,
      { errorCode: "visual_edit_board_file_limit", statusCode: 409 },
    );
  }
}
