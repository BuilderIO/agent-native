import { defineAction } from "@agent-native/core/action";
import {
  getDataProgram,
  getLatestFinishedRun,
  getLatestSuccessfulRun,
  hashDataProgramParams,
} from "@agent-native/core/data-programs";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

export default defineAction({
  description:
    "Get one Analytics data program's metadata, code, and last finished run. When that run failed, lastGoodRun is the newest successful one. Pass includeRows to return their cached rows.",
  schema: z.object({
    programId: z.string().min(1),
    includeRows: z.boolean().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx) throw new Error("No authenticated context for get-data-program.");

    const program = await getDataProgram(args.programId, ANALYTICS_APP_ID);
    if (!program) throw new Error("Data program not found.");

    const access = await resolveAccess("data_program", args.programId, {
      userEmail: ctx.userEmail,
      orgId: ctx.orgId ?? undefined,
    });
    if (!access) throw new Error("Access denied to this data program.");

    const defaultParams = program.defaultParams
      ? (JSON.parse(program.defaultParams) as Record<string, unknown>)
      : {};
    const hash = hashDataProgramParams(
      defaultParams,
      ctx.userEmail,
      ctx.orgId ?? null,
    );
    // A background program records its next run as soon as it queues it, so
    // read the newest finished run, plus the newest success when that run
    // failed, rather than an empty queued row.
    const lastRun = await getLatestFinishedRun(program.id, hash);
    const lastGoodRun =
      lastRun && lastRun.status !== "succeeded"
        ? await getLatestSuccessfulRun(program.id, hash)
        : null;

    return {
      id: program.id,
      name: program.name,
      title: program.title,
      description: program.description,
      code: program.code,
      paramsSchema: program.paramsSchema
        ? JSON.parse(program.paramsSchema)
        : null,
      defaultParams,
      refreshMode: program.refreshMode,
      refreshTtlMs: program.refreshTtlMs,
      background: program.background,
      archivedAt: program.archivedAt,
      columns: program.outputColumns ? JSON.parse(program.outputColumns) : [],
      lastRun: lastRun
        ? {
            status: lastRun.status,
            rowCount: lastRun.rowCount,
            truncated: lastRun.truncated,
            errorCode: lastRun.errorCode,
            errorMessage: lastRun.errorMessage,
            finishedAt: lastRun.finishedAt,
            ...(args.includeRows && lastRun.rowsJson
              ? { rows: JSON.parse(lastRun.rowsJson) }
              : {}),
          }
        : null,
      ...(lastGoodRun
        ? {
            lastGoodRun: {
              rowCount: lastGoodRun.rowCount,
              truncated: lastGoodRun.truncated,
              finishedAt: lastGoodRun.finishedAt,
              ...(args.includeRows && lastGoodRun.rowsJson
                ? { rows: JSON.parse(lastGoodRun.rowsJson) }
                : {}),
            },
          }
        : {}),
    };
  },
});
