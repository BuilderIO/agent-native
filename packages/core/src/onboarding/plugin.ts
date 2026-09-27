import {
  deleteCookie,
  defineEventHandler,
  getCookie,
  getMethod,
  setCookie,
  getQuery,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getAppConfig } from "../app-config/index.js";
import { appStateGet, appStatePut } from "../application-state/store.js";
import { getOrgContext } from "../org/context.js";
import { readBrowserSessionIdHeader } from "../server/agent-run-context.js";
import { CredentialStoreUnavailableError } from "../server/credential-provider.js";
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
import { classifyTrackingFailure, track } from "../tracking/index.js";
import {
  getOnboardingRoleCategory,
  onboardingRoleSchema,
} from "../user-profile/shared.js";
import {
  getUserProfile,
  updateUserOnboardingRole,
} from "../user-profile/store.js";
import { getOnboardingAppProfile } from "./app-profile.js";
import { registerDefaultOnboardingSteps } from "./default-steps.js";
import { listOnboardingSteps } from "./registry.js";
import {
  SHARED_ONBOARDING_COOKIE,
  SHARED_ONBOARDING_COOKIE_MAX_AGE,
  decodeSharedOnboardingCookie,
  encodeSharedOnboardingCookie,
  hashOnboardingEmail,
} from "./shared-cookie.js";
import type {
  OnboardingResolveContext,
  OnboardingStepStatus,
} from "./types.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

const ONBOARDING_PREFIX = "/_agent-native/onboarding";
const OVERRIDE_KEY_PREFIX = "onboarding:override:";
const DISMISSED_KEY = "onboarding:dismissed";

export interface OnboardingPluginOptions {
  skipDefaultSteps?: boolean;
  appId?: string;
}

async function resolveOnboardingContext(
  event: H3Event,
): Promise<OnboardingResolveContext> {
  const { getSession } = await import("../server/auth.js");
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
  try {
    const val = await appStateGet(sessionId, `${OVERRIDE_KEY_PREFIX}${stepId}`);
    return !!(val && (val as { complete?: boolean }).complete);
  } catch {
    return false;
  }
}

