import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { AnalyticsAdminContext } from "./db-admin-connections.js";
import { withFeatureFlagMutationLock } from "./feature-flag-mutation-lock.js";
import {
  getWorkspaceFlagTarget,
  setWorkspaceFeatureFlag,
} from "./workspace-feature-flags.js";

export type ProductExperimentStatus =
  | "draft"
  | "running"
  | "paused"
  | "completed"
  | "interrupted";
export interface ProductExperimentInput {
  name: string;
  hypothesis?: string;
  appId: string;
  flagKey: string;
  primaryEventName: string;
  treatmentPercentage?: number;
}

function now() {
  return new Date().toISOString();
}
function parseProperties(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function canonicalUserKey(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}
function pct(value: number, total: number) {
  return total === 0 ? 0 : value / total;
}

export function trackingAppIds(directoryAppId: string): string[] {
  const normalized = directoryAppId.trim();
  if (!normalized) return [];
  const prefixed = normalized.startsWith("agent-native-")
    ? normalized
    : `agent-native-${normalized}`;
  return [...new Set([normalized, prefixed])];
}

export async function listProductExperiments(admin: AnalyticsAdminContext) {
  return getDb()
    .select()
    .from(schema.productExperiments)
    .where(eq(schema.productExperiments.orgId, admin.orgId))
    .orderBy(desc(schema.productExperiments.updatedAt))
    .limit(100);
}

export async function getProductExperiment(
  admin: AnalyticsAdminContext,
  id: string,
) {
  const [experiment] = await getDb()
    .select()
    .from(schema.productExperiments)
    .where(
      and(
        eq(schema.productExperiments.id, id),
        eq(schema.productExperiments.orgId, admin.orgId),
      ),
    )
    .limit(1);
  if (!experiment) throw new Error("Product experiment not found.");
  return {
    ...experiment,
    results: await calculateProductExperimentResults(experiment),
  };
}

async function assertNoRunningExperiment(
  admin: AnalyticsAdminContext,
  appId: string,
  flagKey: string,
  exceptId?: string,
) {
  const rows = await getDb()
    .select({ id: schema.productExperiments.id })
    .from(schema.productExperiments)
    .where(
      and(
        eq(schema.productExperiments.orgId, admin.orgId),
        eq(schema.productExperiments.appId, appId),
        eq(schema.productExperiments.flagKey, flagKey),
        eq(schema.productExperiments.status, "running"),
      ),
    )
    .limit(2);
  if (rows.some((row) => row.id !== exceptId))
    throw new Error(
      "Another running experiment already owns this app and feature flag.",
    );
}

export async function createProductExperiment(
  admin: AnalyticsAdminContext,
  input: ProductExperimentInput,
) {
  const target = await getWorkspaceFlagTarget(admin, input.appId);
  if (target.state !== "ready")
    throw new Error(
      "The target app and flag definitions must be ready before creating an experiment.",
    );
  if (!target.flags.some((flag) => flag.key === input.flagKey))
    throw new Error("The target flag is not registered by the selected app.");
  const id = randomUUID();
  const timestamp = now();
  await getDb()
    .insert(schema.productExperiments)
    .values({
      id,
      name: input.name,
      hypothesis: input.hypothesis ?? "",
      appId: target.appId,
      appOrigin: target.appOrigin,
      flagKey: input.flagKey,
      primaryEventName: input.primaryEventName,
      treatmentPercentage: input.treatmentPercentage ?? 50,
      status: "draft",
      createdBy: admin.userEmail,
      updatedBy: admin.userEmail,
      createdAt: timestamp,
      updatedAt: timestamp,
      ownerEmail: admin.userEmail,
      orgId: admin.orgId,
    });
  return getProductExperiment(admin, id);
}

export async function startProductExperiment(
  admin: AnalyticsAdminContext,
  id: string,
) {
  const current = await getProductExperiment(admin, id);
  if (current.status !== "draft" && current.status !== "paused")
    throw new Error("Only draft or paused experiments can start.");
  await assertNoRunningExperiment(
    admin,
    current.appId,
    current.flagKey,
    current.id,
  );
  return withFeatureFlagMutationLock(
    admin,
    { appId: current.appId, flagKey: current.flagKey, operationId: current.id },
    async () => {
      const latest = await getProductExperiment(admin, id);
      if (latest.status !== "draft" && latest.status !== "paused")
        throw new Error("Only draft or paused experiments can start.");
      // Close the window between the optimistic pre-check and the durable lock.
      await assertNoRunningExperiment(
        admin,
        latest.appId,
        latest.flagKey,
        latest.id,
      );
      const target = await getWorkspaceFlagTarget(admin, latest.appId);
      if (
        target.state !== "ready" ||
        !target.flags.some((flag) => flag.key === latest.flagKey)
      )
        throw new Error("Target app or flag is no longer ready.");
      const rolloutEpoch = randomUUID();
      // The remote assignment is deliberately first: Analytics must never claim a running experiment before rollout is live.
      await setWorkspaceFeatureFlag(admin, {
        appId: latest.appId,
        key: latest.flagKey,
        operation: "replace-rules",
        rules: {
          mode: "rules",
          percentage: latest.treatmentPercentage,
          rolloutEpoch,
        },
      });
      const timestamp = now();
      try {
        await getDb()
          .update(schema.productExperiments)
          .set({
            status: "running",
            rolloutEpoch,
            startedAt: timestamp,
            endedAt: null,
            interruptionReason: null,
            updatedAt: timestamp,
            updatedBy: admin.userEmail,
          })
          .where(
            and(
              eq(schema.productExperiments.id, id),
              eq(schema.productExperiments.orgId, admin.orgId),
            ),
          );
      } catch (error) {
        try {
          await setWorkspaceFeatureFlag(admin, {
            appId: latest.appId,
            key: latest.flagKey,
            operation: "off",
          });
        } catch (compensationError) {
          void compensationError;
          throw new Error(
            "The target rollout started, Analytics could not persist it, and the compensating emergency-off also failed. Manual reconciliation is required.",
          );
        }
        void error;
        throw new Error(
          "Analytics could not persist the running experiment; the target rollout was turned off again.",
        );
      }
      return getProductExperiment(admin, id);
    },
  );
}

async function stopTargetThenPersist(
  admin: AnalyticsAdminContext,
  id: string,
  status: "paused" | "interrupted",
  reason?: string,
) {
  const current = await getProductExperiment(admin, id);
  if (current.status !== "running") return current;
  return withFeatureFlagMutationLock(
    admin,
    { appId: current.appId, flagKey: current.flagKey, operationId: current.id },
    async () => {
      const latest = await getProductExperiment(admin, id);
      if (latest.status !== "running") return latest;
      await setWorkspaceFeatureFlag(admin, {
        appId: latest.appId,
        key: latest.flagKey,
        operation: "off",
      });
      const timestamp = now();
      await getDb()
        .update(schema.productExperiments)
        .set({
          status,
          endedAt: timestamp,
          interruptionReason: reason ?? null,
          updatedAt: timestamp,
          updatedBy: admin.userEmail,
        })
        .where(
          and(
            eq(schema.productExperiments.id, id),
            eq(schema.productExperiments.orgId, admin.orgId),
            eq(schema.productExperiments.status, "running"),
          ),
        );
      return getProductExperiment(admin, id);
    },
  );
}

export async function completeProductExperiment(
  admin: AnalyticsAdminContext,
  id: string,
) {
  const current = await getProductExperiment(admin, id);
  if (current.status !== "running" && current.status !== "paused")
    throw new Error("Only running or paused experiments can complete.");
  return withFeatureFlagMutationLock(
    admin,
    { appId: current.appId, flagKey: current.flagKey, operationId: current.id },
    async () => {
      const latest = await getProductExperiment(admin, id);
      if (latest.status !== "running" && latest.status !== "paused")
        throw new Error("Only running or paused experiments can complete.");
      const timestamp = now();
      await getDb()
        .update(schema.productExperiments)
        .set({
          status: "completed",
          endedAt: latest.endedAt ?? timestamp,
          updatedAt: timestamp,
          updatedBy: admin.userEmail,
        })
        .where(
          and(
            eq(schema.productExperiments.id, id),
            eq(schema.productExperiments.orgId, admin.orgId),
            eq(schema.productExperiments.status, latest.status),
          ),
        );
      return getProductExperiment(admin, id);
    },
  );
}

export async function reconcileProductExperiment(
  admin: AnalyticsAdminContext,
  id: string,
) {
  const current = await getProductExperiment(admin, id);
  if (current.status !== "running") return current;
  try {
    const target = await getWorkspaceFlagTarget(admin, current.appId);
    const flag = target.flags.find(
      (candidate) => candidate.key === current.flagKey,
    );
    if (
      target.state === "unreachable" ||
      target.state === "forbidden" ||
      target.state === "unknown-legacy"
    )
      return { ...current, reconciliation: "pending" as const };
    if (target.state !== "ready" || !flag) {
      const timestamp = now();
      await getDb()
        .update(schema.productExperiments)
        .set({
          status: "interrupted",
          endedAt: timestamp,
          interruptionReason: "Target app or flag is unavailable.",
          reconciledAt: timestamp,
          updatedAt: timestamp,
          updatedBy: admin.userEmail,
        })
        .where(
          and(
            eq(schema.productExperiments.id, id),
            eq(schema.productExperiments.orgId, admin.orgId),
          ),
        );
      return getProductExperiment(admin, id);
    }
    const rules = flag.rules as Record<string, unknown> | undefined;
    if (
      typeof current.rolloutEpoch !== "string" ||
      !current.rolloutEpoch.trim() ||
      rules?.mode !== "rules" ||
      !Array.isArray(rules.emails) ||
      rules.emails.length !== 0 ||
      !Array.isArray(rules.orgIds) ||
      rules.orgIds.length !== 0 ||
      rules?.percentage !== current.treatmentPercentage ||
      rules?.rolloutEpoch !== current.rolloutEpoch
    ) {
      const timestamp = now();
      await getDb()
        .update(schema.productExperiments)
        .set({
          status: "interrupted",
          endedAt: timestamp,
          interruptionReason:
            "Target rollout drifted from the experiment snapshot.",
          reconciledAt: timestamp,
          updatedAt: timestamp,
          updatedBy: admin.userEmail,
        })
        .where(
          and(
            eq(schema.productExperiments.id, id),
            eq(schema.productExperiments.orgId, admin.orgId),
          ),
        );
      return getProductExperiment(admin, id);
    }
    await getDb()
      .update(schema.productExperiments)
      .set({
        reconciledAt: now(),
        updatedAt: now(),
        updatedBy: admin.userEmail,
      })
      .where(eq(schema.productExperiments.id, id));
    return getProductExperiment(admin, id);
  } catch {
    return { ...current, reconciliation: "pending" as const };
  }
}

export async function calculateProductExperimentResults(
  experiment: typeof schema.productExperiments.$inferSelect,
) {
  if (!experiment.rolloutEpoch || !experiment.startedAt)
    return {
      control: { exposed: 0, conversions: 0, rate: 0 },
      treatment: { exposed: 0, conversions: 0, rate: 0 },
      lift: 0,
      validityWarning: "Experiment has not started.",
    };
  const end = experiment.endedAt ?? now();
  const rows = await getDb()
    .select({
      userKey: schema.analyticsEvents.userKey,
      eventName: schema.analyticsEvents.eventName,
      timestamp: schema.analyticsEvents.timestamp,
      properties: schema.analyticsEvents.properties,
    })
    .from(schema.analyticsEvents)
    .where(
      and(
        eq(schema.analyticsEvents.orgId, experiment.orgId),
        inArray(schema.analyticsEvents.app, trackingAppIds(experiment.appId)),
        gte(schema.analyticsEvents.timestamp, experiment.startedAt),
        lte(schema.analyticsEvents.timestamp, end),
      ),
    )
    .orderBy(schema.analyticsEvents.timestamp)
    .limit(20_001);
  const truncated = rows.length > 20_000;
  return reduceProductExperimentEvents(
    experiment,
    rows.slice(0, 20_000),
    truncated,
  );
}

export function reduceProductExperimentEvents(
  experiment: Pick<
    typeof schema.productExperiments.$inferSelect,
    "flagKey" | "rolloutEpoch" | "treatmentPercentage" | "primaryEventName"
  >,
  rows: Array<{
    userKey: string | null;
    eventName: string;
    timestamp: string;
    properties: string;
  }>,
  truncated = false,
) {
  const exposures = new Map<
    string,
    { cohort: "control" | "treatment"; timestamp: string }
  >();
  const contaminated = new Set<string>();
  const outcomes = new Set<string>();
  for (const row of rows) {
    const user = canonicalUserKey(row.userKey);
    if (!user) continue;
    const properties = parseProperties(row.properties);
    if (
      row.eventName === "$feature_flag_exposure" &&
      properties.flag_key === experiment.flagKey
    ) {
      const reason = properties.reason;
      const epoch = properties.rollout_epoch;
      const percentage = properties.rollout_percentage;
      const bucket = properties.bucket;
      const value = properties.value;
      const exposureUserKey = canonicalUserKey(
        typeof properties.user_key === "string" ? properties.user_key : null,
      );
      const cohort =
        reason === "percentage-control"
          ? "control"
          : reason === "percentage-treatment"
            ? "treatment"
            : null;
      const valid =
        cohort &&
        epoch === experiment.rolloutEpoch &&
        percentage === experiment.treatmentPercentage &&
        typeof bucket === "number" &&
        Number.isInteger(bucket) &&
        bucket >= 0 &&
        bucket <= 99 &&
        typeof value === "boolean" &&
        (cohort === "treatment") === value &&
        (cohort === "treatment"
          ? bucket < experiment.treatmentPercentage
          : bucket >= experiment.treatmentPercentage) &&
        exposureUserKey === user;
      if (!valid) {
        contaminated.add(user);
        continue;
      }
      const previous = exposures.get(user);
      if (!previous)
        exposures.set(user, {
          cohort,
          timestamp: row.timestamp,
        });
      else if (previous.cohort !== cohort) contaminated.add(user);
    }
  }
  for (const row of rows) {
    if (row.eventName !== experiment.primaryEventName) continue;
    const user = canonicalUserKey(row.userKey);
    const exposure = user ? exposures.get(user) : null;
    if (
      user &&
      exposure &&
      !contaminated.has(user) &&
      row.timestamp > exposure.timestamp
    )
      outcomes.add(user);
  }
  const eligible = [...exposures.entries()].filter(
    ([user]) => !contaminated.has(user),
  );
  const controlUsers = eligible
    .filter(([, exposure]) => exposure.cohort === "control")
    .map(([user]) => user);
  const treatmentUsers = eligible
    .filter(([, exposure]) => exposure.cohort === "treatment")
    .map(([user]) => user);
  const controlConversions = controlUsers.filter((user) =>
    outcomes.has(user),
  ).length;
  const treatmentConversions = treatmentUsers.filter((user) =>
    outcomes.has(user),
  ).length;
  const controlRate = pct(controlConversions, controlUsers.length);
  const treatmentRate = pct(treatmentConversions, treatmentUsers.length);
  const expectedTreatment =
    (eligible.length * experiment.treatmentPercentage) / 100;
  const expectedControl = eligible.length - expectedTreatment;
  const chi =
    expectedTreatment > 0 && expectedControl > 0
      ? (treatmentUsers.length - expectedTreatment) ** 2 / expectedTreatment +
        (controlUsers.length - expectedControl) ** 2 / expectedControl
      : 0;
  const warnings = [
    chi > 10.828
      ? "Sample-ratio mismatch detected (chi-square p < 0.001); do not treat lift as reliable."
      : null,
    truncated
      ? "Result window was truncated at 20,000 events; coverage is incomplete."
      : null,
  ].filter((warning): warning is string => Boolean(warning));
  return {
    control: {
      exposed: controlUsers.length,
      conversions: controlConversions,
      rate: controlRate,
    },
    treatment: {
      exposed: treatmentUsers.length,
      conversions: treatmentConversions,
      rate: treatmentRate,
    },
    lift: treatmentRate - controlRate,
    sampleSize: eligible.length,
    validityWarning: warnings.join(" ") || null,
    truncated,
    coverage: truncated ? "partial" : "complete",
  };
}

export async function manageProductExperiment(
  admin: AnalyticsAdminContext,
  input: {
    operation: string;
    id?: string;
    experiment?: Partial<ProductExperimentInput>;
  },
) {
  if (
    input.operation === "create" &&
    input.experiment?.name &&
    input.experiment.appId &&
    input.experiment.flagKey &&
    input.experiment.primaryEventName
  )
    return createProductExperiment(
      admin,
      input.experiment as ProductExperimentInput,
    );
  if (!input.id)
    throw new Error("An experiment id is required for this operation.");
  if (input.operation === "update" && input.experiment) {
    const current = await getProductExperiment(admin, input.id);
    if (current.status !== "draft")
      throw new Error("Only draft experiments can change their definition.");
    return withFeatureFlagMutationLock(
      admin,
      {
        appId: current.appId,
        flagKey: current.flagKey,
        operationId: current.id,
      },
      async () => {
        const latest = await getProductExperiment(admin, input.id!);
        if (latest.status !== "draft")
          throw new Error(
            "Only draft experiments can change their definition.",
          );
        const timestamp = now();
        const updated = await getDb()
          .update(schema.productExperiments)
          .set({
            ...(input.experiment!.name ? { name: input.experiment!.name } : {}),
            ...(input.experiment!.hypothesis !== undefined
              ? { hypothesis: input.experiment!.hypothesis }
              : {}),
            ...(input.experiment!.primaryEventName
              ? { primaryEventName: input.experiment!.primaryEventName }
              : {}),
            ...(input.experiment!.treatmentPercentage
              ? { treatmentPercentage: input.experiment!.treatmentPercentage }
              : {}),
            updatedAt: timestamp,
            updatedBy: admin.userEmail,
          })
          .where(
            and(
              eq(schema.productExperiments.id, input.id!),
              eq(schema.productExperiments.orgId, admin.orgId),
              eq(schema.productExperiments.status, "draft"),
            ),
          )
          .returning({ id: schema.productExperiments.id });
        if (updated.length !== 1)
          throw new Error(
            "The experiment started changing before the draft update could commit.",
          );
        return getProductExperiment(admin, input.id!);
      },
    );
  }
  if (input.operation === "start")
    return startProductExperiment(admin, input.id);
  if (input.operation === "pause")
    return stopTargetThenPersist(admin, input.id, "paused");
  if (input.operation === "emergency-off")
    return stopTargetThenPersist(
      admin,
      input.id,
      "interrupted",
      "Emergency off requested.",
    );
  if (input.operation === "complete")
    return completeProductExperiment(admin, input.id);
  if (input.operation === "reconcile")
    return reconcileProductExperiment(admin, input.id);
  throw new Error("Unsupported product experiment operation.");
}
