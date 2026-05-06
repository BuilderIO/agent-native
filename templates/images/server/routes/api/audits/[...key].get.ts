/**
 * Dev-only fallback to serve audit-CSV exports stored on the local
 * filesystem (when S3 is not configured). In production with S3, the
 * `export-audit-csv` action returns a presigned URL directly and this
 * route is never hit.
 *
 * The `[...key]` catchall captures the object key (which can include
 * slashes — e.g. `audits/2026-05-06/audit-foo.csv`).
 */

import {
  createError,
  defineEventHandler,
  setHeader,
  setResponseStatus,
} from "h3";
import path from "node:path";
import { getSession } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
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
      // Defence in depth: the export-audit-csv action that produced this
      // object already gated on assertOrgAdmin, but anyone with the URL
      // could otherwise re-request it. Re-check here so the CSV download
      // is also admin-gated.
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
      // Normalise; reject any path that escapes the audits/ prefix.
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
