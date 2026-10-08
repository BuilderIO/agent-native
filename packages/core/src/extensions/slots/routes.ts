import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getOrgContext } from "../../org/context.js";
import { getSession } from "../../server/auth.js";
import { readBody } from "../../server/h3-helpers.js";
import { recordChange } from "../../server/poll.js";
import { runWithRequestContext } from "../../server/request-context.js";
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
    const orgId = orgCtx?.orgId ?? session.orgId ?? undefined;

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
  if (method === "GET" && parts.length === 2 && parts[0] === "extension") {
    return listSlotsForExtension(parts[1]);
  }

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

  if (method === "DELETE" && parts.length === 3 && parts[0] === "extension") {
    await removeExtensionSlotTarget(parts[1], parts[2]);
    recordChange({ source: "action", type: "change" });
    return { ok: true };
  }

  if (method === "GET" && parts.length === 2 && parts[1] === "installs") {
    return listSlotInstallsForUser(parts[0]);
  }

  if (method === "GET" && parts.length === 2 && parts[1] === "available") {
    return listExtensionsForSlot(parts[0]);
  }

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

  if (method === "DELETE" && parts.length === 3 && parts[1] === "install") {
    await uninstallExtensionSlot(parts[2], parts[0]);
    recordChange({ source: "action", type: "change" });
    return { ok: true };
  }

  setResponseStatus(event, 404);
  return { error: "Not found" };
}
