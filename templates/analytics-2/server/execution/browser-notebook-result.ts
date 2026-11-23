import { randomUUID } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import { isPrivateBlobError } from "@agent-native/core/private-blob";
import { RecordBatchReader } from "apache-arrow";
import { z } from "zod";

import enUS from "../../app/i18n/en-US.js";
import { kernelEventSchema } from "../../shared/kernel-contract.js";
import {
  attemptIdSchema,
  runIdSchema,
} from "../../shared/notebook-execution.js";
import { kernelExceptionFields } from "../../shared/notebook-kernel-output.js";
import { authorizedResultRefSchema } from "../../shared/notebook-result-contract.js";
import { digest } from "../model/notebook-execution/planner.js";
import { notebookRunStore } from "../model/notebook-execution/service.js";
import type { ExecutionActor } from "../model/notebook-execution/snapshot.js";
import {
  checkNotebookAuthorities,
  readNotebookResultAuthorities,
} from "../model/notebook-results.js";
import { usesBrowserNotebookKernel } from "./kernel-client.js";
import {
  MAX_RESULT_SEGMENTS,
  RESULT_SEGMENT_ROWS,
  kernelArrowTable,
} from "./notebook-arrow.js";
import {
  createKernelResult,
  kernelResultArtifact,
  stageKernelArrowResult,
} from "./notebook-kernel-result.js";
import { KernelAttemptError } from "./notebook-kernel.js";

const artifactId =
  kernelEventSchema.shape.event.options[2].shape.artifactId.parse("browser");
const ARROW = "application/vnd.apache.arrow.stream";
export const BROWSER_RESULT_SUBMISSION_BYTES = 4 * 1024 * 1024;
const events = z
  .array(
    z.discriminatedUnion("type", [
      z.strictObject({
        type: z.literal("stream"),
        channel: z.enum(["stdout", "stderr"]),
        text: z.string().max(262_144),
      }),
      z.strictObject({
        type: z.literal("error"),
        reason: z.literal("execution_failed"),
        trace: z.string().max(262_144),
        line: z.int().positive().nullable(),
        ...kernelExceptionFields,
      }),
      z.strictObject({
        type: z.enum(["display", "result"]),
        contentType: z.enum([ARROW, "application/json"]),
        data: z.base64().min(1).max(BROWSER_RESULT_SUBMISSION_BYTES),
      }),
    ]),
  )
  .max(512)
  .refine(
    (events) =>
      Buffer.byteLength(JSON.stringify(events)) <=
      BROWSER_RESULT_SUBMISSION_BYTES,
    "Browser kernel results exceed the submission limit.",
  );

export const browserNotebookCompletionInput = z.strictObject({
  runId: runIdSchema,
  attemptId: attemptIdSchema,
  outcome: z.enum(["complete", "failed"]),
  events,
});

const stale = { status: "rejected", reason: "stale_attempt" } as const;
const saved = { status: "saved" } as const;

export const browserNotebookCompletionOutput = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal(saved.status) }),
  z.strictObject({
    status: z.literal(stale.status),
    reason: z.literal(stale.reason),
  }),
]);

function invalidResult(): never {
  return fail("The browser kernel result could not be read.", {
    statusCode: 400,
    errorCode: "browser_notebook_result_invalid",
  });
}

