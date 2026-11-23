import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { fail, isActionContractError } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CONTRACT_VERSION,
  kernelCommandSchema,
} from "../../shared/kernel-contract.js";
import type { ResultField } from "../../shared/notebook-result-contract.js";
import {
  authorizedResultRefSchema,
  completeResultManifestSchema,
  resultManifestSchema,
} from "../../shared/notebook-result-contract.js";
import { getDb, schema } from "../db/index.js";
import {
  requirePreparedDraftSqlCapability,
  requirePreparedNotebookSqlSource,
} from "../lib/analytics-capabilities.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { isBuiltinSampleConnection } from "../model/data-connections.js";
import {
  advanceKernelGeneration,
  readKernelNamespace,
} from "../model/kernel-namespaces.js";
import { digest } from "../model/notebook-execution/planner.js";
import type {
  Claim,
  KernelPromotion,
  createRunStore,
} from "../model/notebook-execution/run-store.js";
import {
  notebookResultManifests,
  type ResultBuild,
  type SourceAuthority,
} from "../model/notebook-execution/schema.js";
import {
  draftNamespace,
  type ExecutionActor,
} from "../model/notebook-execution/snapshot.js";
import {
  checkNotebookAuthorities,
  findCachedNotebookResult,
  readNotebookKernelInput,
  readNotebookResultAuthorities,
  readNotebookResultChoices,
} from "../model/notebook-results.js";
import { namesSampleTable } from "../model/sample-query.js";
import {
  MAX_RESULT_SEGMENTS,
  RESULT_SEGMENT_ROWS,
  notebookResultFields,
  kernelArrowTable,
  stageNotebookArrowSegment,
  stageNotebookSegment,
  type NotebookRows,
} from "./notebook-arrow.js";
import {
  notebookBigQueryFailureMessage,
  notebookFailureMessage,
  notebookProviderDiagnostic,
  type ProviderDiagnostic,
} from "./notebook-diagnostics.js";
import {
  createKernelResult,
  kernelResultArtifact,
  readKernelExport,
  stageKernelArrowResult,
} from "./notebook-kernel-result.js";
import {
  kernelActor,
  KernelAttemptError,
  type KernelPort,
} from "./notebook-kernel.js";
import { phase1DraftFixture } from "./phase1-draft-fixture.js";
import { phase1ScheduleFixture } from "./phase1-schedule-fixture.js";
import { sqlSource } from "./source-resolver.js";
import {
  ProviderOutcomeUnknown,
  RestartWarehouseSpool,
  WarehouseExecutionError,
} from "./sql-adapter.js";
import {
  SqlBindingError,
  compileNotebookSql,
  inputBinding,
  type CompiledSql,
} from "./sql-compiler.js";
import { withWarehouseSource } from "./warehouse-connector.js";

type Store = ReturnType<typeof createRunStore>;
export type { KernelPort } from "./notebook-kernel.js";

function redactSql(sql: string) {
  return sql.replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|''|[^'])*'|"(?:""|\\.|[^"])*"|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi,
    "?",
  );
}

function diagnostic(
  compiled: CompiledSql,
  fingerprint: string,
  queryText = compiled.sql,
) {
  return {
    compiledSql: redactSql(queryText).slice(0, 100_000),
    fingerprint,
    parameters: compiled.parameters.map(({ name, parameterType }) => ({
      name,
      type: parameterType.type,
    })),
  };
}

