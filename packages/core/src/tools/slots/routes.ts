/**
 * HTTP handler for tool extension-point slots.
 *
 * Mounted at `/_agent-native/slots`. Routes:
 *
 *   GET    /:slotId/installs    — current user's installed widgets for a slot
 *   GET    /:slotId/available   — tools that declare this slot, scoped to user access
 *   POST   /:slotId/install     — install a tool into a slot (body: { toolId, position?, config? })
 *   DELETE /:slotId/install/:toolId — uninstall
 *   GET    /tool/:toolId        — list slot declarations for a specific tool
 *   POST   /tool/:toolId        — declare a slot target (body: { slotId, config? })
 *   DELETE /tool/:toolId/:slotId — remove a slot declaration
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
  addToolSlotTarget,
  removeToolSlotTarget,
  listSlotsForTool,
  listToolsForSlot,
  installToolSlot,
  uninstallToolSlot,
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
  // GET /tool/:toolId — list a tool's slot declarations
  if (method === "GET" && parts.length === 2 && parts[0] === "tool") {
    return listSlotsForTool(parts[1]);
  }

  // POST /tool/:toolId — declare a slot target { slotId, config? }
  if (method === "POST" && parts.length === 2 && parts[0] === "tool") {
    const body = await readBody(event);
    const slotId = String(body?.slotId ?? "").trim();
    if (!slotId) {
      setResponseStatus(event, 400);
      return { error: "slotId is required" };
    }
    const row = await addToolSlotTarget(parts[1], slotId, body?.config);
    recordChange({ source: "action", type: "change" });
    return row;
  }

  // DELETE /tool/:toolId/:slotId — remove a slot declaration
  if (method === "DELETE" && parts.length === 3 && parts[0] === "tool") {
    await removeToolSlotTarget(parts[1], parts[2]);
    recordChange({ source: "action", type: "change" });
    return { ok: true };
  }

  // GET /:slotId/installs — current user's installs in slot
  if (method === "GET" && parts.length === 2 && parts[1] === "installs") {
    return listSlotInstallsForUser(parts[0]);
  }

  // GET /:slotId/available — tools that declare this slot the user can install
  if (method === "GET" && parts.length === 2 && parts[1] === "available") {
    return listToolsForSlot(parts[0]);
  }

  // POST /:slotId/install — install { toolId, position?, config? }
  if (method === "POST" && parts.length === 2 && parts[1] === "install") {
    const body = await readBody(event);
    const toolId = String(body?.toolId ?? "").trim();
    if (!toolId) {
      setResponseStatus(event, 400);
      return { error: "toolId is required" };
    }
    const row = await installToolSlot(toolId, parts[0], {
      position: body?.position,
      config: body?.config,
    });
    recordChange({ source: "action", type: "change" });
    return row;
  }

  // DELETE /:slotId/install/:toolId — uninstall
  if (method === "DELETE" && parts.length === 3 && parts[1] === "install") {
    await uninstallToolSlot(parts[2], parts[0]);
    recordChange({ source: "action", type: "change" });
    return { ok: true };
  }

  setResponseStatus(event, 404);
  return { error: "Not found" };
}
