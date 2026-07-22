import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { runDataProgram } from "@agent-native/core/data-programs";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { CRM_APP_ID } from "../server/lib/provider-api.js";
import { isSafeCrmMutationFields } from "./_crm-action-utils.js";

export default defineAction({
  description:
    "Run the data program linked to one access-scoped CRM saved view and return a bounded, sanitized preview.",
  schema: z.object({
    viewId: z.string().trim().min(1).max(128),
  }),
  agentTool: false,
  toolCallable: false,
  run: async ({ viewId }, ctx?: ActionRunContext) => {
    if (!ctx?.userEmail) {
      throw new Error("CRM data programs require an authenticated user.");
    }
    const [view] = await getDb()
      .select({ dataProgramId: schema.crmSavedViews.dataProgramId })
      .from(schema.crmSavedViews)
      .where(
        and(
          eq(schema.crmSavedViews.id, viewId),
          accessFilter(schema.crmSavedViews, schema.crmSavedViewShares),
        ),
      )
      .limit(1);
    if (!view?.dataProgramId) {
      throw new Error("This CRM saved view has no data program.");
    }
    const result = await runDataProgram({
      programId: view.dataProgramId,
      appId: CRM_APP_ID,
      params: {},
      ctx: { userEmail: ctx.userEmail, orgId: ctx.orgId ?? null },
      triggeredBy: "agent",
    });
    if (!result.ok) {
      return {
        ok: false as const,
        code: result.error.code,
        message: "The saved view data program could not run.",
        ...(result.lastGoodRun
          ? {
              lastGoodRun: {
                rowCount: result.lastGoodRun.rows.length,
                columns: safeColumns(result.lastGoodRun.schema),
                sampleRows: safeSampleRows(result.lastGoodRun.rows),
                truncated: result.lastGoodRun.truncated,
                asOfMs: result.lastGoodRun.asOfMs,
              },
            }
          : {}),
      };
    }
    return {
      ok: true as const,
      rowCount: result.rows.length,
      columns: safeColumns(result.schema),
      sampleRows: safeSampleRows(result.rows),
      asOfMs: result.asOfMs,
      cacheHit: result.cacheHit,
      stale: result.stale,
      truncated: result.truncated,
    };
  },
});

function safeColumns(columns: Array<{ name: string; type: string }>) {
  return columns
    .filter(
      (column) =>
        column.name.length <= 120 &&
        isSafeCrmMutationFields({ [column.name]: "preview" }),
    )
    .slice(0, 12);
}

function safeSampleRows(rows: Array<Record<string, unknown>>) {
  return rows.slice(0, 5).map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(
          ([fieldName, value]) =>
            isSafeCrmMutationFields({ [fieldName]: value }) &&
            (value === null ||
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"),
        )
        .slice(0, 12)
        .map(([fieldName, value]) => [
          fieldName,
          typeof value === "string" ? value.slice(0, 500) : value,
        ]),
    ),
  );
}