export function createNotebookWorker(store: Store, kernel?: KernelPort) {
  return async function workNotebookRun(
    actor: ExecutionActor,
    runId: string,
    signal?: AbortSignal,
  ) {
    const claim = await store.claim(actor, runId);
    if (!claim) return false;
    const { run, work, attempt, dependencies } = claim;
    const { request } = run.receipt;
    const { namespace } = request.snapshot;
    const threadId =
      namespace.kind === "thread" ? namespace.threadId : undefined;
    const resultScope = {
      threadId,
      previewId: namespace.kind === "preview" ? namespace.previewId : undefined,
      sessionId:
        namespace.kind === "release-session" &&
        String(namespace.namespaceId) !== String(namespace.sessionId)
          ? namespace.sessionId
          : undefined,
      ...(namespace.kind === "release-default"
        ? { releaseDefault: request.snapshot }
        : {}),
    };
    const node = run.plan.cells.find(({ cell }) => cell.id === attempt.cellId);
    const contents = node?.cell.contents;
    if (!node || !contents || contents.kind === "input")
      throw new Error("Notebook worker received a non-executable cell");

    let fallbackCode = work.resultBuild?.fallbackCode;
    let fallbackProvider: ProviderDiagnostic | undefined =
      work.resultBuild?.fallbackProvider;
    let sourceMapped = false;
    const warehouseRun = { bigQuery: false };
    let kernelMessage: string | undefined;
    let kernelPromotion: KernelPromotion | undefined;
    try {
      const source = await resolveSource();
      const draftFixture =
        namespace.kind === "draft" ? phase1DraftFixture() : undefined;
      const fixtureAttempt = {
        projectId: request.snapshot.ref.projectId,
        cellId: attempt.cellId,
        runId,
        attemptId: attempt.attemptId,
      };
      const guard = async (operation?: Parameters<Store["renew"]>[2]) => {
        if (signal?.aborted) throw new WorkerLeaseLost();
        const state = await store.renew(claim, undefined, operation);
        if (state.status === "authority-changed")
          throw new ProviderOutcomeUnknown("source_authority_changed");
        if (state.status === "lost") throw new WorkerLeaseLost();
        return state.status;
      };
      const expected = (
        sourceGeneration: string | null,
        kernelGeneration: string | null,
        exportId = "result",
      ) =>
        authorizedResultRefSchema.parse({
          resultId:
            exportId === "result"
              ? digest(attempt)
              : digest([attempt, exportId]),
          producer: { ...attempt, exportId },
          snapshot: request.snapshot.ref,
          inputRevision: request.snapshot.inputRevision,
          dependencyFingerprint: digest(
            dependencies.map(({ result }) => result.resultId),
          ),
          sourceGeneration,
          kernelGeneration,
        });
      let authorities = await readNotebookResultAuthorities(dependencies);
      let fields: ResultField[] | undefined;
      let rowCount = 0;
      let schemaFingerprint: string | undefined;
      const buildFor = (
        result: ResultBuild["result"],
        artifactId: string = randomUUID(),
      ): ResultBuild => ({ result, artifactId, authorities });
      const stage = async (page: NotebookRows, build: ResultBuild) => {
        const fingerprint = digest(page.columns);
        if (schemaFingerprint && schemaFingerprint !== fingerprint)
          throw new Error("Notebook result schema changed");
        schemaFingerprint = fingerprint;
        fields = notebookResultFields(page.columns);
        for (
          let start = 0;
          start < page.rows.length;
          start += RESULT_SEGMENT_ROWS
        ) {
          await guard();
          const rows = page.rows.slice(start, start + RESULT_SEGMENT_ROWS);
          await stageNotebookSegment(
            {
              artifactId: build.artifactId,
              attemptId: attempt.attemptId,
              ownerEmail: actor.ownerEmail,
              submissionId: work.submissionId,
              startRow: rowCount,
              page: { ...page, rows },
              fields,
            },
            (segment) => store.recordSegment(claim, segment),
          );
          rowCount += rows.length;
        }
      };
      const validateAuthorities = async () => {
        for (const { connectionId, generation } of authorities)
          await withWarehouseSource(connectionId, actor, async (source) => {
            if (source.generation !== generation)
              throw new ProviderOutcomeUnknown("source_authority_changed");
          });
      };
      const finish = async (
        build: ResultBuild,
        cacheKey: string | null,
        reason?: "truncated" | "coverage_unverified",
        createdAt: number | null = Date.now(),
      ) => {
        await validateAuthorities();
        if (!fields) throw new Error("Notebook result did not return a schema");
        const incomplete =
          !reason && draftFixture?.takeIncomplete(fixtureAttempt);
        const incompleteReason = incomplete ? "truncated" : reason;
        const manifest = resultManifestSchema.parse({
          result: build.result,
          fields,
          ...(incompleteReason
            ? {
                status: "incomplete",
                reason: incompleteReason,
                verifiedRowCount: String(rowCount),
              }
            : {
                status: rowCount === 0 ? "complete-empty" : "complete",
                rowCount: String(rowCount),
              }),
        });
        await draftFixture?.hold(fixtureAttempt, "before-promotion");
        if (namespace.kind === "thread")
          await phase1DraftFixture()?.hold(
            fixtureAttempt,
            "before-candidate-promotion",
          );
        await store.finish(claim, {
          status: "result",
          artifact: {
            manifest,
            artifactId: build.artifactId,
            artifacts: [],
            authorities,
            cacheKey: incompleteReason ? null : cacheKey,
            createdAt,
          },
          expected: build.result,
          ...(fallbackCode ? { fallbackCode } : {}),
        });
      };
      const cacheKeyFor = (operation: unknown) => {
        const key = (scope: string | [string, string]) =>
          digest([
            actor.orgId,
            actor.ownerEmail,
            scope,
            operation,
            dependencies.map(({ result }) => result.resultId),
            authorities,
          ]);
        const donor = threadId
          ? draftNamespace(actor, request.snapshot.ref.projectId).namespaceId
          : run.plan.cacheDonor;
        return {
          primary: key(
            namespace.kind === "schedule-tick"
              ? ["schedule-sql", namespace.releaseId]
              : attempt.namespaceId,
          ),
          donor: donor ? key(donor) : null,
        };
      };
      const reuse = async (
        build: ResultBuild,
        keys: ReturnType<typeof cacheKeyFor>,
      ) => {
        if (work.dispatched || request.cache !== "reuse") return false;
        const { versionId } = request.snapshot.ref.head;
        const cached =
          (await findCachedNotebookResult(keys.primary, versionId)) ??
          (keys.donor
            ? await findCachedNotebookResult(keys.donor, versionId)
            : null);
        if (!cached) return false;
        fields = cached.manifest.fields;
        rowCount = Number(cached.manifest.rowCount);
        await finish(
          { ...build, artifactId: cached.artifactId },
          keys.primary,
          undefined,
          cached.createdAt,
        );
        return true;
      };

      const bindings = new Map<string, ReturnType<typeof inputBinding>>();
      for (const { name, cellId, kind } of node.dependencies) {
        if (kind !== "input") continue;
        const input = run.plan.cells.find(({ cell }) => cell.id === cellId)
          ?.cell.contents;
        if (input?.kind !== "input")
          throw new Error("Notebook input is unreadable");
        if (input.dynamicOptions) {
          const { producerCellId, valueFieldId, displayFieldId } =
            input.dynamicOptions;
          const artifact = dependencies.find(
            ({ result }) => result.producer.cellId === producerCellId,
          );
          if (!artifact)
            throw new Error("Notebook input has no choices artifact");
          const choices = await readNotebookResultChoices(
            actor,
            artifact.result.resultId,
            valueFieldId,
            displayFieldId,
            resultScope,
          );
          const value = input.defaultValueString;
          const selected =
            value === "" || value === "null"
              ? []
              : input.inputType === "MULTISELECT"
                ? z.array(z.string()).parse(JSON.parse(value))
                : [value];
          if (choices.status === "unreadable")
            throw new WarehouseExecutionError("input_options_unreadable");
          if (choices.status === "denied")
            throw new WarehouseExecutionError("input_options_denied");
          if (
            (selected.length === 0 &&
              input.inputType === "DROPDOWN" &&
              !input.optional) ||
            (selected.length > 0 &&
              (choices.status !== "ready" ||
                selected.some(
                  (item) => !choices.values.some(({ value }) => value === item),
                )))
          )
            throw new WarehouseExecutionError("input_option_not_allowed");
        }
        bindings.set(name, inputBinding(input));
      }
      if (
        contents.kind === "sql" &&
        (source.kind === "warehouse" || source.kind === "sample")
      ) {
        const sourceId =
          source.kind === "sample" ? contents.dataConnectionId : source.id;
        await withWarehouseSource(sourceId, actor, async (warehouse) => {
          if (
            warehouse.kind !== "sample" &&
            node.dependencies.some(({ kind }) => kind === "result")
          )
            throw new WarehouseExecutionError(
              "warehouse_relation_binding_unsupported",
            );
          const compiled = warehouse.compile(contents.source, bindings);
          const table = contents.warehouseTable;
          if (
            table &&
            (table.connectionId !== warehouse.id ||
              (warehouse.kind !== "sample" &&
                (table.projectId !== warehouse.projectId ||
                  table.authorityGeneration !== warehouse.generation)))
          )
            throw new WarehouseExecutionError("source_authority_changed");
          if (warehouse.kind !== "sample") {
            authorities.push({
              connectionId: warehouse.id,
              generation: warehouse.generation,
            } satisfies SourceAuthority);
          }
          const result = expected(warehouse.generation, null);
          const cacheKeyForSource = (operation: unknown) =>
            cacheKeyFor([warehouse.id, operation, contents.outputResult]);

          if (warehouse.kind === "sample") {
            const fingerprint = digest(compiled);
            const build = buildFor(result);
            const cacheKey = cacheKeyFor([
              source,
              compiled,
              contents.outputResult,
            ]);
            if (
              (await guard({
                fingerprint,
                build,
                dispatch: diagnostic(compiled, fingerprint),
              })) === "cancel"
            )
              throw new WorkerCancelled();
            if (await reuse(build, cacheKey)) return;
            const fixture =
              namespace.kind === "schedule-tick" && phase1ScheduleFixture();
            let execution = compiled;
            if (fixture) {
              const { readAuthorizedScheduleTick } =
                await import("../model/published-app-schedules.js");
              const tick = await readAuthorizedScheduleTick(
                actor,
                claim.run.receipt.request.snapshot,
              );
              if (!tick)
                throw new WarehouseExecutionError("schedule_tick_unavailable");
              try {
                const sql = await withWarehouseCancellation(
                  guard,
                  signal,
                  (leaseSignal) =>
                    fixture.query(tick, compiled.sql, leaseSignal),
                );
                execution = { ...compiled, sql };
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.name === "Phase1ScheduleQueryError"
                )
                  throw new WarehouseExecutionError(error.message);
                throw error;
              }
            }
            if (draftFixture) {
              await withWarehouseCancellation(
                guard,
                signal,
                async (leaseSignal) => {
                  await draftFixture.hold(
                    fixtureAttempt,
                    "before-dispatch",
                    leaseSignal,
                  );
                },
              );
            }
            const output = await withWarehouseCancellation(
              guard,
              signal,
              (leaseSignal) => warehouse.submit(execution, leaseSignal),
            );
            if (!output) {
              if (
                !isBuiltinSampleConnection(warehouse.id) &&
                !namesSampleTable(execution.sql)
              )
                fail("Select a data connection before running this query.", {
                  statusCode: 422,
                  errorCode: "project_connection_required",
                });
              fail(
                "This query uses the bundled sample data, which could not execute this SQL. Check the query or connect a data source.",
                {
                  statusCode: 422,
                  errorCode: "project_sample_query_unsupported",
                },
              );
            }
            await stage(output.output, build);
            await finish(
              build,
              cacheKey.primary,
              output.output.truncated ? "truncated" : undefined,
            );
            return;
          }

          if (warehouse.kind === "postgres") {
            const fingerprint = digest([
              warehouse.id,
              warehouse.generation,
              compiled,
            ]);
            const build = buildFor(result);
            const cacheKey = cacheKeyForSource(compiled);
            const state = await guard({
              fingerprint,
              build,
              dispatch: diagnostic(compiled, fingerprint),
            });
            if (state === "cancel" && !work.dispatched)
              throw new WorkerCancelled();
            if (work.dispatched) await warehouse.connector.recover();
            if (await reuse(build, cacheKey)) return;

            await withWarehouseCancellation(
              guard,
              signal,
              async (readSignal) => {
                const cursor = await warehouse.connector.submit(
                  compiled,
                  readSignal,
                );
                let previousCursor: string | null = null;
                let open = true;
                try {
                  for (let count = 0; count < MAX_RESULT_SEGMENTS; count++) {
                    const page = await cursor.page(RESULT_SEGMENT_ROWS);
                    readSignal.throwIfAborted();
                    if (
                      page.complete !== (page.cursor === null) ||
                      (!page.complete &&
                        (!page.table.numRows || page.cursor === previousCursor))
                    )
                      throw new WarehouseExecutionError(
                        "warehouse_result_coverage_unverified",
                      );
                    const shape = digest([
                      page.fields,
                      page.table.schema.fields.map(({ type }) => String(type)),
                    ]);
                    if (schemaFingerprint && schemaFingerprint !== shape)
                      throw new WarehouseExecutionError(
                        "warehouse_result_schema_changed",
                      );
                    schemaFingerprint = shape;
                    fields = page.fields;
                    if (page.table.numRows) {
                      await stageNotebookArrowSegment(
                        {
                          artifactId: build.artifactId,
                          attemptId: attempt.attemptId,
                          ownerEmail: actor.ownerEmail,
                          submissionId: work.submissionId,
                          startRow: rowCount,
                          table: page.table,
                          fields,
                        },
                        (segment) => store.recordSegment(claim, segment),
                      );
                      rowCount += page.table.numRows;
                    }
                    if (page.complete) {
                      open = false;
                      readSignal.throwIfAborted();
                      await finish(build, cacheKey.primary);
                      return;
                    }
                    previousCursor = page.cursor;
                  }
                  await cursor.cancel();
                  open = false;
                  await finish(build, null, "truncated");
                } finally {
                  if (open) await cursor.cancel();
                }
              },
            );
            return;
          }

          warehouseRun.bigQuery = true;
          sourceMapped = contents.source === compiled.sql;
          const operation = await warehouse.prepare(
            compiled,
            work.submissionId,
            request.cache,
            work.providerJob ?? undefined,
          );
          if (
            table?.location &&
            table.location.toLowerCase() !==
              operation.job.location.toLowerCase()
          )
            throw new WarehouseExecutionError(
              "warehouse_dataset_location_changed",
            );
          const cacheKey = cacheKeyForSource([
            operation.job.location.toLowerCase(),
            operation.config.query,
            compiled.parameters,
          ]);
          const saved = work.resultBuild?.transport ? work.checkpoint : null;
          sourceMapped = contents.source === operation.config.query;
          let transport =
            work.resultBuild?.transport ??
            (warehouse.capabilities.arrow ? "storage" : "rest");
          let build = {
            ...buildFor(result, work.resultBuild?.artifactId),
            transport,
            ...(fallbackCode ? { fallbackCode } : {}),
            ...(fallbackProvider ? { fallbackProvider } : {}),
          };
          let cursor = saved?.cursor ?? null;
          let totalRows = saved?.totalRows ?? null;
          rowCount = saved?.rowCount ?? 0;
          fields = saved?.fields;
          schemaFingerprint = saved?.schemaFingerprint;
          const state = await guard({
            build,
            job: operation.job,
            fingerprint: operation.fingerprint,
            dispatch: diagnostic(
              compiled,
              operation.fingerprint,
              operation.config.query,
            ),
            ...(fallbackCode ? { fallbackCode } : {}),
            ...(fallbackProvider ? { fallbackProvider } : {}),
          });
          if (state === "cancel" && !work.dispatched)
            throw new WorkerCancelled();
          if (state !== "cancel" && (await reuse(build, cacheKey))) return;
          let cancellationSent = false;
          if (state !== "cancel") {
            const job = await operation.start(work.dispatched);
            if (job.errorResult) {
              if (job.errorResult.reason === "stopped")
                throw new WorkerCancelled();
              throw new WarehouseExecutionError(
                job.errorResult.reason === "accessDenied"
                  ? "warehouse_query_denied"
                  : "warehouse_query_failed",
                job.errorResult,
              );
            }
          }
          for (let count = 0; count < MAX_RESULT_SEGMENTS; count++) {
            if ((await guard()) === "cancel") {
              const cancelled = await operation.cancel(
                cancellationSent ? "status" : "request",
              );
              cancellationSent = true;
              if (cancelled === "cancelled") throw new WorkerCancelled();
              if (cancelled === "failed")
                throw new WarehouseExecutionError("warehouse_query_failed");
              if (cancelled === "pending") continue;
            }
            let page;
            try {
              page = await operation.spoolPage(transport, rowCount, cursor);
            } catch (error) {
              if (!(error instanceof RestartWarehouseSpool)) throw error;
              fallbackCode = error.diagnostic.errorCode;
              fallbackProvider = notebookProviderDiagnostic(
                error.diagnostic,
                false,
              );
              transport = "rest";
              build = {
                ...buildFor(result),
                transport,
                fallbackCode,
                ...(fallbackProvider ? { fallbackProvider } : {}),
              };
              cursor = null;
              fields = undefined;
              schemaFingerprint = undefined;
              rowCount = 0;
              totalRows = null;
              await guard({
                build,
                fingerprint: operation.fingerprint,
                restartSpool: true,
                fallbackCode,
                ...(fallbackProvider ? { fallbackProvider } : {}),
              });
              continue;
            }
            if (!page.jobComplete) continue;
            if (
              !page.totalRows ||
              !/^\d+$/.test(page.totalRows) ||
              (totalRows !== null && totalRows !== page.totalRows) ||
              BigInt(rowCount + page.rows.length) > BigInt(page.totalRows) ||
              (page.hasNextPage &&
                (!page.rows.length ||
                  !page.pageToken ||
                  page.pageToken === cursor))
            )
              throw new WarehouseExecutionError(
                "warehouse_result_coverage_unverified",
              );
            totalRows = page.totalRows;
            await stage(page, build);
            if (!page.hasNextPage) {
              await finish(
                build,
                cacheKey.primary,
                BigInt(totalRows) === BigInt(rowCount)
                  ? undefined
                  : "coverage_unverified",
              );
              return;
            }
            if (!fields || !schemaFingerprint)
              throw new Error("Notebook result schema is unreadable");
            cursor = page.pageToken;
            await guard({
              fingerprint: operation.fingerprint,
              checkpoint: {
                cursor,
                rowCount,
                totalRows,
                fields,
                schemaFingerprint,
              },
            });
          }
          if (!fields)
            throw new ProviderOutcomeUnknown("warehouse_result_pending");
          await finish(build, null, "truncated");
        });
      } else {
        if (!kernel)
          throw new WarehouseExecutionError("kernel_transport_unavailable");
        const inputAuthority = await checkNotebookAuthorities(
          actor,
          authorities,
        );
        if (inputAuthority)
          throw new KernelAttemptError(
            inputAuthority.status === "denied"
              ? "dataframe_denied"
              : "result_unreadable",
          );
        const generation = await kernel.generation(claim);
        const python = source.kind === "python";
        if (python) {
          authorities = await retainPythonAuthorities(
            claim,
            generation,
            authorities,
          );
          const failure = await checkNotebookAuthorities(actor, authorities);
          if (failure) {
            const found = await readKernelNamespace(
              kernelActor(actor),
              attempt.namespaceId,
            );
            if (found && String(found.generation) === generation)
              await advanceKernelGeneration(
                found,
                { status: "expired" },
                new Date(),
                getDb(),
              );
            throw new KernelAttemptError(
              failure.status === "denied"
                ? "dataframe_denied"
                : "result_unreadable",
            );
          }
        }
        const compiled = python
          ? null
          : compileNotebookSql(contents.source, bindings, "dataframes");
        const inputs = [];
        const arrow = new Map<string, Uint8Array>();
        let totalBytes = 0;
        for (const { name, cellId, kind } of node.dependencies) {
          if (kind !== "result") continue;
          let manifest = dependencies.find(
            ({ result }) => result.producer.cellId === cellId,
          );
          if (!manifest) throw new KernelAttemptError("dataframe_incomplete");
          const producer = run.plan.cells.find(({ cell }) => cell.id === cellId)
            ?.cell.contents;
          if (producer?.kind === "code") {
            if (manifest.result.kernelGeneration !== generation)
              throw new KernelAttemptError("kernel_export_expired");
            const exported = await readKernelExport(
              manifest.result.producer.attemptId,
              name,
              !python,
            );
            if (!exported)
              throw new KernelAttemptError("kernel_export_missing");
            if (exported.kind !== "dataframe") {
              if (python) continue;
              throw new KernelAttemptError("dataframe_incomplete");
            }
            const resultId = exported.resultId;
            if (!resultId) throw new KernelAttemptError("dataframe_incomplete");
            const [extra] = await getDb()
              .select({ manifest: notebookResultManifests.manifest })
              .from(notebookResultManifests)
              .where(eq(notebookResultManifests.id, resultId))
              .limit(1);
            const parsed = completeResultManifestSchema.safeParse(
              extra?.manifest,
            );
            if (
              !parsed.success ||
              parsed.data.result.producer.attemptId !==
                manifest.result.producer.attemptId
            )
              throw new KernelAttemptError("dataframe_incomplete");
            manifest = parsed.data;
          }
          inputs.push({ name, manifest });
          if (!arrow.has(manifest.result.resultId)) {
            const bytes = await readNotebookKernelInput(
              actor,
              manifest,
              resultScope,
            );
            totalBytes += bytes.byteLength;
            if (totalBytes > 64 * 1024 * 1024)
              throw new KernelAttemptError("kernel_input_limit");
            arrow.set(manifest.result.resultId, bytes);
          }
        }
        const initial = run.receipt.attempts.find(
          ({ attempt: reserved }) => reserved.cellId === attempt.cellId,
        );
        if (!initial) throw new Error("Kernel command identity is unavailable");
        const kernelContext = python
          ? (work.resultBuild?.kernelContext ?? (await pythonContext(claim)))
          : "";
        const operation = compiled
          ? {
              operation: "execute-dataframe-sql",
              source: compiled.sql,
              params: compiled.parameters.map(
                ({ parameterType, parameterValue }) => ({
                  type: parameterType.type,
                  value: parameterValue.value,
                }),
              ),
              inputs,
            }
          : {
              operation: "execute-python",
              source: `${kernelContext}\n${contents.source}`,
              inputs,
            };
        const command = kernelCommandSchema.parse({
          protocolVersion: CONTRACT_VERSION,
          namespaceId: attempt.namespaceId,
          generation,
          runId,
          attemptId: initial.attempt.attemptId,
          commandId: work.submissionId,
          resumeCursor: null,
          command: operation,
        });
        const kernelBuild = (exportId?: string): ResultBuild => ({
          ...buildFor(expected(null, generation, exportId)),
          ...(kernelContext ? { kernelContext } : {}),
        });
        const build = kernelBuild();
        const fingerprint = digest(command);
        const prepare = (value: ResultBuild) =>
          guard({
            fingerprint,
            build: value,
            ...(compiled
              ? { dispatch: diagnostic(compiled, fingerprint) }
              : {}),
          });
        if ((await prepare(build)) === "cancel" && !work.dispatched) {
          throw new WorkerCancelled();
        }
        const received = await createKernelResult(
          claim,
          generation,
          authorities,
          python,
          async (bytes, exportId) => {
            const table = kernelArrowTable(bytes);
            const output =
              exportId === "result" ? build : kernelBuild(exportId);
            await prepare(output);
            return stageKernelArrowResult(claim, output, table, (segment) =>
              store.recordSegment(claim, segment),
            );
          },
        );
        try {
          await kernel.execute(
            claim,
            command,
            async (ref) => {
              const bytes = arrow.get(ref.resultId);
              if (!bytes) throw new KernelAttemptError("dataframe_denied");
              return bytes;
            },
            async (event, artifact) => {
              if (!python && event.type === "error")
                kernelMessage = event.trace.trim().split("\n", 1)[0];
              await received.receive(event, artifact);
            },
            signal,
          );
        } catch (error) {
          await validateAuthorities();
          kernelPromotion = (await received.finish(false)).promotion;
          throw error;
        }
        await validateAuthorities();
        const { primary, promotion } = await received.finish(true);
        if (!python && !primary)
          throw new KernelAttemptError("kernel_artifact_missing");
        await prepare(build);
        await store.finish(
          claim,
          {
            status: "result",
            artifact: primary ?? kernelResultArtifact(build, [], 0),
            expected: build.result,
          },
          undefined,
          promotion,
        );
      }
    } catch (error) {
      if (error instanceof WorkerLeaseLost || signal?.aborted) return true;
      const unknown =
        error instanceof ProviderOutcomeUnknown ||
        (error instanceof KernelAttemptError && error.outcome === "unknown") ||
        (isActionContractError(error) &&
          error.errorCode === "warehouse_query_cancel_unknown");
      const provider = notebookProviderDiagnostic(error, sourceMapped);
      const code =
        error instanceof SqlBindingError
          ? "sql_binding_invalid"
          : error instanceof WarehouseExecutionError ||
              error instanceof KernelAttemptError
            ? error.message
            : unknown && error instanceof Error
              ? error.message
              : isActionContractError(error)
                ? error.errorCode
                : error instanceof WorkerCancelled
                  ? "cancel_confirmed"
                  : "execution_failed";
      await store.finish(
        claim,
        {
          ...(provider ? { provider } : {}),
          ...(fallbackCode ? { fallbackCode } : {}),
          status:
            error instanceof WorkerCancelled ||
            (error instanceof KernelAttemptError &&
              error.outcome === "cancelled")
              ? "cancelled"
              : unknown
                ? "unknown"
                : "failed",
          code,
          message: warehouseRun.bigQuery
            ? notebookBigQueryFailureMessage(error)
            : notebookFailureMessage(error, code, provider, kernelMessage),
        },
        undefined,
        kernelPromotion,
      );
    }
    return true;

    async function resolveSource() {
      if (contents?.kind !== "sql") return { kind: "python" } as const;
      const current = await requireCurrentWorkspace();
      if (
        current.ownerEmail !== actor.ownerEmail ||
        current.orgId !== actor.orgId
      )
        throw new WarehouseExecutionError("source_access_denied");
      const cell = {
        id: attempt.cellId,
        projectId: request.snapshot.ref.projectId,
        contents,
      };
      const authorize =
        namespace.kind === "draft" || namespace.kind === "thread"
          ? requirePreparedDraftSqlCapability
          : requirePreparedNotebookSqlSource;
      await authorize(current, cell, contents.dataConnectionId);
      return sqlSource(contents);
    }
  };
}

