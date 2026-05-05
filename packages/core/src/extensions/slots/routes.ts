/**
 * HTTP handler for extension extension-point slots.
 *
 * Mounted at `/_agent-native/slots`. Routes:
 *
 *   GET    /:slotId/installs    — current user's installed widgets for a slot
 *   GET    /:slotId/available   — extensions that declare this slot, scoped to user access
 *   POST   /:slotId/install     — install a extension into a slot (body: { extensionId, position?, config? })
 *   DELETE /:slotId/install/:extensionId — uninstall
 *   GET    /extension/:extensionId        — list slot declarations for a specific extension
 *   POST   /extension/:extensionId        — declare a slot target (body: { slotId, config? })
 *   DELETE /extension/:extensionId/:slotId — remove a slot declaration
 */

import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";
import { readBody } from "../../server/h3-helpers.js";
import { getSession } from "../../server/auth.js";
import { recordChange } from "../../server/poll.js";
import { runWithRequestContext } from "../../server/request-context.js";
import { getOrgContext } from "../../org/context.js";
import {
  addExtensionSlotTarget,
  removeExtensionSlotTarget,
  listSlotsForExtension,
  listExtensionsForSlot,
  installExtensionSlot,
  uninstallExtensionSlot,
  listSlotInstallsForUser,
} from "./store.js";

export function createSlotsHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    const pathname = (event.url?.pathname || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const parts = pathname ? pathname.split("/") : [];

    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }

    const orgCtx = await getOrgContext(event).catch(() => null);
    const userEmail = session.email;
    const orgId = orgCtx?.orgId ?? undefined;

    return runWithRequestContext({ userEmail, orgId }, () =>
      dispatch(event, method, parts),
    );
  });
}

async function dispatch(
  event: H3Event,
  method: string,
  parts: string[],
): Promise<unknown> {
  // GET /extension/:extensionId — list a extension's slot declarations
  if (method === "GET" && parts.length === 2 && parts[0] === "extension") {
    return listSlotsForExtension(parts[1]);
  }

  // POST /extension/:extensionId — declare a slot target { slotId, config? }
  if (method === "POST" && parts.length === 2 && parts[0] === "extension") {
    const body = await readBody(event);
    const slotId = String(body?.slotId ?? "").trim();
    if (!slotId) {
      setResponseStatus(event, 400);
      return { error: "slotId is required" };
    }
    const row = await addExtensionSlotTarget(parts[1], slotId, body?.config);
    recordChange({ source: "action", type: "change" });
    return row;
  }

  // DELETE /extension/:extensionId/:slotId — remove a slot declaration
  if (method === "DELETE" && parts.length === 3 && parts[0] === "extension") {
    await removeExtensionSlotTarget(parts[1], parts[2]);
    recordChange({ source: "action", type: "change" });
    return { ok: true };
  }

  // GET /:slotId/installs — current user's installs in slot
  if (method === "GET" && parts.length === 2 && parts[1] === "installs") {
    return listSlotInstallsForUser(parts[0]);
  }

  // GET /:slotId/available — extensions that declare this slot the user can install
  if (method === "GET" && parts.length === 2 && parts[1] === "available") {
    return listExtensionsForSlot(parts[0]);
  }

  // POST /:slotId/install — install { extensionId, position?, config? }
  if (method === "POST" && parts.length === 2 && parts[1] === "install") {
    const body = await readBody(event);
    const extensionId = String(body?.extensionId ?? "").trim();
    if (!extensionId) {
      setResponseStatus(event, 400);
      return { error: "extensionId is required" };
    }
    const row = await installExtensionSlot(extensionId, parts[0], {
      position: body?.position,
      config: body?.config,
    });
    recordChange({ source: "action", type: "change" });
    return row;
  }

  // DELETE /:slotId/install/:extensionId — uninstall
  if (method === "DELETE" && parts.length === 3 && parts[1] === "install") {
    await uninstallExtensionSlot(parts[2], parts[0]);
    recordChange({ source: "action", type: "change" });
    return { ok: true };
  }

  setResponseStatus(event, 404);
  return { error: "Not found" };
}
