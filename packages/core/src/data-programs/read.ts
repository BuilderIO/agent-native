import { resolveAccess, type AccessContext } from "../sharing/access.js";
import {
  hashDataProgramParams,
  hashOrgSharedDataProgramParams,
} from "./execute.js";
import {
  getDataProgram,
  getLatestFinishedRun,
  getLatestFinishedRunOutcome,
  getLatestSuccessfulRun,
  listDataPrograms,
} from "./store.js";

/**
 * The read side of the list-data-programs and get-data-program actions. Apps
 * that define their own same-named actions (Analytics, for its MCP tools)
 * call these, so their output can't fall behind the framework's.
 */
export interface DataProgramReader {
  userEmail?: string | undefined;
  orgId?: string | null | undefined;
}

function accessContextOf(reader: DataProgramReader): AccessContext {
  return {
    ...(reader.userEmail !== undefined ? { userEmail: reader.userEmail } : {}),
    ...(reader.orgId != null ? { orgId: reader.orgId } : {}),
  };
}

export async function listDataProgramSummaries(
  appId: string,
  reader: DataProgramReader,
  options: { includeArchived?: boolean | undefined } = {},
) {
  const programs = await listDataPrograms(
    appId,
    accessContextOf(reader),
    options.includeArchived !== undefined
      ? { includeArchived: options.includeArchived }
      : {},
  );
  return {
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      description: p.description,
      refreshMode: p.refreshMode,
      refreshTtlMs: p.refreshTtlMs,
      background: p.background,
      scheduledRefresh: p.scheduledRefresh,
      archivedAt: p.archivedAt,
      updatedAt: p.updatedAt,
      columns: p.outputColumns ? JSON.parse(p.outputColumns) : [],
    })),
  };
}

export async function getDataProgramDetails(
  programId: string,
  appId: string,
  reader: DataProgramReader,
  options: { includeRows?: boolean | undefined } = {},
) {
  const accessContext = accessContextOf(reader);
  const program = await getDataProgram(programId, appId, accessContext);
  if (!program) throw new Error("Data program not found.");

  const access = await resolveAccess("data_program", programId, accessContext);
  if (!access) throw new Error("Access denied to this data program.");

  const defaultParams = program.defaultParams
    ? (JSON.parse(program.defaultParams) as Record<string, unknown>)
    : {};
  const hash = hashDataProgramParams(
    defaultParams,
    reader.userEmail,
    reader.orgId ?? null,
  );
  const lastRun = await getLatestFinishedRun(program.id, hash);
  const lastGoodRun =
    lastRun && lastRun.status !== "succeeded"
      ? await getLatestSuccessfulRun(program.id, hash)
      : null;
  const latestShared = program.orgId
    ? await getLatestFinishedRunOutcome(
        program.id,
        hashOrgSharedDataProgramParams(defaultParams, program.orgId),
      )
    : null;
  const orgSharedRun =
    latestShared && latestShared.startedAt >= Date.parse(program.updatedAt)
      ? latestShared
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
    scheduledRefresh: program.scheduledRefresh,
    archivedAt: program.archivedAt,
    columns: program.outputColumns ? JSON.parse(program.outputColumns) : [],
    orgSharedRun: orgSharedRun
      ? {
          status: orgSharedRun.status,
          errorCode: orgSharedRun.errorCode,
          errorMessage: orgSharedRun.errorMessage,
          finishedAt: orgSharedRun.finishedAt,
        }
      : null,
    lastRun: lastRun
      ? {
          status: lastRun.status,
          rowCount: lastRun.rowCount,
          truncated: lastRun.truncated,
          errorCode: lastRun.errorCode,
          errorMessage: lastRun.errorMessage,
          finishedAt: lastRun.finishedAt,
          ...(options.includeRows && lastRun.rowsJson
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
            ...(options.includeRows && lastGoodRun.rowsJson
              ? { rows: JSON.parse(lastGoodRun.rowsJson) }
              : {}),
          },
        }
      : {}),
  };
}
