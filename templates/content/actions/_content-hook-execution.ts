import {
  notifyPersonalWithDelivery,
  notifyWithDelivery,
} from "@agent-native/core/notifications";
import { runWithRequestContext } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import type {
  ClaimedWorkflowExecution,
  ClaimedScheduledWork,
  WorkflowEvent,
  WorkflowSubscription,
} from "@agent-native/core/workflow";
import {
  claimWorkflowEffectRetry,
  finalizeWorkflowEffect,
  getWorkflowSubscription,
  recordWorkflowEffect,
  scheduleWorkflowWork,
} from "@agent-native/core/workflow";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  contentHookHasCurrentAuthority,
  contentHookConfigFromJson,
  type ContentHookConditions,
  type ContentHookConfig,
  type ContentDatabaseHook,
} from "./_content-database-hooks.js";
import { resolveContentNotificationPreference } from "./_content-notification-preferences.js";
import { runWithContentWorkflowCausality } from "./_content-workflow.js";
import { setDocumentPropertyValue } from "./set-document-property.js";

const MAX_CONTENT_HOOK_CHAIN_DEPTH = 8;

function assertNever(value: never): never {
  throw new Error(`Unsupported Content hook effect: ${JSON.stringify(value)}`);
}

function propertyValuesFromEvent(event: WorkflowEvent) {
  const value = event.payload.propertyValues;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function isEmptyConditionValue(value: unknown) {
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function contentHookConditionsMatch(
  propertyValues: Record<string, unknown>,
  conditions?: ContentHookConditions,
) {
  if (!conditions) return true;
  const matches = conditions.clauses.map((condition) => {
    const current = propertyValues[condition.propertyId];
    switch (condition.operator) {
      case "equals":
        return stableJson(current) === stableJson(condition.value);
      case "not_equals":
        return stableJson(current) !== stableJson(condition.value);
      case "contains":
        return typeof current === "string" &&
          typeof condition.value === "string"
          ? current.includes(condition.value)
          : Array.isArray(current)
            ? current.some(
                (entry) => stableJson(entry) === stableJson(condition.value),
              )
            : false;
      case "is_empty":
        return isEmptyConditionValue(current);
      case "is_not_empty":
        return !isEmptyConditionValue(current);
      default:
        return assertNever(condition);
    }
  });
  return conditions.mode === "all"
    ? matches.every(Boolean)
    : matches.some(Boolean);
}

export function matchesContentDatabaseHook(
  event: WorkflowEvent,
  hook: Pick<ContentDatabaseHook, "databaseId" | "trigger" | "conditions">,
) {
  if (event.payload.databaseId !== hook.databaseId) return false;
  if (
    !contentHookConditionsMatch(propertyValuesFromEvent(event), hook.conditions)
  ) {
    return false;
  }
  if (hook.trigger.kind === "item_created") {
    return event.topic === "content.database.item.created";
  }
  if (hook.trigger.kind === "item_submitted") {
    return event.topic === "content.database.item.submitted";
  }
  if (hook.trigger.kind === "builder_publication_confirmed") {
    return (
      event.topic === "content.builder.publication.confirmed" &&
      (hook.trigger.publicationAction == null ||
        event.payload.effect === hook.trigger.publicationAction)
    );
  }
  if (event.topic !== "content.database.property.changed") return false;
  if (event.payload.propertyId !== hook.trigger.propertyId) return false;
  if (
    hook.trigger.fromOptionId !== undefined &&
    hook.trigger.fromOptionId !== event.payload.beforeValue
  ) {
    return false;
  }
  if (
    hook.trigger.toOptionId !== undefined &&
    hook.trigger.toOptionId !== event.payload.afterValue
  ) {
    return false;
  }
  return true;
}

export function prepareContentNotificationEffect(args: {
  event: WorkflowEvent;
  subscription: WorkflowSubscription;
}) {
  const config = contentHookConfigFromJson(
    JSON.stringify(args.subscription.config),
  );
  if (!config) return null;
  if ("system" in config) {
    if (args.event.payload.databaseId !== config.databaseId) return null;
    let recipients: string[] = [];
    if (
      args.event.topic === "content.database.property.changed" &&
      args.event.payload.propertyType === "person"
    ) {
      const before = new Set(
        Array.isArray(args.event.payload.beforeValue)
          ? args.event.payload.beforeValue.filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0,
            )
          : [],
      );
      recipients = Array.isArray(args.event.payload.afterValue)
        ? args.event.payload.afterValue.filter(
            (value): value is string =>
              typeof value === "string" &&
              value.length > 0 &&
              !before.has(value),
          )
        : [];
    } else if (
      args.event.topic === "content.database.item.created" ||
      args.event.topic === "content.database.item.submitted"
    ) {
      const personPropertyIds = Array.isArray(
        args.event.payload.personPropertyIds,
      )
        ? args.event.payload.personPropertyIds.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const values = propertyValuesFromEvent(args.event);
      recipients = personPropertyIds.flatMap((propertyId) => {
        const value = values[propertyId];
        return Array.isArray(value)
          ? value.filter(
              (recipient): recipient is string =>
                typeof recipient === "string" && recipient.length > 0,
            )
          : [];
      });
    }
    recipients = [...new Set(recipients)];
    if (recipients.length === 0) return null;
    return {
      kind: "notification" as const,
      idempotencyKey: `${args.event.id}:${args.subscription.id}:default`,
      payload: {
        recipients,
        title: config.name,
        message: "You were added to a Content database item.",
        resource: {
          type: "content_database_item",
          id: args.event.subjectId,
          urlPath: `/page/${args.event.subjectId}`,
        },
        databaseId: config.databaseId,
        eventId: args.event.id,
        subscriptionId: args.subscription.id,
      },
    };
  }
  const hook = {
    databaseId: config.databaseId,
    trigger: config.trigger,
    conditions: config.conditions,
  };
  if (!matchesContentDatabaseHook(args.event, hook)) return null;
  const effect = config.effects.find(
    (candidate) => candidate.kind === "notify",
  );
  if (!effect || effect.kind !== "notify") return null;
  const rawRecipients = propertyValuesFromEvent(args.event)[
    effect.recipientPersonPropertyId
  ];
  const recipients = Array.isArray(rawRecipients)
    ? [
        ...new Set(
          rawRecipients.filter(
            (recipient): recipient is string =>
              typeof recipient === "string" && recipient.length > 0,
          ),
        ),
      ]
    : typeof rawRecipients === "string" && rawRecipients
      ? [rawRecipients]
      : [];
  if (recipients.length === 0) return null;
  return {
    kind: "notification" as const,
    idempotencyKey: `${args.event.id}:${args.subscription.id}:0`,
    payload: {
      recipients,
      title: config.name,
      message:
        effect.message ??
        `Content database item ${args.event.subjectId} needs your attention.`,
      resource: {
        type: "content_database_item",
        id: args.event.subjectId,
        urlPath: `/page/${args.event.subjectId}`,
      },
      databaseId: config.databaseId,
      eventId: args.event.id,
      subscriptionId: args.subscription.id,
    },
  };
}

export function previewContentDatabaseHook(args: {
  event: WorkflowEvent;
  subscription: WorkflowSubscription;
}) {
  const config = contentHookConfigFromJson(
    JSON.stringify(args.subscription.config),
  );
  if (!config || "system" in config) return null;
  const matched = matchesContentDatabaseHook(args.event, {
    databaseId: config.databaseId,
    trigger: config.trigger,
    conditions: config.conditions,
  });
  const values = propertyValuesFromEvent(args.event);
  return {
    matched,
    event: {
      id: args.event.id,
      topic: args.event.topic,
      subjectId: args.event.subjectId,
      actorContext: args.event.actorContext,
      causalEventId: args.event.causalEventId,
    },
    effects: config.effects.map((effect, index) => {
      switch (effect.kind) {
        case "notify": {
          const rawRecipients = values[effect.recipientPersonPropertyId];
          const recipients = Array.isArray(rawRecipients)
            ? [
                ...new Set(
                  rawRecipients.filter(
                    (recipient): recipient is string =>
                      typeof recipient === "string" && recipient.length > 0,
                  ),
                ),
              ]
            : typeof rawRecipients === "string" && rawRecipients
              ? [rawRecipients]
              : [];
          return {
            index,
            kind: effect.kind,
            wouldAttempt: matched && recipients.length > 0,
            recipients,
            message:
              effect.message ??
              `Content database item ${args.event.subjectId} needs your attention.`,
          };
        }
        case "set_property":
          return {
            index,
            kind: effect.kind,
            wouldAttempt: matched,
            propertyId: effect.propertyId,
            value: effect.value,
          };
        case "team_slack":
          return {
            index,
            kind: effect.kind,
            wouldAttempt: matched,
            destinationKeyNames: [effect.webhookKey],
            title: effect.title ?? config.name,
            message:
              effect.message ??
              `Content database item ${args.event.subjectId} changed.`,
          };
        case "webhook":
          return {
            index,
            kind: effect.kind,
            wouldAttempt: matched,
            destinationKeyNames: [effect.urlKey, effect.signatureKey],
            title: effect.title ?? config.name,
            message:
              effect.message ??
              `Content database item ${args.event.subjectId} changed.`,
          };
        default:
          return assertNever(effect);
      }
    }),
  };
}

export async function executeContentDatabaseHook(
  claim: ClaimedWorkflowExecution,
) {
  return runWithRequestContext(
    {
      userEmail: claim.subscription.ownerEmail,
      orgId: claim.subscription.orgId ?? undefined,
    },
    () => executeContentDatabaseHookInContext(claim),
  );
}

async function executeContentDatabaseHookInContext(
  claim: ClaimedWorkflowExecution,
) {
  const config = contentHookConfigFromJson(
    JSON.stringify(claim.subscription.config),
  );
  if (!config) {
    return {
      status: "failed" as const,
      errorMessage: "Content hook configuration is invalid.",
    };
  }
  if (
    !(await contentHookHasCurrentAuthority({
      databaseId: config.databaseId,
      ownerEmail: claim.subscription.ownerEmail,
    }))
  ) {
    return {
      status: "failed" as const,
      errorMessage:
        "The database hook owner no longer has current authority over this database.",
    };
  }
  if ("system" in config) {
    const prepared = prepareContentNotificationEffect({
      event: claim.event,
      subscription: claim.subscription,
    });
    return prepared
      ? executePreparedNotification(claim, prepared)
      : { status: "succeeded" as const };
  }
  if (
    !matchesContentDatabaseHook(claim.event, {
      databaseId: config.databaseId,
      trigger: config.trigger,
      conditions: config.conditions,
    })
  ) {
    return { status: "succeeded" as const };
  }

  if (config.timing.kind === "delayed" || config.timing.kind === "debounced") {
    await scheduleContentHookTiming({
      claim,
      timingKind: config.timing.kind,
      delayMinutes: config.timing.delayMinutes,
      stage: config.timing.kind,
    });
    return { status: "succeeded" as const };
  }
  const immediate = await executeContentHookEffects(claim, config, "initial");
  if (immediate.status === "succeeded" && config.timing.kind === "escalation") {
    await scheduleContentHookTiming({
      claim,
      timingKind: "escalation",
      delayMinutes: config.timing.delayMinutes,
      stage: "escalation",
    });
  }
  return immediate;
}

async function executeContentHookEffects(
  claim: ClaimedWorkflowExecution,
  config: ContentHookConfig,
  stage: "initial" | "delayed" | "debounced" | "escalation",
) {
  for (const [index, effect] of config.effects.entries()) {
    if (effect.kind === "notify") {
      const rawRecipients = propertyValuesFromEvent(claim.event)[
        effect.recipientPersonPropertyId
      ];
      const recipients = Array.isArray(rawRecipients)
        ? [
            ...new Set(
              rawRecipients.filter(
                (recipient): recipient is string =>
                  typeof recipient === "string" && recipient.length > 0,
              ),
            ),
          ]
        : typeof rawRecipients === "string" && rawRecipients
          ? [rawRecipients]
          : [];
      if (recipients.length === 0) continue;
      const outcome = await executePreparedNotification(claim, {
        kind: "notification",
        idempotencyKey: timedEffectKey(
          claim.event.id,
          claim.subscription.id,
          index,
          stage,
        ),
        payload: {
          recipients,
          title: config.name,
          message:
            effect.message ??
            `Content database item ${claim.event.subjectId} needs your attention.`,
          resource: {
            type: "content_database_item",
            id: claim.event.subjectId,
            urlPath: `/page/${claim.event.subjectId}`,
          },
          databaseId: config.databaseId,
          eventId: claim.event.id,
          subscriptionId: claim.subscription.id,
        },
      });
      if (outcome.status !== "succeeded") return outcome;
      continue;
    }

    if (effect.kind === "set_property") {
      const outcome = await executePropertyMutationEffect(
        claim,
        effect,
        index,
        stage,
      );
      if (outcome.status !== "succeeded") return outcome;
      continue;
    }

    if (effect.kind === "team_slack" || effect.kind === "webhook") {
      const outcome = await executeSharedDestinationEffect(
        claim,
        effect,
        index,
        config.name,
        stage,
      );
      if (outcome.status !== "succeeded") return outcome;
      continue;
    }
    assertNever(effect);
  }
  return { status: "succeeded" as const };
}

function mutationChain(claim: ClaimedWorkflowExecution) {
  const actorLineage = claim.event.actorContext.lineage;
  const lineage =
    actorLineage &&
    typeof actorLineage === "object" &&
    !Array.isArray(actorLineage)
      ? (actorLineage as Record<string, unknown>)
      : {};
  const subscriptionPath = Array.isArray(lineage.subscriptionPath)
    ? lineage.subscriptionPath.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const recordedDepth = lineage.chainDepth;
  const chainDepth =
    typeof recordedDepth === "number" &&
    Number.isSafeInteger(recordedDepth) &&
    recordedDepth >= 0
      ? recordedDepth
      : subscriptionPath.length;
  if (subscriptionPath.includes(claim.subscription.id)) {
    return {
      stopped: "cycle_detected" as const,
      chainDepth,
      subscriptionPath,
    };
  }
  if (chainDepth >= MAX_CONTENT_HOOK_CHAIN_DEPTH) {
    return {
      stopped: "max_chain_depth_exceeded" as const,
      chainDepth,
      subscriptionPath,
    };
  }
  return {
    stopped: null,
    chainDepth: chainDepth + 1,
    subscriptionPath: [...subscriptionPath, claim.subscription.id],
  };
}

function originalInitiator(claim: ClaimedWorkflowExecution) {
  const initiator = claim.event.actorContext.initiator;
  if (!initiator || typeof initiator !== "object" || Array.isArray(initiator)) {
    return undefined;
  }
  const value = initiator as Record<string, unknown>;
  if (
    (value.kind !== "human" && value.kind !== "system") ||
    typeof value.id !== "string"
  ) {
    return undefined;
  }
  return {
    kind: value.kind as "human" | "system",
    id: value.id,
  };
}

async function executePropertyMutationEffect(
  claim: ClaimedWorkflowExecution,
  effect: {
    version: 1;
    kind: "set_property";
    propertyId: string;
    value: unknown;
  },
  index: number,
  stage: "initial" | "delayed" | "debounced" | "escalation",
) {
  const reserved = await recordWorkflowEffect({
    executionId: claim.id,
    kind: effect.kind,
    idempotencyKey: timedEffectKey(
      claim.event.id,
      claim.subscription.id,
      index,
      stage,
    ),
  });
  if (!reserved.created && isSettledEffect(reserved.effect.status)) {
    return { status: "succeeded" as const };
  }
  if (!reserved.created) {
    if (
      reserved.effect.status !== "failed" ||
      !(await claimWorkflowEffectRetry({ effectId: reserved.effect.id }))
    ) {
      return {
        status: "unknown" as const,
        errorMessage:
          "The property mutation was already reserved; refusing a duplicate write.",
      };
    }
  }

  const chain = mutationChain(claim);
  if (chain.stopped) {
    await finalizeWorkflowEffect({
      effectId: reserved.effect.id,
      status: "suppressed",
      result: {
        outcome: chain.stopped,
        chainDepth: chain.chainDepth,
        subscriptionPath: chain.subscriptionPath,
        stoppedSubscriptionId: claim.subscription.id,
      },
    });
    return { status: "succeeded" as const };
  }

  try {
    await runWithRequestContext(
      {
        userEmail: claim.subscription.ownerEmail,
        orgId: claim.subscription.orgId ?? undefined,
      },
      () =>
        runWithContentWorkflowCausality(
          {
            causalEventId: claim.event.id,
            parentExecutionId: claim.id,
            parentSubscriptionId: claim.subscription.id,
            chainDepth: chain.chainDepth,
            subscriptionPath: chain.subscriptionPath,
            initiator: originalInitiator(claim),
          },
          () =>
            setDocumentPropertyValue(
              {
                documentId: claim.event.subjectId,
                propertyId: effect.propertyId,
                value: effect.value,
              },
              {
                caller: "tool",
                userEmail: claim.subscription.ownerEmail,
              },
            ),
        ),
    );
    await finalizeWorkflowEffect({
      effectId: reserved.effect.id,
      status: "delivered",
      result: {
        outcome: "property_set",
        documentId: claim.event.subjectId,
        propertyId: effect.propertyId,
        chainDepth: chain.chainDepth,
        subscriptionPath: chain.subscriptionPath,
      },
    });
    return { status: "succeeded" as const };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await finalizeWorkflowEffect({
      effectId: reserved.effect.id,
      status: "failed",
      result: {
        outcome: "property_set_failed",
        documentId: claim.event.subjectId,
        propertyId: effect.propertyId,
      },
      errorMessage,
    });
    return { status: "failed" as const, errorMessage };
  }
}

function timedEffectKey(
  eventId: string,
  subscriptionId: string,
  index: number,
  stage: "initial" | "delayed" | "debounced" | "escalation",
) {
  const base = `${eventId}:${subscriptionId}:${index}`;
  return stage === "initial" ? base : `${base}:${stage}`;
}

async function recordHookSuppression(
  claim: ClaimedWorkflowExecution,
  reason: "evaluator_paused" | "effects_paused" | "condition_no_longer_matches",
  stage: string,
) {
  const reserved = await recordWorkflowEffect({
    executionId: claim.id,
    kind: "content_hook_control",
    idempotencyKey: `${claim.event.id}:${claim.subscription.id}:control:${stage}:${reason}`,
  });
  await finalizeWorkflowEffect({
    effectId: reserved.effect.id,
    status:
      reason === "condition_no_longer_matches" ? "coalesced" : "suppressed",
    result: { reason, stage },
  });
}

function scheduledClaimPayload(
  claim: ClaimedWorkflowExecution,
  stage: "delayed" | "debounced" | "escalation",
) {
  return {
    executionId: claim.id,
    eventId: claim.eventId,
    subscriptionId: claim.subscriptionId,
    subscriptionVersion: claim.subscriptionVersion,
    attempt: claim.attempt,
    event: claim.event,
    subscription: claim.subscription,
    stage,
  };
}

async function scheduleContentHookTiming(args: {
  claim: ClaimedWorkflowExecution;
  timingKind: "delayed" | "debounced" | "escalation";
  delayMinutes: number;
  stage: "delayed" | "debounced" | "escalation";
}) {
  const dedupeKey =
    args.timingKind === "debounced"
      ? `content_hook_debounce:${args.claim.subscriptionId}:${args.claim.event.subjectKey}`
      : `content_hook_timing:${args.claim.subscriptionId}:${args.claim.eventId}:${args.stage}`;
  await scheduleWorkflowWork({
    workType: "content_hook_timing",
    subjectKey: args.claim.event.subjectKey,
    eventId: args.claim.eventId,
    subscriptionId: args.claim.subscriptionId,
    payload: scheduledClaimPayload(args.claim, args.stage),
    dedupeKey,
    dueAt: Date.now() + args.delayMinutes * 60_000,
  });
}

function scheduledExecutionClaim(
  work: ClaimedScheduledWork,
): ClaimedWorkflowExecution | null {
  const payload = work.payload as Record<string, unknown>;
  if (
    typeof payload.executionId !== "string" ||
    typeof payload.eventId !== "string" ||
    typeof payload.subscriptionId !== "string" ||
    typeof payload.subscriptionVersion !== "number" ||
    typeof payload.attempt !== "number" ||
    !payload.event ||
    typeof payload.event !== "object" ||
    !payload.subscription ||
    typeof payload.subscription !== "object"
  ) {
    return null;
  }
  return {
    id: payload.executionId,
    eventId: payload.eventId,
    subscriptionId: payload.subscriptionId,
    subscriptionVersion: payload.subscriptionVersion,
    status: "running",
    attempt: payload.attempt,
    leaseToken: work.leaseToken,
    leaseExpiresAt: work.leaseExpiresAt,
    fenceVersion: work.fenceVersion,
    event: payload.event as WorkflowEvent,
    subscription: payload.subscription as WorkflowSubscription,
  };
}

async function contentHookCurrentStateMatches(
  claim: ClaimedWorkflowExecution,
  hook: Pick<ContentDatabaseHook, "databaseId" | "trigger" | "conditions">,
) {
  const db = getDb();
  const [item] = await db
    .select({ documentId: schema.contentDatabaseItems.documentId })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, hook.databaseId),
        eq(schema.contentDatabaseItems.documentId, claim.event.subjectId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  if (!item) return false;
  const propertyRows = await db
    .select({
      propertyId: schema.documentPropertyValues.propertyId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues)
    .where(eq(schema.documentPropertyValues.documentId, claim.event.subjectId));
  const currentPropertyValues = Object.fromEntries(
    propertyRows.map((row) => [row.propertyId, JSON.parse(row.valueJson)]),
  );
  if (!contentHookConditionsMatch(currentPropertyValues, hook.conditions)) {
    return false;
  }
  if (
    hook.trigger.kind !== "property_changed" ||
    hook.trigger.toOptionId === undefined
  ) {
    return true;
  }
  const current = currentPropertyValues[hook.trigger.propertyId] ?? null;
  return current === hook.trigger.toOptionId;
}

export async function executeScheduledContentDatabaseHook(
  work: ClaimedScheduledWork,
) {
  const claim = scheduledExecutionClaim(work);
  const stage = work.payload.stage;
  if (
    !claim ||
    (stage !== "delayed" && stage !== "debounced" && stage !== "escalation")
  ) {
    return {
      status: "dead_letter" as const,
      errorMessage: "Invalid scheduled Content hook payload.",
    };
  }
  return runWithRequestContext(
    {
      userEmail: claim.subscription.ownerEmail,
      orgId: claim.subscription.orgId ?? undefined,
    },
    () => executeScheduledContentDatabaseHookInContext(work, claim, stage),
  );
}

async function executeScheduledContentDatabaseHookInContext(
  work: ClaimedScheduledWork,
  claim: ClaimedWorkflowExecution,
  stage: "delayed" | "debounced" | "escalation",
) {
  const currentSubscription = await getWorkflowSubscription(
    claim.subscriptionId,
  );
  if (
    !currentSubscription ||
    !currentSubscription.enabled ||
    currentSubscription.version !== claim.subscriptionVersion
  ) {
    return { status: "completed" as const };
  }
  claim.subscription = currentSubscription;
  const config = contentHookConfigFromJson(
    JSON.stringify(currentSubscription.config),
  );
  if (!config || "system" in config) {
    return { status: "completed" as const };
  }
  if (
    !(await contentHookHasCurrentAuthority({
      databaseId: config.databaseId,
      ownerEmail: currentSubscription.ownerEmail,
    }))
  ) {
    return { status: "completed" as const };
  }
  if (
    !matchesContentDatabaseHook(claim.event, config) ||
    !(await contentHookCurrentStateMatches(claim, config))
  ) {
    await recordHookSuppression(claim, "condition_no_longer_matches", stage);
    return { status: "completed" as const };
  }
  const outcome = await executeContentHookEffects(claim, config, stage);
  if (outcome.status === "succeeded") return { status: "completed" as const };
  throw new Error(outcome.errorMessage ?? "Scheduled Content hook failed.");
}

function isSettledEffect(status: string) {
  return (
    status === "delivered" || status === "suppressed" || status === "coalesced"
  );
}

async function executePreparedNotification(
  claim: ClaimedWorkflowExecution,
  prepared: NonNullable<ReturnType<typeof prepareContentNotificationEffect>>,
) {
  for (const recipient of prepared.payload.recipients) {
    const executionEffectKey = `${prepared.idempotencyKey}:${recipient}`;
    const preference = await resolveContentNotificationPreference({
      ownerEmail: recipient,
      orgId: claim.event.orgId,
      databaseId: prepared.payload.databaseId,
      subscriptionId: claim.subscription.id,
      documentId: claim.event.subjectId,
    });
    if (!preference.enabled) {
      const reserved = await recordWorkflowEffect({
        executionId: claim.id,
        kind: prepared.kind,
        idempotencyKey: executionEffectKey,
      });
      if (!reserved.created && isSettledEffect(reserved.effect.status)) {
        continue;
      }
      await finalizeWorkflowEffect({
        effectId: reserved.effect.id,
        status: "suppressed",
        result: {
          recipient,
          outcome: "suppressed_by_preference",
          preferenceScope: preference.source,
          preferenceId: preference.preferenceId,
        },
      });
      continue;
    }
    const recipientAccess = await resolveAccess(
      "document",
      claim.event.subjectId,
      {
        userEmail: recipient,
        orgId: claim.event.orgId ?? undefined,
      },
      { skipResourceBody: true },
    );
    if (!recipientAccess) {
      const reserved = await recordWorkflowEffect({
        executionId: claim.id,
        kind: prepared.kind,
        idempotencyKey: executionEffectKey,
      });
      if (!reserved.created && isSettledEffect(reserved.effect.status)) {
        continue;
      }
      await finalizeWorkflowEffect({
        effectId: reserved.effect.id,
        status: "failed",
        result: { recipient, unroutable: true },
        errorMessage:
          "Recipient does not have access to the notification resource.",
      });
      continue;
    }

    const deliveryClaim = await recordWorkflowEffect({
      executionId: claim.id,
      kind: prepared.kind,
      idempotencyKey: [
        "content-personal-notification",
        claim.event.id,
        claim.event.subjectId,
        recipient,
        "personal-routing",
      ].join(":"),
    });
    if (
      !deliveryClaim.created &&
      deliveryClaim.effect.executionId !== claim.id
    ) {
      const coalesced = await recordWorkflowEffect({
        executionId: claim.id,
        kind: prepared.kind,
        idempotencyKey: executionEffectKey,
      });
      if (!coalesced.created && isSettledEffect(coalesced.effect.status)) {
        continue;
      }
      await finalizeWorkflowEffect({
        effectId: coalesced.effect.id,
        status: "coalesced",
        result: {
          recipient,
          outcome: "coalesced_by_event_recipient_item_destination",
          destination: "personal-routing",
          coalescedIntoEffectId: deliveryClaim.effect.id,
          coalescedIntoExecutionId: deliveryClaim.effect.executionId,
        },
      });
      continue;
    }
    if (
      !deliveryClaim.created &&
      isSettledEffect(deliveryClaim.effect.status)
    ) {
      continue;
    }
    if (!deliveryClaim.created && deliveryClaim.effect.status === "unknown") {
      return {
        status: "unknown" as const,
        errorMessage:
          "The personal notification may already have been sent; refusing duplicate delivery without a receipt.",
      };
    }
    if (
      !deliveryClaim.created &&
      deliveryClaim.effect.status === "failed" &&
      !(await claimWorkflowEffectRetry({ effectId: deliveryClaim.effect.id }))
    ) {
      return {
        status: "unknown" as const,
        errorMessage:
          "The personal notification retry was claimed by another worker.",
      };
    }
    const delivered = await notifyPersonalWithDelivery(
      {
        severity: "info",
        title: prepared.payload.title,
        body: prepared.payload.message,
        metadata: {
          ...prepared.payload.resource,
          eventId: claim.event.id,
          subscriptionId: claim.subscription.id,
        },
      },
      {
        owner: recipient,
        workflowEffectId: deliveryClaim.effect.id,
        workflowAttempt: claim.attempt,
      },
    );
    const status =
      delivered.deliveredChannels.length > 0
        ? "delivered"
        : delivered.unknownChannels.length > 0
          ? "unknown"
          : "failed";
    await finalizeWorkflowEffect({
      effectId: deliveryClaim.effect.id,
      status,
      result: {
        recipient,
        notificationId: delivered.notification?.id,
        deliveredChannels: delivered.deliveredChannels,
        unknownChannels: delivered.unknownChannels,
        skippedChannels: delivered.skippedChannels,
        failedChannels: delivered.failedChannels,
      },
      errorMessage:
        status === "failed"
          ? "No configured notification channel accepted the delivery."
          : undefined,
    });
    if (status === "unknown") {
      return {
        status: "unknown" as const,
        errorMessage:
          "A personal notification was accepted without delivery evidence.",
      };
    }
    if (status === "failed") {
      return {
        status: "retrying" as const,
        errorMessage: "Notification delivery did not reach any channel.",
      };
    }
  }
  return { status: "succeeded" as const };
}

async function executeSharedDestinationEffect(
  claim: ClaimedWorkflowExecution,
  effect:
    | {
        kind: "team_slack";
        webhookKey: string;
        title?: string;
        message?: string;
      }
    | {
        kind: "webhook";
        urlKey: string;
        signatureKey: string;
        title?: string;
        message?: string;
      },
  index: number,
  hookName: string,
  stage: "initial" | "delayed" | "debounced" | "escalation",
) {
  const reserved = await recordWorkflowEffect({
    executionId: claim.id,
    kind: effect.kind,
    idempotencyKey: timedEffectKey(
      claim.event.id,
      claim.subscription.id,
      index,
      stage,
    ),
  });
  if (!reserved.created && isSettledEffect(reserved.effect.status)) {
    return { status: "succeeded" as const };
  }
  if (!reserved.created) {
    if (
      reserved.effect.status !== "failed" ||
      !(await claimWorkflowEffectRetry({ effectId: reserved.effect.id }))
    ) {
      return {
        status: "unknown" as const,
        errorMessage:
          "The external effect was already reserved; refusing duplicate delivery.",
      };
    }
  }

  const delivery =
    effect.kind === "team_slack"
      ? {
          channel: "slack" as const,
          metadata: {
            delivery: {
              slackWebhookUrl: `\${keys.${effect.webhookKey}}`,
            },
          },
        }
      : {
          channel: "webhook" as const,
          metadata: {
            delivery: {
              webhookUrl: `\${keys.${effect.urlKey}}`,
              webhookSignature: `\${keys.${effect.signatureKey}}`,
            },
          },
        };
  const delivered = await notifyWithDelivery(
    {
      severity: "info",
      title: effect.title ?? hookName,
      body:
        effect.message ??
        `Content database item ${claim.event.subjectId} changed.`,
      channels: [delivery.channel],
      metadata: {
        ...delivery.metadata,
        resourceType: "content_database_item",
        resourceId: claim.event.subjectId,
        resourceUrlPath: `/page/${claim.event.subjectId}`,
        eventId: claim.event.id,
        subscriptionId: claim.subscription.id,
      },
    },
    {
      owner: claim.subscription.ownerEmail,
      workflowEffectId: reserved.effect.id,
      workflowAttempt: claim.attempt,
    },
  );
  const didDeliver = delivered.deliveredChannels.includes(delivery.channel);
  const isUnknown = delivered.unknownChannels.includes(delivery.channel);
  await finalizeWorkflowEffect({
    effectId: reserved.effect.id,
    status: didDeliver ? "delivered" : isUnknown ? "unknown" : "failed",
    result: {
      destination: effect.kind,
      deliveredChannels: delivered.deliveredChannels,
      unknownChannels: delivered.unknownChannels,
      skippedChannels: delivered.skippedChannels,
      failedChannels: delivered.failedChannels,
    },
    errorMessage: didDeliver
      ? undefined
      : isUnknown
        ? `The configured ${effect.kind} destination accepted the send without delivery evidence.`
        : `The configured ${effect.kind} destination did not accept delivery.`,
  });
  return didDeliver
    ? { status: "succeeded" as const }
    : isUnknown
      ? {
          status: "unknown" as const,
          errorMessage: `The configured ${effect.kind} destination accepted the send without delivery evidence.`,
        }
      : {
          status: "retrying" as const,
          errorMessage: `The configured ${effect.kind} destination did not accept delivery.`,
        };
}
