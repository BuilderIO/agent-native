import { fail } from "@agent-native/core/action";
import {
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { eq } from "drizzle-orm";
import { z } from "zod";

import enUS from "../../app/i18n/en-US.js";
import type { KernelEvent } from "../../shared/kernel-contract.js";
import {
  kernelOutputSchema,
  kernelVariableSchema,
  type KernelOutput,
} from "../../shared/notebook-kernel-output.js";
import {
  completeResultManifestSchema,
  type AuthorizedResultRef,
  type ResultField,
} from "../../shared/notebook-result-contract.js";
import { getDb } from "../db/index.js";
import { readKernelNamespace } from "../model/kernel-namespaces.js";
import type {
  Claim,
  KernelPromotion,
  ResultArtifact,
} from "../model/notebook-execution/run-store.js";
import {
  notebookRunAttempts,
  type ResultBuild,
  type SourceAuthority,
} from "../model/notebook-execution/schema.js";
import { notebookResultBlobPurpose } from "./local-notebook-blob.js";
import {
  RESULT_SEGMENT_ROWS,
  stageNotebookArrowSegment,
  type kernelArrowTable,
  type StagedSegment,
} from "./notebook-arrow.js";
import {
  kernelActor,
  KernelAttemptError,
  type KernelArtifact,
} from "./notebook-kernel.js";

const kernelJson = z.union([
  z.strictObject({
    kind: z.literal("variables"),
    variables: z.array(kernelVariableSchema).max(200),
    exports: z.array(z.string()).max(200),
  }),
  z.strictObject({
    kind: z.literal("export"),
    name: z.string().min(1).max(128),
  }),
  z.strictObject({
    "text/plain": z.string().max(262_144),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  }),
]);

const ARROW = "application/vnd.apache.arrow.stream";
export const persistedKernelOutputsSchema = z
  .array(kernelOutputSchema)
  .max(512);

export async function readKernelOutputs(output: PrivateBlobHandle | null) {
  if (!output) return [];
  const blob = await readPrivateBlob(output);
  return persistedKernelOutputsSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(blob.data)),
  );
}

export async function createKernelResult(
  claim: Claim,
  generation: string | null,
  authorities: SourceAuthority[],
  python: boolean,
  stage: (bytes: Uint8Array, exportId: string) => Promise<ResultArtifact>,
) {
  const presentation: KernelPromotion["presentation"] = {
    generation,
    output: null,
    authorities,
    exports: [],
  };
  const promotion: KernelPromotion = { presentation, artifacts: [] };
  const outputs: KernelOutput[] = [];
  const named = new Map<string, AuthorizedResultRef["resultId"]>();
  let nextExport: string | undefined;
  let primary: ResultArtifact | undefined;
  let metadata:
    | Extract<z.infer<typeof kernelJson>, { kind: "variables" }>
    | undefined;

  async function receive(
    event: KernelEvent["event"],
    artifact?: KernelArtifact,
  ) {
    if (generation === null && nextExport && artifact?.contentType !== ARROW)
      throw new KernelAttemptError("kernel_export_unreadable");
    if (event.type === "stream") {
      outputs.push({
        kind: "stream",
        channel: event.channel,
        text: event.text,
      });
    } else if (event.type === "error") {
      const { type: _type, reason: _reason, ...details } = event;
      outputs.push({ kind: "error", ...details });
    } else if (event.type === "display" || event.type === "result") {
      if (!artifact) throw new KernelAttemptError("kernel_artifact_missing");
      if (artifact.contentType === ARROW) {
        if (!python) {
          if (primary) throw new KernelAttemptError("kernel_duplicate_result");
          primary = await stage(artifact.bytes, "result");
          return;
        }
        const table = await stage(
          artifact.bytes,
          nextExport ? `symbol:${nextExport}` : `display:${outputs.length}`,
        );
        const id = table.manifest.result.resultId;
        promotion.artifacts.push(table);
        if (nextExport) {
          named.set(nextExport, id);
          nextExport = undefined;
        } else outputs.push({ kind: "table", resultId: id });
      } else if (artifact.contentType === "application/json") {
        const value = kernelJson.parse(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes),
          ),
        );
        if ("text/plain" in value)
          outputs.push({
            kind: "text",
            data: value["text/plain"],
            ...(value.value !== undefined ? { value: value.value } : {}),
          });
        else if (value.kind === "variables") {
          if (generation === null && metadata)
            throw new KernelAttemptError("kernel_export_unreadable");
          metadata = value;
        } else {
          if (generation === null && named.has(value.name))
            throw new KernelAttemptError("kernel_export_unreadable");
          nextExport = value.name;
        }
      } else throw new KernelAttemptError("kernel_artifact_unreadable");
    }
  }

  return {
    receive,
    async finish(success: boolean) {
      if (generation === null) {
        const names = new Set(metadata?.exports);
        const variables = new Map(
          metadata?.variables.map((variable) => [variable.name, variable]),
        );
        if (
          nextExport ||
          (metadata &&
            (names.size !== metadata.exports.length ||
              variables.size !== metadata.variables.length)) ||
          [...names].some(
            (name) =>
              !variables.has(name) ||
              (variables.get(name)?.kind === "dataframe") !== named.has(name),
          ) ||
          [...named.keys()].some((name) => !names.has(name))
        )
          throw new KernelAttemptError("kernel_export_unreadable");
      }
      if (outputs.length) {
        const data = Buffer.from(
          JSON.stringify(persistedKernelOutputsSchema.parse(outputs)),
        );
        const output = await putPrivateBlob({
          ownerEmail: claim.run.ownerEmail,
          key: `notebook-results/${claim.attempt.attemptId}/outputs`,
          mimeType: "application/json",
          metadata: { purpose: notebookResultBlobPurpose },
          data,
        });
        if (!output) {
          if (generation !== null)
            throw new KernelAttemptError("kernel_output_unreadable");
          fail(enUS.queryError.resultStorageUnavailable, {
            errorCode: "notebook_result_storage_unavailable",
            statusCode: 503,
          });
        }
        presentation.output = output;
      }
      if (success && metadata) {
        if (nextExport)
          throw new KernelAttemptError("kernel_export_unreadable");
        const prior =
          generation === null
            ? undefined
            : await readKernelNamespace(
                kernelActor(claim.run),
                claim.attempt.namespaceId,
              );
        const previous = new Map(
          prior?.variableState?.variables.map((variable) => [
            variable.name,
            variable,
          ]),
        );
        const names = new Set(metadata.exports);
        const variables = metadata.variables.map((variable) => {
          const producerCellId = names.has(variable.name)
            ? claim.attempt.cellId
            : previous.get(variable.name)?.producerCellId;
          return { ...variable, ...(producerCellId ? { producerCellId } : {}) };
        });
        presentation.exports = variables
          .filter(({ name }) => names.has(name))
          .map((variable) => {
            const resultId = named.get(variable.name);
            return { ...variable, ...(resultId ? { resultId } : {}) };
          });
        if (generation !== null)
          promotion.variables = {
            variables,
            authorities: [
              ...new Map(
                [
                  ...(prior?.variableState?.authorities ?? []),
                  ...authorities,
                ].map((authority) => [JSON.stringify(authority), authority]),
              ).values(),
            ],
          };
      }
      return { primary, promotion };
    },
  };
}

