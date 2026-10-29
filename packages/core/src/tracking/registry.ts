import { randomUUID } from "node:crypto";

import type { ActionRunContext } from "../action.js";
import { getAppConfig } from "../app-config/index.js";
import {
  questionIntakeExposureProperties,
  resolveQuestionIntakeExperimentAssignment,
  type QuestionIntakeExperimentAssignment,
} from "../observability/question-intake-experiment.js";
import {
  queueTrackingEvent,
  registerTrackingWork,
  type TrackingEventOrigin,
} from "../observability/tracing.js";
import { resolveDeployEnvironment } from "../server/deploy-environment.js";
import {
  getRequestContext,
  getRequestRunContext,
} from "../server/request-context.js";
import { isTestIdentity } from "../server/test-identity.js";
import {
  canonicalTrackingEvent,
  legacyLifecycleEvent,
  TRACKING_EVENT_ALIAS_ID_PROPERTY,
  withCanonicalTrackingProperties,
} from "../shared/analytics-events.js";
import { ANALYTICS_CLIENT_PLATFORM_PROPERTY } from "../shared/analytics-platform.js";
import {
  assignFirstRunBuilderCreditsV2,
  FIRST_RUN_ONBOARDING_EXPERIMENT_EVENT_NAMES,
} from "../shared/first-run-builder-credits-experiment.js";
import type { TrackingProvider, TrackingEvent } from "./types.js";

export { isQaTestEmail } from "../shared/qa-test-email.js";

const REGISTRY_KEY = Symbol.for("@agent-native/core/tracking.registry");
const FIRST_RUN_EXPERIMENT_EVENT_NAMES = new Set([
  "run_started",
  "design_created",
  "deck_created",
  "recording_ready",
]);
interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, TrackingProvider>;
}

/** The test identity an event belongs to, if any. */
function testIdentityOf(
  userId: string | undefined,
  properties?: Record<string, unknown>,
): string | undefined {
  return [
    getRequestContext()?.userEmail,
    userId,
    properties?.email,
    properties?.userEmail,
    properties?.user_email,
  ].find((value): value is string => isTestIdentity(value));
}

export function isTrackingSuppressed(
  userId: string | undefined,
  properties?: Record<string, unknown>,
): boolean {
  return (
    getRequestContext()?.isSyntheticTraffic === true ||
    testIdentityOf(userId, properties) !== undefined
  );
}

function getRegistry(): Map<string, TrackingProvider> {
  const g = globalThis as unknown as GlobalWithRegistry;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map();
  return g[REGISTRY_KEY];
}

export function registerTrackingProvider(provider: TrackingProvider): void {
  if (!provider?.name) {
    throw new Error("registerTrackingProvider: provider.name is required");
  }
  if (typeof provider.track !== "function") {
    throw new Error(
      "registerTrackingProvider: provider.track must be a function",
    );
  }
  getRegistry().set(provider.name, provider);
}

export function unregisterTrackingProvider(name: string): boolean {
  return getRegistry().delete(name);
}

export function listTrackingProviders(): string[] {
  return Array.from(getRegistry().keys());
}

export interface TrackingMeta {
  userId?: string;
  authUserId?: string;
  anonymousId?: string;
  /** Null pins session absence and disables request-context fallback. */
  sessionId?: string | null;
  occurredAt?: number;
  telemetryOrigin?: TrackingEventOrigin;
}

export type TrackingSource =
  | TrackingMeta
  | (ActionRunContext & Pick<TrackingMeta, "sessionId">);

function isActionRunContext(
  source: TrackingSource,
): source is ActionRunContext & Pick<TrackingMeta, "sessionId"> {
  return typeof (source as ActionRunContext).caller === "string";
}

function resolveTrackingSource(source: TrackingSource | undefined): {
  userId?: string;
  authUserId?: string;
  anonymousId?: string;
  sessionId?: string;
  occurredAt?: number;
  telemetryOrigin: TrackingEventOrigin;
} {
  const requestContext = getRequestContext();
  const ambientSessionId = requestContext?.browserSessionId;
  if (!source) {
    return {
      authUserId: requestContext?.authUserId,
      sessionId: ambientSessionId,
      telemetryOrigin: "server",
    };
  }
  if (isActionRunContext(source)) {
    const callerMatchesRequest = source.userEmail === requestContext?.userEmail;
    const explicitSessionId = source.sessionId;
    return {
      userId: source.userEmail,
      ...(callerMatchesRequest
        ? { authUserId: requestContext?.authUserId }
        : {}),
      sessionId:
        explicitSessionId === undefined
          ? callerMatchesRequest
            ? ambientSessionId
            : undefined
          : (explicitSessionId ?? undefined),
      telemetryOrigin: "server",
    };
  }
  const canUseAmbientIdentity = source.userId
    ? source.userId === requestContext?.userEmail
    : !source.anonymousId;
  const canUseAmbientSession =
    canUseAmbientIdentity &&
    (!source.authUserId || source.authUserId === requestContext?.authUserId);
  return {
    userId: source.userId,
    authUserId:
      source.authUserId ??
      (canUseAmbientIdentity ? requestContext?.authUserId : undefined),
    anonymousId: source.anonymousId,
    sessionId:
      source.sessionId === undefined
        ? canUseAmbientSession
          ? ambientSessionId
          : undefined
        : (source.sessionId ?? undefined),
    occurredAt: source.occurredAt,
    telemetryOrigin: source.telemetryOrigin ?? "server",
  };
}

