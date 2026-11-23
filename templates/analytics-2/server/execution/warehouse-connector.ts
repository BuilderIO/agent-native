import { fail } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import { validateBigQueryProjectAccess } from "../model/data-connection-provider.js";
import {
  isBuiltinSampleConnection,
  readDataConnection,
} from "../model/data-connections.js";
import { digest } from "../model/notebook-execution/planner.js";
import type { ExecutionActor } from "../model/notebook-execution/snapshot.js";
import { resolveNotebookPostgresConnection } from "../model/postgres-connection.js";
import { executeSampleQuery } from "../model/sample-query.js";
import { createPostgresConnector } from "./postgres-connector.js";
import { withBigQuerySource, type BigQuerySource } from "./source-resolver.js";
import {
  bigQueryAdapter,
  bigQueryLocation,
  prepareBigQuery,
  ProviderOutcomeUnknown,
} from "./sql-adapter.js";
import {
  compileNotebookSql,
  type CompiledSql,
  type WarehouseDialect,
} from "./sql-compiler.js";

function bind(dialect: WarehouseDialect) {
  return (sql: string, values: Parameters<typeof compileNotebookSql>[1]) =>
    compileNotebookSql(sql, values, dialect);
}

function staleSource(): never {
  fail("The data connection changed. Run the query again.", {
    errorCode: "source_authority_changed",
    statusCode: 409,
  });
}

function catalogPort(
  id: string,
  actor: ExecutionActor,
  authorize: () => Promise<void>,
) {
  return {
    async catalog(
      input: Omit<
        Parameters<
          typeof import("../model/data-connections.js").listConnectionDatasets
        >[0],
        "connectionId"
      >,
    ) {
      await authorize();
      const { listConnectionDatasets } =
        await import("../model/data-connections.js");
      return listConnectionDatasets(
        { ...input, connectionId: id },
        {
          forAgent: actor.caller !== "frontend",
        },
      );
    },
    async describe(tableId: string) {
      await authorize();
      const { getDataTableDetails } =
        await import("../model/data-table-details.js");
      return getDataTableDetails({ connectionId: id, tableId }, actor.caller);
    },
  };
}

function sampleSource(id: string | null, actor: ExecutionActor) {
  const authorize = async () => {};
  return {
    kind: "sample",
    id,
    generation: null,
    dialect: "sample",
    capabilities: { recover: false, arrow: false, cancel: false },
    authorize,
    ...catalogPort(id ?? "", actor, authorize),
    validate: authorize,
    compile: bind("sample"),
    submit: (compiled: CompiledSql, signal?: AbortSignal) =>
      executeSampleQuery(
        compiled.sql,
        compiled.parameters.map(({ parameterValue }) => parameterValue.value),
        isBuiltinSampleConnection(id),
        signal,
      ),
  } as const;
}

function bigQuerySource(
  id: string,
  actor: ExecutionActor,
  source: BigQuerySource,
) {
  async function current<T>(run: (next: BigQuerySource) => Promise<T>) {
    return withBigQuerySource(id, actor, async (next) => {
      if (next.generation !== source.generation) staleSource();
      return run(next);
    });
  }
  const authorize = () => current(async () => {});
  return {
    kind: "bigquery",
    id,
    projectId: source.projectId,
    generation: source.generation,
    dialect: "bigquery",
    capabilities: {
      recover: true,
      arrow: Boolean(source.storage),
      cancel: true,
    },
    authorize,
    ...catalogPort(id, actor, authorize),
    validate: () =>
      current((next) =>
        validateBigQueryProjectAccess(next.runtime, next.projectId),
      ),
    compile: bind("bigquery"),
    async prepare(
      compiled: CompiledSql,
      submissionId: string,
      cache: "reuse" | "bypass",
      saved?: { projectId: string; jobId: string; location: string },
    ) {
      const location =
        saved?.location ??
        (await current((next) => bigQueryLocation(next, compiled, cache)));
      const operation = prepareBigQuery(
        { ...source, location },
        compiled,
        submissionId,
        cache,
      );
      if (saved && digest(operation.job) !== digest(saved))
        throw new ProviderOutcomeUnknown("warehouse_job_identity_mismatch");
      const adapter = <T>(
        run: (provider: ReturnType<typeof bigQueryAdapter>) => Promise<T>,
      ) => current((next) => run(bigQueryAdapter(next, operation)));
      return {
        ...operation,
        start: (recovered: boolean) => adapter((next) => next.start(recovered)),
        spoolPage: (
          ...input: Parameters<ReturnType<typeof bigQueryAdapter>["spoolPage"]>
        ) => adapter((next) => next.spoolPage(...input)),
        cancel: (mode: "request" | "status") =>
          adapter((next) => next.cancel(mode)),
      };
    },
  } as const;
}

async function postgresSource(id: string, actor: ExecutionActor) {
  const { config, generation } = await resolveNotebookPostgresConnection(
    id,
    actor.caller,
  );
  const authorize = async () => {
    const current = await resolveNotebookPostgresConnection(id, actor.caller);
    if (current.generation !== generation) staleSource();
  };
  const connector = createPostgresConnector(config, authorize);
  return {
    kind: "postgres",
    id,
    projectId: config.database,
    generation: BigInt(`0x${digest([id, generation])}`).toString(),
    dialect: "postgres",
    capabilities: { recover: false, arrow: true, cancel: true },
    authorize,
    ...catalogPort(id, actor, authorize),
    validate: (signal?: AbortSignal) => connector.validate(signal),
    compile: bind("postgres"),
    connector,
  } as const;
}

type WarehouseSource =
  | ReturnType<typeof sampleSource>
  | ReturnType<typeof bigQuerySource>
  | Awaited<ReturnType<typeof postgresSource>>;

export async function withWarehouseSource<T>(
  id: string | null,
  actor: ExecutionActor,
  run: (source: WarehouseSource) => Promise<T>,
): Promise<T> {
  const context = getRequestContext();
  if (
    context?.orgId !== actor.orgId ||
    context.userEmail?.trim().toLowerCase() !==
      actor.ownerEmail.trim().toLowerCase()
  )
    fail("The warehouse must use the active workspace.", {
      errorCode: "source_access_denied",
      statusCode: 403,
    });

  if (!id || isBuiltinSampleConnection(id)) return run(sampleSource(id, actor));
  if (
    id !== ORGANIZATION_BIGQUERY_SOURCE_ID &&
    (await readDataConnection(id)).provider === "postgres"
  )
    return run(await postgresSource(id, actor));
  return withBigQuerySource(id, actor, (source) =>
    run(bigQuerySource(id, actor, source)),
  );
}