export function kernelResultArtifact(
  build: ResultBuild,
  fields: ResultField[],
  rowCount: number,
  tabular = true,
): ResultArtifact {
  return {
    manifest: completeResultManifestSchema.parse({
      result: build.result,
      status: rowCount === 0 ? "complete-empty" : "complete",
      rowCount: String(rowCount),
      fields,
    }),
    ...(tabular ? { artifactId: build.artifactId } : {}),
    artifacts: [],
    authorities: build.authorities,
    cacheKey: null,
    createdAt: Date.now(),
  };
}

export async function stageKernelArrowResult(
  { attempt, run, work }: Claim,
  build: ResultBuild,
  { table, fields }: ReturnType<typeof kernelArrowTable>,
  record: (segment: StagedSegment) => Promise<boolean>,
) {
  for (let start = 0; start < table.numRows; start += RESULT_SEGMENT_ROWS)
    await stageNotebookArrowSegment(
      {
        artifactId: build.artifactId,
        attemptId: attempt.attemptId,
        ownerEmail: run.ownerEmail,
        submissionId: work.submissionId,
        startRow: start,
        table: table.slice(start, start + RESULT_SEGMENT_ROWS),
        fields,
      },
      record,
    );
  return kernelResultArtifact(build, fields, table.numRows);
}

export async function readKernelExports(
  attemptId: Claim["attempt"]["attemptId"],
) {
  const [attempt] = await getDb()
    .select({ presentation: notebookRunAttempts.kernelPresentation })
    .from(notebookRunAttempts)
    .where(eq(notebookRunAttempts.id, attemptId))
    .limit(1);
  return attempt?.presentation?.exports ?? [];
}

export async function readKernelExport(
  attemptId: Claim["attempt"]["attemptId"],
  name: string,
  caseInsensitive: boolean,
) {
  const matches = (await readKernelExports(attemptId)).filter((variable) =>
    caseInsensitive
      ? variable.name.toLowerCase() === name.toLowerCase()
      : variable.name === name,
  );
  if (matches.length > 1) throw new KernelAttemptError("dataframe_ambiguous");
  return matches[0];
}
