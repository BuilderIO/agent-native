/**
 * Onboarding plugin — auto-mounts the `/_agent-native/onboarding/*` routes.
 *
 * Routes:
 *   GET  /_agent-native/onboarding/steps              — list steps + completion
 *   POST /_agent-native/onboarding/steps/:id/complete — manual override (marks complete)
 *   POST /_agent-native/onboarding/dismiss            — dismiss the banner
 *   GET  /_agent-native/onboarding/dismissed          — dismissed flag + allComplete
 *   GET  /_agent-native/onboarding/first-run/status   — post-signup flow status
 *   POST /_agent-native/onboarding/first-run/complete — permanently complete it
 */

import {
  deleteCookie,
  defineEventHandler,
  getCookie,
  getMethod,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import { appStateGet, appStatePut } from "../application-state/store.js";
import { getOrgContext } from "../org/context.js";
import { getSession } from "../server/auth.js";
import {
  awaitBootstrap,
  getH3App,
  markDefaultPluginProvided,
} from "../server/framework-request-handler.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  FIRST_RUN_ONBOARDING_COMPLETED_KEY,
  FIRST_RUN_ONBOARDING_COOKIE,
  FIRST_RUN_ONBOARDING_ELIGIBLE_KEY,
} from "../shared/first-run-onboarding.js";
import { getOnboardingAppProfile } from "./app-profile.js";
import { registerDefaultOnboardingSteps } from "./default-steps.js";
import { listOnboardingSteps } from "./registry.js";
import type {
  OnboardingResolveContext,
  OnboardingStepStatus,
} from "./types.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

const ONBOARDING_PREFIX = "/_agent-native/onboarding";
const OVERRIDE_KEY_PREFIX = "onboarding:override:";
const DISMISSED_KEY = "onboarding:dismissed";

export interface OnboardingPluginOptions {
  /** Skip registering the built-in default steps (llm, database, auth). */
  skipDefaultSteps?: boolean;
  /** App id used to select the app-specific first-run capability profile. */
  appId?: string;
}

/** Resolve the caller context used for onboarding and application-state scoping. */
async function resolveOnboardingContext(
  event: H3Event,
): Promise<OnboardingResolveContext> {
  const session = await getSession(event);
  if (!session) return { sessionId: "local" };
  return {
    sessionId: session.email,
    userEmail: session.email,
    orgId: session.orgId ?? null,
  };
}

async function hasOverride(
  sessionId: string,
  stepId: string,
): Promise<boolean> {
  // appStateGet hits the DB; on transient connection errors (flaky network /
  // Neon timeout) treat as "no override" rather than 500ing the whole route.
  try {
    const val = await appStateGet(sessionId, `${OVERRIDE_KEY_PREFIX}${stepId}`);
    return !!(val && (val as { complete?: boolean }).complete);
  } catch {
    return false;
  }
}

/**
 * Serialise every registered onboarding step (awaiting `isComplete()`).
 * Honours the per-session "manual override" flag in application-state.
 *
 * `preview` short-circuits both the resolver and the override lookup so the
 * dev overlay can render the new-user flow without touching real state.
 */
async function serializeSteps(
  context: OnboardingResolveContext,
  options: { preview?: boolean } = {},
): Promise<OnboardingStepStatus[]> {
  const steps = listOnboardingSteps();
  // Steps are independent of each other, and each `isComplete()` is itself a
  // chain of credential/settings reads — walking them one at a time made this
  // route cost the SUM of every step's round trips against a remote database
  // instead of the slowest one. `Promise.all` preserves `steps` order.
  return Promise.all(
    steps.map(async (step) => {
      let complete = false;
      if (!options.preview) {
        try {
          complete = (await step.isComplete(context)) === true;
        } catch {
          complete = false;
        }
        if (!complete) {
          complete = await hasOverride(context.sessionId, step.id);
        }
      }
      return {
        id: step.id,
        title: step.title,
        description: step.description,
        order: step.order,
        required: step.required ?? false,
        complete,
        methods: step.methods,
      };
    }),
  );
}

function withOnboardingRequestContext<T>(
  context: OnboardingResolveContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return runWithRequestContext(
    {
      userEmail: context.userEmail,
      orgId: context.orgId ?? undefined,
    },
    fn,
  );
}

function allRequiredComplete(statuses: OnboardingStepStatus[]): boolean {
  return statuses.filter((s) => s.required).every((s) => s.complete);
}

