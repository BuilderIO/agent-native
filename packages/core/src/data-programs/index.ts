/**
 * Data programs: a named, stored, agent-authored JS script executed
 * server-side through the existing run-code sandbox, cached in SQL, and
 * rendered by dashboard panels via a `"program"` source.
 */

export {
  dataPrograms,
  dataProgramShares,
  dataProgramRunsCreateSql,
} from "./schema.js";

export {
  ensureDataProgramTables,
  registerDataProgramsShareable,
  upsertDataProgram,
  getDataProgram,
  getDataProgramByName,
  listDataPrograms,
  archiveDataProgram,
  recordDataProgramRun,
  updateDataProgramRun,
  getLatestSuccessfulRun,
  getLatestRun,
  getActiveRun,
  pruneDataProgramRuns,
  MAX_PROGRAM_ROWS,
  MAX_PROGRAM_RESULT_BYTES,
  MAX_ACTIVE_PROGRAMS_PER_APP,
  MIN_REFRESH_TTL_MS,
  type DataProgramRow,
  type DataProgramRefreshMode,
  type DataProgramRunRow,
  type DataProgramRunStatus,
  type UpsertDataProgramInput,
  type ListDataProgramsOptions,
  type RecordDataProgramRunInput,
  type UpdateDataProgramRunInput,
} from "./store.js";

export {
  DATA_PROGRAM_SENTINEL,
  buildDataProgramPrelude,
  parseDataProgramResult,
  inferDataProgramSchema,
  type DataProgramColumn,
  type DataProgramColumnType,
  type DataProgramContractError,
  type DataProgramContractErrorCode,
  type ParsedDataProgramResult,
  type ParseDataProgramResultOptions,
  type ParseDataProgramResultOutcome,
} from "./contract.js";

export {
  initDataPrograms,
  getInitializedDataProgramsAppId,
  canonicalDataProgramParamsJson,
  hashDataProgramParams,
  runDataProgram,
  type DataProgramErrorCode,
  type DataProgramSuccess,
  type DataProgramFailure,
  type DataProgramResult,
  type DataProgramTriggeredBy,
  type RunDataProgramArgs,
} from "./execute.js";

export {
  createDataProgramActions,
  type CreateDataProgramActionsOptions,
} from "./actions.js";
