import { randomUUID } from "node:crypto";

import {
  Table,
  tableFromIPC,
  tableToIPC,
  type RecordBatch,
} from "apache-arrow";
import { z } from "zod";

import {
  CONTRACT_VERSION,
  kernelCommandSchema,
} from "../../shared/kernel-contract.js";
import type { CompleteResultManifest } from "../../shared/notebook-result-contract.js";
import { workspaceIdSchema } from "../../shared/notebook-snapshot-contract.js";
import { getDb } from "../db/index.js";
import {
  advanceKernelGeneration,
  readKernelBinding,
  reserveKernelNamespace,
} from "../model/kernel-namespaces.js";
import { digest } from "../model/notebook-execution/planner.js";
import type { ExecutionActor } from "../model/notebook-execution/snapshot.js";
import {
  createKernelCommandSession,
  selectKernelHost,
} from "./kernel-client.js";
import { nameNotebookArrowColumns, notebookTable } from "./notebook-arrow.js";

const maxBytes = 32 * 1024 * 1024;
const payloadSchema = z.string();

export class VisualizationResultLimit extends Error {}

export async function joinVisualizationArrow(
  manifest: CompleteResultManifest,
  chunks: AsyncIterable<Uint8Array>,
) {
  let size = 0;
  let rows = 0;
  let schema: Table["schema"] | undefined;
  const batches: RecordBatch[] = [];
  for await (const bytes of chunks) {
    size += bytes.byteLength;
    if (size > maxBytes) throw new VisualizationResultLimit();
    const table = tableFromIPC(bytes);
    schema = table.schema;
    rows += table.numRows;
    batches.push(...table.batches);
  }
  if (String(rows) !== manifest.rowCount)
    throw new Error("Visualization source coverage changed");
  const fields = manifest.fields.map((field, index) => ({
    ...field,
    name: String(index),
  }));
  return tableToIPC(
    schema
      ? nameNotebookArrowColumns(new Table(schema, batches), fields)
      : notebookTable({ columns: [], rows: [] }, fields),
  );
}

export async function executeVisualizationSql({
  actor,
  manifest,
  versionId,
  released,
  source,
  readInput,
  authorize,
}: {
  actor: ExecutionActor;
  manifest: CompleteResultManifest;
  versionId: string;
  released: boolean;
  source: string;
  readInput: () => AsyncIterable<Uint8Array>;
  authorize: () => Promise<boolean>;
}): Promise<unknown[]> {
  const projectId = manifest.result.snapshot.projectId;
  const principal = {
    workspaceId: workspaceIdSchema.parse(actor.orgId),
    principalId: actor.ownerEmail,
    email: actor.ownerEmail,
  };
  const scopeId = digest(["visualization", versionId]);
  const namespaceId = digest([
    actor.orgId,
    actor.ownerEmail,
    projectId,
    scopeId,
  ]);
  const host = await selectKernelHost();
  if (!(await authorize())) throw new Error("Visualization source changed");
  let reservation = await reserveKernelNamespace(
    {
      id: namespaceId,
      lineageId: randomUUID(),
      orgId: actor.orgId,
      projectId,
      principalId: principal.principalId,
      scopeId,
      scopeKind: released ? "release-default" : "draft",
    },
    host,
    new Date(),
    getDb(),
  );
  async function advance() {
    const updated = await advanceKernelGeneration(
      reservation,
      { host, status: "reserved", lineageId: randomUUID() },
      new Date(),
      getDb(),
    );
    if (!updated) throw new Error("Visualization kernel reservation changed");
    reservation = updated;
  }
  if (
    reservation.hostId !== host.hostId ||
    reservation.status === "expired" ||
    reservation.status === "stopped"
  )
    await advance();

  async function open() {
    const envelope = {
      protocolVersion: CONTRACT_VERSION,
      namespaceId: reservation.id,
      generation: String(reservation.generation),
      runId: randomUUID(),
      attemptId: randomUUID(),
      resumeCursor: null,
    };
    if (
      !(await readKernelBinding(principal, reservation.id, envelope.generation))
    )
      throw new Error("Visualization kernel generation changed");
    const command = kernelCommandSchema.parse({
      ...envelope,
      commandId: randomUUID(),
      command: { operation: "open" },
    });
    const receipt = await createKernelCommandSession(
      principal,
      command,
      authorize,
    ).submit();
    return { envelope, status: receipt.acknowledgement.status };
  }
  let opened = await open();
  if (opened.status === "stale") {
    await advance();
    opened = await open();
  }
  if (opened.status !== "accepted")
    throw new Error("Visualization kernel did not open");
  const command = kernelCommandSchema.parse({
    ...opened.envelope,
    commandId: randomUUID(),
    command: {
      operation: "execute-dataframe-sql",
      source,
      inputs: [{ name: "input", manifest }],
      params: [],
    },
  });
  const session = createKernelCommandSession(principal, command, authorize);
  const receipt = await session.submit(() =>
    joinVisualizationArrow(manifest, readInput()),
  );
  if (receipt.acknowledgement.status !== "accepted")
    throw new Error("Visualization kernel did not accept the transform");
  let artifact: Uint8Array | undefined;
  for await (const event of session.events(null)) {
    if (event.event.type === "result") {
      const value = await session.readArtifact(event);
      if (
        value.contentType !== "application/vnd.apache.arrow.stream" ||
        artifact
      )
        throw new Error("Visualization kernel returned an unexpected artifact");
      artifact = value.bytes;
    }
    if (event.event.type === "terminal") {
      if (event.event.outcome.status !== "complete" || !artifact)
        throw new Error("Visualization did not finish");
      return decodeVisualizationPayload(artifact);
    }
  }
  throw new Error("Visualization kernel ended before reporting an outcome");
}

export function decodeVisualizationPayload(artifact: Uint8Array): unknown[] {
  const table = tableFromIPC(artifact);
  const data = table.getChild("payload");
  if (!data || table.numCols !== 1)
    throw new Error("Visualization artifact is unreadable");
  return Array.from(data, (value) => JSON.parse(payloadSchema.parse(value)));
}