export function track(
  name: string,
  properties?: Record<string, unknown>,
  source?: TrackingSource,
): void {
  // raw-sql-ok: tracking persistence uses bound arguments for resolved identity values.
  const resolvedSource = resolveTrackingSource(source);
  // raw-sql-ok: resolved IDs remain bound event values at the tracking store boundary.
  const { authUserId, userId } = resolvedSource;
  if (getRequestContext()?.isSyntheticTraffic === true) return;
  const testIdentity = testIdentityOf(userId, properties);
  if (testIdentity && name !== "$exception") return;

  const config = getAppConfig().agent.questionIntake;
  const mayAttributeClientEvent =
    resolvedSource.telemetryOrigin !== "client" ||
    config?.clientTrackedEventNames.includes(name) === true;
  if (
    config?.enabled &&
    !config.disabled &&
    config.trackedEventNames.includes(name) &&
    authUserId &&
    mayAttributeClientEvent
  ) {
    const experimentProperties = { ...(properties ?? {}) };
    delete experimentProperties.experiment_id;
    delete experimentProperties.experiment_variant;
    const requestAssignment =
      getRequestRunContext()?.questionIntakeExperimentAssignment;
    if (
      requestAssignment?.authUserId === authUserId &&
      requestAssignment.experimentId === config.experimentId
    ) {
      emitTrackedEvent(name, experimentProperties, source, requestAssignment);
      return;
    }

    const pending = resolveQuestionIntakeExperimentAssignment(
      config,
      authUserId,
    )
      .then(
        (assignment) =>
          emitTrackedEvent(
            name,
            experimentProperties,
            source,
            assignment ?? undefined,
          ),
        () => {
          console.error("[tracking] question-intake assignment lookup failed", {
            experimentId: config.experimentId,
            eventName: name,
          });
          emitTrackedEvent(name, experimentProperties, source);
        },
      )
      .catch(() => {
        console.error("[tracking] asynchronous event delivery failed");
      });
    registerTrackingWork(pending, getRequestContext()?.trackingScope);
    const waitUntil = getRequestRunContext()?.waitUntil;
    if (waitUntil) {
      try {
        waitUntil(pending);
        return;
      } catch {
        console.error("[tracking] request waitUntil rejected tracked event");
      }
    }
    void pending.catch(() => {
      console.error("[tracking] tracked event failed outside waitUntil");
    });
    return;
  }

  emitTrackedEvent(name, properties, source);
}

export function trackQuestionIntakeExposure(
  assignment: QuestionIntakeExperimentAssignment,
  context: {
    appId: string;
    threadId?: string;
    turnId: string;
    userId?: string;
  },
): void {
  track(
    "agent_experiment_exposed",
    questionIntakeExposureProperties(assignment, context),
    {
      ...(context.userId ? { userId: context.userId } : {}),
      authUserId: assignment.authUserId,
    },
  );
}