export function createOnboardingPlugin(
  options: OnboardingPluginOptions = {},
): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "onboarding");
    await awaitBootstrap(nitroApp);

    const appProfile = getOnboardingAppProfile(options.appId);

    if (!options.skipDefaultSteps) {
      registerDefaultOnboardingSteps();
    }

    // GET  /_agent-native/onboarding/steps              — list steps
    // POST /_agent-native/onboarding/steps/:id/complete — manual override
    //
    // Mounting on `/steps` means the middleware wrapper strips that prefix,
    // so this handler sees `/` for the list and `/<stepId>/complete` for the
    // override.
    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/steps`,
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        const pathname = event.url?.pathname || "/";
        const trimmed = pathname.replace(/^\/+/, "").replace(/\/+$/, "");

        // List endpoint — GET /steps (pathname becomes "" or "/")
        if (trimmed === "") {
          if (method !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const context = await resolveOnboardingContext(event);
          const query = getQuery(event) as Record<string, unknown>;
          const preview = query.preview === "1" || query.preview === 1;
          return withOnboardingRequestContext(context, () =>
            serializeSteps(context, { preview }),
          );
        }

        // Override endpoint — POST /steps/:id/complete
        const [id, action] = trimmed.split("/");
        if (action === "complete") {
          if (method !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          if (!id) {
            setResponseStatus(event, 400);
            return { error: "id required" };
          }
          const { sessionId } = await resolveOnboardingContext(event);
          await appStatePut(
            sessionId,
            `${OVERRIDE_KEY_PREFIX}${id}`,
            { complete: true },
            { requestSource: "agent" },
          );
          return { ok: true, id };
        }

        // Unknown subroute — fall through to other middleware.
        return;
      }),
    );

    // POST /_agent-native/onboarding/dismiss
    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/dismiss`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const { sessionId } = await resolveOnboardingContext(event);
        await appStatePut(
          sessionId,
          DISMISSED_KEY,
          { dismissed: true, at: new Date().toISOString() },
          { requestSource: "agent" },
        );
        return { ok: true };
      }),
    );

    // POST /_agent-native/onboarding/reopen — clear dismissed flag
    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/reopen`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const { sessionId } = await resolveOnboardingContext(event);
        await appStatePut(
          sessionId,
          DISMISSED_KEY,
          { dismissed: false, at: new Date().toISOString() },
          { requestSource: "agent" },
        );
        return { ok: true };
      }),
    );

    // GET /_agent-native/onboarding/dismissed
    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/dismissed`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const context = await resolveOnboardingContext(event);
        // On flaky networks (or transient Neon hiccups) the DB call below
        // can throw — return safe defaults so a transient connection error
        // doesn't surface as a 500 to the client.
        try {
          return await withOnboardingRequestContext(context, async () => {
            const [value, statuses] = await Promise.all([
              appStateGet(context.sessionId, DISMISSED_KEY),
              serializeSteps(context),
            ]);
            const dismissed = !!(
              value && (value as { dismissed?: boolean }).dismissed
            );
            return {
              dismissed,
              allComplete: allRequiredComplete(statuses),
            };
          });
        } catch {
          return { dismissed: false, allComplete: false };
        }
      }),
    );

    // GET /_agent-native/onboarding/profile
    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/profile`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return appProfile;
      }),
    );

    // GET /_agent-native/onboarding/first-run/status
    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/first-run/status`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        if (getCookie(event, FIRST_RUN_ONBOARDING_COOKIE) !== "1") {
          return { firstRun: false };
        }
        const context = await resolveOnboardingContext(event);
        if (!context.userEmail) return { firstRun: false };

        return withOnboardingRequestContext(context, async () => {
          const completed = await appStateGet(
            context.sessionId,
            FIRST_RUN_ONBOARDING_COMPLETED_KEY,
          );
          if (completed?.completed === true) {
            deleteCookie(event, FIRST_RUN_ONBOARDING_COOKIE, { path: "/" });
            return { firstRun: false };
          }

          // Signup alone is not enough to qualify. Resolve the real org path
          // first so invite/domain members cannot race this check before their
          // existing membership is visible, while a true first user causes the
          // default org to be created and marked eligible.
          const orgContext = await getOrgContext(event);
          const eligible = await appStateGet(
            context.sessionId,
            FIRST_RUN_ONBOARDING_ELIGIBLE_KEY,
          );
          const firstRun =
            orgContext.orgId !== null && eligible?.orgId === orgContext.orgId;
          if (!firstRun) {
            deleteCookie(event, FIRST_RUN_ONBOARDING_COOKIE, { path: "/" });
          }
          return {
            firstRun,
          };
        });
      }),
    );

    // POST /_agent-native/onboarding/first-run/complete
    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/first-run/complete`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const context = await resolveOnboardingContext(event);
        if (!context.userEmail) {
          setResponseStatus(event, 401);
          return { error: "Authentication required" };
        }
        await appStatePut(
          context.sessionId,
          FIRST_RUN_ONBOARDING_COMPLETED_KEY,
          { completed: true, at: new Date().toISOString() },
          { requestSource: "agent" },
        );
        deleteCookie(event, FIRST_RUN_ONBOARDING_COOKIE, { path: "/" });
        return { ok: true };
      }),
    );
  };
}

/** Default plugin instance — mounted automatically when a template doesn't override. */
export const defaultOnboardingPlugin: NitroPluginDef = createOnboardingPlugin();
