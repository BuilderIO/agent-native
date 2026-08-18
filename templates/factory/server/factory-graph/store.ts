import { and, count, desc, eq, type SQL } from "drizzle-orm";

import { getDb } from "../db/index.js";
import {
  factoryDefinitions,
  triageDecisions,
  triageItems,
  triageRuns,
} from "../db/schema.js";
import {
  defaultFactoryGraph,
  normalizeFactoryGraph,
  type FactoryGraph,
} from "./contracts.js";

export const DEFAULT_FACTORY_ID = "product-feedback";

export interface FactoryMetricSummary {
  totalItems: number;
  slackItems: number;
  githubItems: number;
  decisions: number;
  manualItems: number;
  runs: number;
  completedRuns: number;
}

export function parseFactoryGraph(value: string): FactoryGraph {
  try {
    return normalizeFactoryGraph(JSON.parse(value));
  } catch (error) {
    throw new Error(
      `Factory graph is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function listFactoryDefinitions(orgId: string) {
  return getDb()
    .select({
      id: factoryDefinitions.id,
      name: factoryDefinitions.name,
      description: factoryDefinitions.description,
      prompt: factoryDefinitions.prompt,
      graphVersion: factoryDefinitions.graphVersion,
      updatedAt: factoryDefinitions.updatedAt,
    })
    .from(factoryDefinitions)
    .where(eq(factoryDefinitions.orgId, orgId))
    .orderBy(desc(factoryDefinitions.updatedAt));
}

export async function readFactoryDefinition(orgId: string, factoryId: string) {
  return (
    await getDb()
      .select()
      .from(factoryDefinitions)
      .where(eq(factoryDefinitions.id, factoryId))
      .limit(1)
  ).find((row) => row.orgId === orgId);
}

export async function readFactoryMetrics(
  orgId: string,
): Promise<FactoryMetricSummary> {
  const db = getDb();
  const [
    totalItems,
    slackItems,
    githubItems,
    decisions,
    manualItems,
    runs,
    completedRuns,
  ] = await Promise.all([
    countRows(triageItems, orgId),
    countRows(triageItems, orgId, eq(triageItems.source, "slack")),
    countRows(triageItems, orgId, eq(triageItems.source, "github")),
    countRows(triageDecisions, orgId),
    countRows(triageItems, orgId, eq(triageItems.status, "needs_manual")),
    countRows(triageRuns, orgId),
    countRows(triageRuns, orgId, eq(triageRuns.status, "completed")),
  ]);

  return {
    totalItems,
    slackItems,
    githubItems,
    decisions,
    manualItems,
    runs,
    completedRuns,
  };
}

async function countRows(
  table: typeof triageItems | typeof triageDecisions | typeof triageRuns,
  orgId: string,
  extra?: SQL,
) {
  const where = extra
    ? and(eq(table.orgId, orgId), extra)
    : eq(table.orgId, orgId);
  const row = (
    await getDb().select({ value: count() }).from(table).where(where)
  )[0];
  return Number(row?.value ?? 0);
}

export function defaultFactoryDefinition() {
  return {
    id: DEFAULT_FACTORY_ID,
    name: "Product feedback to shipped change",
    description: defaultFactoryGraph().description,
    prompt:
      "Observe product feedback and pull-request evidence, classify it in shadow mode, and keep a person in the loop before coding work starts.",
    graphVersion: 1,
    graph: defaultFactoryGraph(),
    virtual: true,
  } as const;
}