async function withWarehouseCancellation<T>(
  guard: () => Promise<"continue" | "cancel">,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const stopped = new AbortController();
  const lease = new AbortController();
  const readSignal = signal
    ? AbortSignal.any([lease.signal, signal])
    : lease.signal;
  const watch = (async () => {
    try {
      while (!stopped.signal.aborted) {
        await delay(250, undefined, { signal: stopped.signal });
        if ((await guard()) === "cancel") throw new WorkerCancelled();
      }
    } catch (error) {
      if (!stopped.signal.aborted) lease.abort(error);
    }
  })();
  try {
    return await run(readSignal);
  } catch (error) {
    readSignal.throwIfAborted();
    throw error;
  } finally {
    stopped.abort();
    await watch;
  }
}

async function pythonContext(claim: Claim) {
  const { snapshot } = claim.run.receipt.request;
  const { ref, namespace } = snapshot;
  const editing = namespace.kind === "draft" || namespace.kind === "thread";
  const scheduled = namespace.kind === "schedule-tick";
  const schedule = scheduled
    ? await import("../model/published-app-schedules.js").then(
        ({ readAuthorizedScheduleTick }) =>
          readAuthorizedScheduleTick(
            {
              ownerEmail: claim.run.ownerEmail,
              orgId: claim.run.orgId,
              caller: claim.run.caller,
            },
            snapshot,
          ),
      )
    : null;
  if (scheduled && !schedule) throw new KernelAttemptError("not_found");
  const [project] = await getDb()
    .select({ title: schema.projects.title, status: schema.projects.statusId })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, ref.projectId),
        eq(schema.projects.orgId, ref.workspaceId),
      ),
    )
    .limit(1);
  if (!project) throw new KernelAttemptError("not_found");
  const categoryRows = await getDb()
    .select({ id: schema.projectCategories.categoryId })
    .from(schema.projectCategories)
    .where(eq(schema.projectCategories.projectId, ref.projectId))
    .orderBy(schema.projectCategories.categoryId)
    .limit(200);
  const values = {
    notebook_scheduled: scheduled,
    ...(schedule ? { notebook_scheduled_for: schedule.dueAt } : {}),
    ...(editing ? { notebook_user_email: claim.run.ownerEmail } : {}),
    notebook_run_context: editing ? "logic" : "app",
    notebook_timezone: schedule?.flags.timezone ?? "UTC",
    notebook_project_id: ref.projectId,
    notebook_project_name: project.title,
    notebook_status: project.status,
    notebook_categories: categoryRows.map(({ id }) => id),
    notebook_color_palette: [],
  };
  return `# analytics-context ${JSON.stringify({ cellId: claim.attempt.cellId, values })}`;
}

async function retainPythonAuthorities(
  claim: Claim,
  generation: string,
  inputs: SourceAuthority[],
) {
  return getDb().transaction(async (tx) => {
    const binding = await readKernelNamespace(
      kernelActor(claim.run),
      claim.attempt.namespaceId,
      tx,
      true,
    );
    if (!binding || String(binding.generation) !== generation)
      throw new KernelAttemptError("kernel_generation_changed", "unknown");
    const previous = binding.variableState;
    const authorities = [
      ...new Map(
        [...(previous?.authorities ?? []), ...inputs].map((entry) => [
          digest(entry),
          entry,
        ]),
      ).values(),
    ];
    await tx
      .update(schema.kernelNamespaces)
      .set({
        variableState: { variables: previous?.variables ?? [], authorities },
      })
      .where(eq(schema.kernelNamespaces.id, binding.id));
    return authorities;
  });
}

class WorkerLeaseLost extends Error {}
class WorkerCancelled extends Error {}
