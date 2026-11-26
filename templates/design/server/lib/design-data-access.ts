import { getSetting, putSetting } from "@agent-native/core/settings";

import { isLocalVisualEditPrincipal } from "../../shared/local-visual-edit-principal.js";
import { designSourceTypeFromData } from "../../shared/source-mode";

const EDITOR_ROLES = new Set(["owner", "admin", "editor"]);

const VISUAL_EDIT_CAPABILITY_PREFIX = "capability:visual-edit:design:";

/**
 * `open-visual-edit` marks the designs it creates. A signed-out board built
 * from inline screens has no localhost source, and its capability still needs
 * editor access to that one design.
 */
export const VISUAL_EDIT_BOARD_DATA_KEY = "visualEditBoard";

function isVisualEditBoardData(data: unknown): boolean {
  let parsed = data;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      // coercion-ok: unreadable design data is not a board marker; access falls back to viewer.
      return false;
    }
  }
  return (
    !!parsed &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>)[VISUAL_EDIT_BOARD_DATA_KEY] === true
  );
}

const CLAIMED_BOARD_SETTING_PREFIX = "design-visual-edit-board-claimed:";

/**
 * Record that a board moved into an account. Written before the owner
 * changes, so a capability minted while the board was signed out never
 * outlives the claim, even if its new owner makes it public again.
 */
export async function markVisualEditBoardClaimed(
  designId: string,
): Promise<void> {
  await putSetting(`${CLAIMED_BOARD_SETTING_PREFIX}${designId}`, {
    claimedAt: new Date().toISOString(),
  });
}

function capabilityNamesDesign(capability: string, designId: string): boolean {
  if (!capability.startsWith(VISUAL_EDIT_CAPABILITY_PREFIX)) return false;
  try {
    return (
      decodeURIComponent(
        capability.slice(VISUAL_EDIT_CAPABILITY_PREFIX.length),
      ) === designId
    );
  } catch {
    // coercion-ok: a malformed capability names no design and grants nothing.
    return false;
  }
}

/**
 * The role a visual-edit capability grants on the one design it names.
 * While a signed-out principal owns the design, a localhost design or a board
 * `open-visual-edit` created is editable whatever its visibility. Once an
 * account owns it, only a public localhost design that was never claimed
 * keeps accepting the capability: claiming a board revokes every capability
 * issued for it.
 */
export async function capabilityDesignAccessRole(
  resource:
    | {
        id?: unknown;
        data?: unknown;
        ownerEmail?: unknown;
        visibility?: unknown;
      }
    | null
    | undefined,
  ctx: { authCapability: string },
): Promise<"editor" | undefined> {
  const designId =
    typeof resource?.id === "string" ? resource.id.trim() : undefined;
  if (!designId || !capabilityNamesDesign(ctx.authCapability, designId)) {
    return undefined;
  }
  const localhost = designSourceTypeFromData(resource?.data) === "localhost";
  if (!localhost && !isVisualEditBoardData(resource?.data)) return undefined;
  const ownerEmail =
    typeof resource?.ownerEmail === "string" ? resource.ownerEmail : undefined;
  if (isLocalVisualEditPrincipal(ownerEmail)) return "editor";
  if (!localhost || resource?.visibility !== "public") return undefined;
  const claimed = await getSetting(
    `${CLAIMED_BOARD_SETTING_PREFIX}${designId}`,
  );
  return claimed ? undefined : "editor";
}

interface RedactionPolicy {
  allowPreviewToken: boolean;
  allowTunnelUrl: boolean;
}

function removeLocalhostCredentials(
  value: unknown,
  ancestors: WeakSet<object>,
  policy: RedactionPolicy,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) {
    throw new Error("Design data contains a circular reference");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child) =>
        removeLocalhostCredentials(child, ancestors, policy),
      );
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key]) =>
            key !== "bridgeToken" &&
            (policy.allowPreviewToken || key !== "previewToken") &&
            (policy.allowTunnelUrl || key !== "tunnelUrl"),
        )
        .map(([key, child]) => [
          key,
          removeLocalhostCredentials(child, ancestors, policy),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Filter persisted design data before sending it to a caller.
 *
 * Filesystem bridge tokens unlock privileged loopback endpoints and are never
 * returned through design data, including to owners/editors. The separate
 * read-only preview token is available only to callers with an editor role;
 * anonymous/public viewers fail closed rather than gaining access to a local
 * development server. Public preview (tunnel) URLs reach non-editors only while
 * the design's live collaboration is enabled, so turning it off revokes them.
 * Invalid persisted JSON also fails closed to null.
 */
export function designDataForAccessRole(
  data: unknown,
  role: unknown,
  {
    liveCollaborationEnabled = false,
  }: { liveCollaborationEnabled?: boolean } = {},
): unknown {
  const editor = typeof role === "string" && EDITOR_ROLES.has(role);
  const policy = {
    allowPreviewToken: editor,
    allowTunnelUrl: editor || liveCollaborationEnabled,
  };

  try {
    if (typeof data === "string") {
      const parsed = JSON.parse(data) as unknown;
      return JSON.stringify(
        removeLocalhostCredentials(parsed, new WeakSet(), policy),
      );
    }
    return removeLocalhostCredentials(data, new WeakSet(), policy);
  } catch {
    return null;
  }
}
