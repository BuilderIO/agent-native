import { and, eq, inArray } from "drizzle-orm";

import {
  factoryWorkflowRuns,
  factoryWorkflowVersions,
  factoryWorkflows,
  triageItems,
} from "../../db/schema.js";
import {
  WorkflowStoreError,
  type WorkflowScope,
} from "../../workflow/adapter.js";
import type { NodeKind, WorkflowGraph } from "../../workflow/contract.js";
import { readGraph } from "../../workflow/store-rules.js";
import {
  WorkflowReadError,
  scopeOf,
  type ReadDatabase,
  type RunRow,
} from "./shared.js";

const runs = factoryWorkflowRuns;
const inbox = triageItems;

export interface NodeInfo {
  name: string;
  kind: NodeKind;
}

export interface WorkflowInfo {
  id: string;
  name: string;
  version: number;
  nodes: Map<string, NodeInfo>;
}

export function nodeIndexOf(graph: WorkflowGraph): Map<string, NodeInfo> {
  return new Map(
    graph.nodes.map((node) => [node.id, { name: node.name, kind: node.kind }]),
  );
}

export async function requireWorkflowRow(
  db: ReadDatabase,
  scope: WorkflowScope,
  workflowId: string,
) {
  const row = (
    await db
      .select({
        id: factoryWorkflows.id,
        name: factoryWorkflows.name,
        version: factoryWorkflows.version,
      })
      .from(factoryWorkflows)
      .where(
        and(
          eq(factoryWorkflows.id, workflowId),
          scopeOf(factoryWorkflows, scope),
        ),
      )
      .limit(1)
  )[0];
  if (!row) {
    throw new WorkflowReadError(
      "workflow_not_found",
      `Workflow "${workflowId}" was not found in this factory.`,
      { workflowId },
    );
  }
  return row;
}

export async function readVersionGraph(
  db: ReadDatabase,
  scope: WorkflowScope,
  workflowId: string,
  version: number,
): Promise<WorkflowGraph> {
  const row = (
    await db
      .select({ graphJson: factoryWorkflowVersions.graphJson })
      .from(factoryWorkflowVersions)
      .where(
        and(
          eq(factoryWorkflowVersions.workflowId, workflowId),
          eq(factoryWorkflowVersions.version, version),
          scopeOf(factoryWorkflowVersions, scope),
        ),
      )
      .limit(1)
  )[0];
  if (!row) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `factory_workflow_versions has no row for workflow "${workflowId}" version ${version}.`,
      { workflowId, version },
    );
  }
  return readGraph(
    row.graphJson,
    `factory_workflow_versions (workflow "${workflowId}", version ${version}) graph_json`,
  );
}

/** Name, version, and current-graph node names of each workflow, for the ids a page names. */
export async function workflowInfos(
  db: ReadDatabase,
  scope: WorkflowScope,
  ids: readonly string[],
): Promise<Map<string, WorkflowInfo>> {
  const unique = [...new Set(ids)];
  const infos = new Map<string, WorkflowInfo>();
  if (unique.length === 0) return infos;
  const rows = await db
    .select({
      id: factoryWorkflows.id,
      name: factoryWorkflows.name,
      version: factoryWorkflows.version,
      graphJson: factoryWorkflowVersions.graphJson,
    })
    .from(factoryWorkflows)
    .leftJoin(
      factoryWorkflowVersions,
      and(
        eq(factoryWorkflowVersions.workflowId, factoryWorkflows.id),
        eq(factoryWorkflowVersions.version, factoryWorkflows.version),
        scopeOf(factoryWorkflowVersions, scope),
      ),
    )
    .where(
      and(
        scopeOf(factoryWorkflows, scope),
        inArray(factoryWorkflows.id, unique),
      ),
    )
    .limit(unique.length);
  for (const row of rows) {
    if (row.graphJson === null) {
      throw new WorkflowStoreError(
        "corrupt_record",
        `factory_workflow_versions has no row for workflow "${row.id}" version ${row.version}.`,
        { workflowId: row.id, version: row.version },
      );
    }
    const graph = readGraph(
      row.graphJson,
      `factory_workflow_versions (workflow "${row.id}", version ${row.version}) graph_json`,
    );
    infos.set(row.id, {
      id: row.id,
      name: row.name,
      version: row.version,
      nodes: nodeIndexOf(graph),
    });
  }
  return infos;
}

export async function namesOf(
  db: ReadDatabase,
  scope: WorkflowScope,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: factoryWorkflows.id, name: factoryWorkflows.name })
    .from(factoryWorkflows)
    .where(
      and(
        scopeOf(factoryWorkflows, scope),
        inArray(factoryWorkflows.id, unique),
      ),
    )
    .limit(unique.length);
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function runInScope(
  db: ReadDatabase,
  scope: WorkflowScope,
  runId: string,
): Promise<RunRow | undefined> {
  return (
    await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), scopeOf(runs, scope)))
      .limit(1)
  )[0];
}

export async function inboxRows(
  db: ReadDatabase,
  scope: WorkflowScope,
  ids: readonly string[],
) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map<
      string,
      {
        title: string;
        source: string;
        sourceUrl: string | null;
        status: string;
      }
    >();
  }
  const rows = await db
    .select({
      id: inbox.id,
      title: inbox.title,
      source: inbox.source,
      sourceUrl: inbox.sourceUrl,
      status: inbox.status,
    })
    .from(inbox)
    .where(
      and(
        eq(inbox.orgId, scope.orgId),
        eq(inbox.factoryId, scope.factoryId),
        inArray(inbox.id, unique),
      ),
    )
    .limit(unique.length);
  return new Map(rows.map((row) => [row.id, row]));
}