export async function saveBrowserNotebookCompletion(
  actor: ExecutionActor,
  input: z.infer<typeof browserNotebookCompletionInput>,
) {
  if (!usesBrowserNotebookKernel()) return stale;
  const { runId, attemptId, outcome, events } =
    browserNotebookCompletionInput.parse(input);
  const store = notebookRunStore;
  const fingerprint = digest([outcome, events]);
  const claim = await store.beginBrowserCompletion(
    actor,
    runId,
    attemptId,
    fingerprint,
  );
  if (!claim) return stale;
  if (claim === "saved") return saved;
  const { attempt, dependencies, run } = claim;
  const snapshot = run.receipt.request.snapshot;
  const python = run.plan.cells.some(
    ({ cell }) => cell.id === attempt.cellId && cell.contents.kind === "code",
  );
  try {
    const authorities = await readNotebookResultAuthorities(dependencies);
    const authorize = async () => {
      const failure = await checkNotebookAuthorities(actor, authorities);
      if (failure)
        fail("The notebook input could not be verified.", {
          statusCode: failure.status === "denied" ? 403 : 503,
          errorCode: "browser_notebook_input_unavailable",
        });
    };
    await authorize();
    const buildFor = (exportId: string) => ({
      artifactId: randomUUID(),
      authorities,
      result: authorizedResultRefSchema.parse({
        resultId:
          exportId === "result" ? digest(attempt) : digest([attempt, exportId]),
        producer: { ...attempt, exportId },
        snapshot: snapshot.ref,
        inputRevision: snapshot.inputRevision,
        dependencyFingerprint: digest(
          dependencies.map(({ result }) => result.resultId),
        ),
        sourceGeneration: null,
        kernelGeneration: null,
        provenance: "browser",
      }),
    });
    const build = buildFor("result");
    const received = await createKernelResult(
      claim,
      null,
      authorities,
      python,
      async (bytes, exportId) => {
        let table: ReturnType<typeof kernelArrowTable>;
        try {
          const reader = RecordBatchReader.from(bytes).open();
          if (reader.closed) invalidResult();
          table = kernelArrowTable(bytes);
          if (
            (!table.fields.length && table.table.numRows) ||
            table.table.numRows > MAX_RESULT_SEGMENTS * RESULT_SEGMENT_ROWS
          )
            invalidResult();
        } catch {
          return invalidResult();
        }
        const resultBuild = exportId === "result" ? build : buildFor(exportId);
        const lease = await store.renew(claim, undefined, {
          fingerprint,
          build: resultBuild,
        });
        if (lease.status !== "continue")
          throw new KernelAttemptError("browser_attempt_superseded");
        return stageKernelArrowResult(claim, resultBuild, table, (segment) =>
          store.recordSegment(claim, segment),
        );
      },
    );
    if (outcome === "complete" && events.some(({ type }) => type === "error"))
      invalidResult();
    for (const event of events) {
      if (event.type === "stream" || event.type === "error")
        await received.receive(event);
      else {
        const { type, contentType, data } = event;
        if (!python && contentType !== ARROW) invalidResult();
        try {
          await received.receive(
            { type, artifactId },
            { contentType, bytes: Buffer.from(data, "base64") },
          );
        } catch (error) {
          if (error instanceof SyntaxError || error instanceof z.ZodError)
            invalidResult();
          throw error;
        }
      }
    }
    await authorize();
    const { primary, promotion } = await received.finish(
      outcome === "complete",
    );
    if (outcome === "complete" && !python && !primary) invalidResult();
    const promoted = await store.finish(
      claim,
      outcome === "complete"
        ? {
            status: "result",
            artifact: primary ?? kernelResultArtifact(build, [], 0, false),
            expected: build.result,
          }
        : { status: "failed", code: "browser_execution_failed" },
      undefined,
      promotion,
    );
    return promoted ? saved : stale;
  } catch (error) {
    const superseded =
      error instanceof KernelAttemptError &&
      error.message === "browser_attempt_superseded";
    const storage =
      isPrivateBlobError(error) ||
      (isActionContractError(error) &&
        error.errorCode === "notebook_result_storage_unavailable");
    await store.finish(claim, {
      status: "failed",
      code: storage
        ? "notebook_result_storage_unavailable"
        : "browser_result_rejected",
      ...(storage ? { message: enUS.queryError.resultStorageUnavailable } : {}),
    });
    if (superseded) return stale;
    if (storage)
      fail(enUS.queryError.resultStorageUnavailable, {
        statusCode: 503,
        errorCode: "notebook_result_storage_unavailable",
      });
    if (error instanceof KernelAttemptError || error instanceof z.ZodError)
      invalidResult();
    throw error;
  }
}