async function serializeSteps(
  context: OnboardingResolveContext,
  options: { preview?: boolean } = {},
): Promise<OnboardingStepStatus[]> {
  const steps = listOnboardingSteps();
  const serialized = await Promise.all(
    steps.map(async (step) => {
      if (!options.preview && step.isAvailable) {
        if (!(await step.isAvailable(context))) return null;
      }
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
  return serialized.filter(
    (step): step is OnboardingStepStatus => step !== null,
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

async function readDismissedFlag(sessionId: string): Promise<boolean> {
  // The dismissed flag is optional UX state; a transient DB failure reading it
  // must not take down a read whose steps and profile are still usable (the
  // pre-summary client already assumed "not dismissed" when this read
  // failed). A credential-store outage is not transient, so it still throws.
  try {
    const value = await appStateGet(sessionId, DISMISSED_KEY);
    return !!(value && (value as { dismissed?: boolean }).dismissed);
  } catch (error) {
    if (error instanceof CredentialStoreUnavailableError) throw error;
    return false;
  }
}

async function resolveSharedCompletionEnabled(): Promise<boolean> {
  if (!getAppConfig().onboarding.sharedCompletion.enabled) return false;
  const { sharedFirstPartyCookieDomainAttrs } =
    await import("../server/auth.js");
  if (sharedFirstPartyCookieDomainAttrs().domain) return true;
  console.warn(
    "[onboarding] ONBOARDING_SHARED_COMPLETION is on but COOKIE_DOMAIN is not set, so sibling apps cannot read the shared cookie. Shared onboarding is disabled.",
  );
  return false;
}

export function createOnboardingPlugin(
  options: OnboardingPluginOptions = {},
): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "onboarding");
    await awaitBootstrap(nitroApp);

    const appProfile = getOnboardingAppProfile(options.appId);
    const sharedCompletionEnabled = await resolveSharedCompletionEnabled();

    if (!options.skipDefaultSteps) {
      registerDefaultOnboardingSteps();
    }

    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/steps`,
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        const pathname = event.url?.pathname || "/";
        const trimmed = pathname.replace(/^\/+/, "").replace(/\/+$/, "");

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

        return;
      }),
    );

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

    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/dismissed`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const context = await resolveOnboardingContext(event);
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
        } catch (error) {
          if (error instanceof CredentialStoreUnavailableError) throw error;
          return { dismissed: false, allComplete: false };
        }
      }),
    );

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

    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/summary`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const context = await resolveOnboardingContext(event);
        const query = getQuery(event) as Record<string, unknown>;
        const preview = query.preview === "1" || query.preview === 1;
        return withOnboardingRequestContext(context, async () => {
          const [steps, dismissed] = await Promise.all([
            serializeSteps(context, { preview }),
            readDismissedFlag(context.sessionId),
          ]);
          return {
            steps,
            dismissed,
            profile: appProfile,
          };
        });
      }),
    );

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
        const userEmail = context.userEmail;
        const { cookieDomainAttrs, crossSiteCookieAttrs } =
          await import("../server/auth.js");

        return withOnboardingRequestContext(context, async () => {
          const completed = await appStateGet(
            context.sessionId,
            FIRST_RUN_ONBOARDING_COMPLETED_KEY,
          );
          if (completed?.completed === true) {
            deleteCookie(event, FIRST_RUN_ONBOARDING_COOKIE, {
              ...crossSiteCookieAttrs(event),
              ...cookieDomainAttrs(),
              path: "/",
            });
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
            deleteCookie(event, FIRST_RUN_ONBOARDING_COOKIE, {
              ...crossSiteCookieAttrs(event),
              ...cookieDomainAttrs(),
              path: "/",
            });
            return { firstRun };
          }

          if (sharedCompletionEnabled) {
            const decoded = decodeSharedOnboardingCookie(
              getCookie(event, SHARED_ONBOARDING_COOKIE),
            );
            if (
              decoded &&
              decoded.emailHash === hashOnboardingEmail(userEmail)
            ) {
              if (decoded.role) {
                const profile = await getUserProfile(userEmail);
                if (!profile.onboardingRole) {
                  await updateUserOnboardingRole(userEmail, decoded.role);
                }
              }
              await appStatePut(
                context.sessionId,
                FIRST_RUN_ONBOARDING_COMPLETED_KEY,
                {
                  completed: true,
                  at: new Date().toISOString(),
                  source: "shared-cookie",
                },
                { requestSource: "agent" },
              );
              track(
                "onboarding_first_run_adopted",
                {
                  flow: "first_run",
                  source: "shared_cookie",
                  role: decoded.role,
                },
                { userId: userEmail },
              );
              deleteCookie(event, FIRST_RUN_ONBOARDING_COOKIE, {
                ...crossSiteCookieAttrs(event),
                ...cookieDomainAttrs(),
                path: "/",
              });
              return { firstRun: false };
            }
          }

          return { firstRun };
        });
      }),
    );

    getH3App(nitroApp).use(
      `${ONBOARDING_PREFIX}/first-run/role`,
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
        const body = (await readBody(event)) as { role?: unknown } | null;
        const parsed = onboardingRoleSchema.safeParse(body?.role);
        if (!parsed.success) {
          setResponseStatus(event, 400);
          return { error: "Invalid onboarding role" };
        }
        const roleCategory = getOnboardingRoleCategory(parsed.data);

        return withOnboardingRequestContext(context, async () => {
          const sessionId = readBrowserSessionIdHeader(event);
          const trackingSource = {
            userId: context.userEmail!,
            ...(sessionId ? { sessionId } : {}),
          };
          try {
            const savedRole = await updateUserOnboardingRole(
              context.userEmail!,
              parsed.data,
            );
            track(
              "onboarding.role_selected",
              {
                flow: "first_run",
                step_id: "role",
                role: roleCategory,
                outcome: "success",
              },
              trackingSource,
            );
            return { ok: true, role: savedRole };
          } catch (error) {
            track(
              "onboarding_role_save_failed",
              {
                flow: "first_run",
                step_id: "role",
                role: roleCategory,
                failure_type: classifyTrackingFailure(error),
              },
              trackingSource,
            );
            throw error;
          }
        });
      }),
    );

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
        const {
          cookieDomainAttrs,
          crossSiteCookieAttrs,
          isHttpsRequest,
          sharedFirstPartyCookieDomainAttrs,
        } = await import("../server/auth.js");
        await appStatePut(
          context.sessionId,
          FIRST_RUN_ONBOARDING_COMPLETED_KEY,
          { completed: true, at: new Date().toISOString() },
          { requestSource: "agent" },
        );
        deleteCookie(event, FIRST_RUN_ONBOARDING_COOKIE, {
          ...crossSiteCookieAttrs(event),
          ...cookieDomainAttrs(),
          path: "/",
        });
        if (sharedCompletionEnabled) {
          const role = await getUserProfile(context.userEmail).then(
            (profile) => profile.onboardingRole ?? null,
            // coercion-ok: the shared cookie is best-effort. A failed profile
            // read still shares the completion and only drops the role; the
            // sibling app then leaves its own role unset.
            () => null,
          );
          setCookie(
            event,
            SHARED_ONBOARDING_COOKIE,
            encodeSharedOnboardingCookie({ role, email: context.userEmail }),
            {
              ...sharedFirstPartyCookieDomainAttrs(),
              path: "/",
              httpOnly: true,
              sameSite: "lax",
              secure: isHttpsRequest(event),
              maxAge: SHARED_ONBOARDING_COOKIE_MAX_AGE,
            },
          );
        }
        return { ok: true };
      }),
    );
  };
}

export const defaultOnboardingPlugin: NitroPluginDef = createOnboardingPlugin();