function emitTrackedEvent(
  name: string,
  properties: Record<string, unknown> | undefined,
  source: TrackingSource | undefined,
  questionIntakeAssignment?: QuestionIntakeExperimentAssignment,
): void {
  const {
    userId,
    authUserId,
    anonymousId,
    sessionId,
    occurredAt,
    telemetryOrigin,
  } = resolveTrackingSource(source);
  if (getRequestContext()?.isSyntheticTraffic === true) return;
  const testIdentity = testIdentityOf(userId, properties);
  if (testIdentity && name !== "$exception") return;
  const clientPlatform = getRequestContext()?.clientPlatform;
  const actionContext =
    source && isActionRunContext(source) ? source : undefined;
  const safeProperties = { ...(properties ?? {}) };
  delete safeProperties.auth_user_id;
  delete safeProperties.authUserId;
  delete safeProperties.telemetry_origin;
  delete safeProperties.telemetryOrigin;
  if (telemetryOrigin === "client") {
    delete safeProperties.experiment_id;
    delete safeProperties.experiment_variant;
  }
  if (authUserId) safeProperties.auth_user_id = authUserId;
  const firstRunExperiment =
    authUserId &&
    (FIRST_RUN_EXPERIMENT_EVENT_NAMES.has(name) ||
      (FIRST_RUN_ONBOARDING_EXPERIMENT_EVENT_NAMES.has(name) &&
        safeProperties.flow === "first_run"))
      ? requestFirstRunExperiment(authUserId)
      : null;
  const trackedProperties = withCanonicalTrackingProperties({
    ...safeProperties,
    telemetry_origin: telemetryOrigin,
    ...(firstRunExperiment ?? {}),
    ...(questionIntakeAssignment
      ? {
          experiment_id: questionIntakeAssignment.experimentId,
          experiment_variant: questionIntakeAssignment.variantId,
        }
      : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(actionContext?.userEmail
      ? { user_email: actionContext.userEmail }
      : {}),
    ...(actionContext?.orgId ? { workspace_id: actionContext.orgId } : {}),
    deployment_environment: resolveDeployEnvironment(),
    ...(clientPlatform
      ? { [ANALYTICS_CLIENT_PLATFORM_PROPERTY]: clientPlatform }
      : {}),
    // Ingest trusts an identity, never the flag, so the matched one rides along.
    ...(testIdentity
      ? { test_identity: true, test_identity_email: testIdentity }
      : {}),
  });
  const canonical = canonicalTrackingEvent(name, trackedProperties);
  if (canonical) {
    const aliasId = randomUUID();
    trackedProperties[TRACKING_EVENT_ALIAS_ID_PROPERTY] = aliasId;
    canonical.properties[TRACKING_EVENT_ALIAS_ID_PROPERTY] = aliasId;
  }

  emitTrackingEvent(name, trackedProperties, {
    userId,
    anonymousId,
    sessionId,
    occurredAt,
  });
  if (testIdentity) return;
  const trackingScope = getRequestContext()?.trackingScope;
  if (trackingScope) {
    queueTrackingEvent(name, trackedProperties, telemetryOrigin, trackingScope);
  } else {
    queueTrackingEvent(name, trackedProperties, telemetryOrigin);
  }

  if (canonical) {
    emitTrackingEvent(canonical.name, canonical.properties, {
      userId,
      anonymousId,
      sessionId,
      occurredAt,
    });
  }

  const lifecycle = legacyLifecycleEvent(name, trackedProperties);
  if (lifecycle) {
    emitTrackingEvent(lifecycle.name, lifecycle.properties, {
      userId,
      anonymousId,
      sessionId,
      occurredAt,
    });
  }
}

function requestFirstRunExperiment(authUserId: string) {
  const assignment = getRequestContext()?.firstRunBuilderCreditsV2Assignment;
  if (assignment?.authUserId !== authUserId) return null;
  const expected = assignFirstRunBuilderCreditsV2(authUserId);
  if (
    !expected ||
    assignment.experiment_variant !== expected.experiment_variant
  ) {
    return null;
  }
  return {
    experiment_id: assignment.experiment_id,
    experiment_variant: assignment.experiment_variant,
  };
}

function emitTrackingEvent(
  name: string,
  properties: Record<string, unknown>,
  source: TrackingMeta,
): void {
  const event: TrackingEvent = {
    name,
    properties,
    timestamp: new Date(source.occurredAt || Date.now()).toISOString(),
    userId: source.userId,
    anonymousId: source.anonymousId,
    sessionId: source.sessionId ?? undefined,
  };

  for (const provider of getRegistry().values()) {
    if (
      properties.test_identity === true &&
      !provider.acceptsTestIdentityExceptions
    )
      continue;
    try {
      const result = provider.track(event);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          console.error(
            `[tracking] Provider "${provider.name}" rejected:`,
            err,
          );
        });
      }
    } catch (err) {
      console.error(`[tracking] Provider "${provider.name}" threw:`, err);
    }
  }
}

export function identify(
  userId: string,
  traits?: Record<string, unknown>,
): void {
  if (isTrackingSuppressed(userId, traits)) return;
  for (const provider of getRegistry().values()) {
    if (!provider.identify) continue;
    try {
      const result = provider.identify(userId, traits);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {});
      }
    } catch {
      // best-effort
    }
  }
}

export function flushTracking(): Promise<void[]> {
  const promises: Promise<void>[] = [];
  for (const provider of getRegistry().values()) {
    if (!provider.flush) continue;
    try {
      const result = provider.flush();
      if (result) {
        promises.push(
          result.catch((err) => {
            console.error(
              `[tracking] Provider "${provider.name}" flush rejected:`,
              err,
            );
          }),
        );
      }
    } catch (err) {
      console.error(`[tracking] Provider "${provider.name}" flush threw:`, err);
      // best-effort
    }
  }
  return Promise.all(promises);
}
