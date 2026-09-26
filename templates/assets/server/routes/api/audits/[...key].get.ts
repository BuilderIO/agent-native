
import path from "node:path";

import { getSession } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  createError,
  defineEventHandler,
  setHeader,
  setResponseStatus,
} from "h3";

import { assertOrgAdmin } from "../../../lib/org-admin.js";
import { getObject } from "../../../lib/storage.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }

  return runWithRequestContext(
    {
      userEmail: session.email,
      orgId: (session as any).orgId ?? undefined,
    },
    async () => {
      try {
        await assertOrgAdmin();
      } catch {
        throw createError({
          statusCode: 403,
          statusMessage: "Forbidden — admin role required",
        });
      }

      const params = event.context.params as { key?: string | string[] };
      const raw = params?.key;
      const key = Array.isArray(raw) ? raw.join("/") : (raw ?? "");
      const normalised = path.posix.normalize(key);
      if (!normalised.startsWith("audits/") || normalised.includes("..")) {
        throw createError({ statusCode: 404, statusMessage: "Not found" });
      }

      const body = await getObject(normalised).catch(() => null);
      if (!body) {
        throw createError({ statusCode: 404, statusMessage: "Not found" });
      }
      const filename = path.basename(normalised);
      setHeader(event, "content-type", "text/csv; charset=utf-8");
      setHeader(
        event,
        "content-disposition",
        `attachment; filename="${filename}"`,
      );
      setHeader(event, "cache-control", "no-store");
      return body;
    },
  );
});
