/**
 * Onboarding plugin — auto-mounts the `/_agent-native/onboarding/*` routes.
 *
 * Routes:
 *   GET  /_agent-native/onboarding/steps              — list steps + completion
 *   POST /_agent-native/onboarding/steps/:id/complete — manual override (marks complete)
 *   POST /_agent-native/onboarding/dismiss            — dismiss the banner
 *   GET  /_agent-native/onboarding/dismissed          — dismissed flag + allComplete
 */

import {
  defineEventHandler,
  getMethod,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  awaitBootstrap,
  getH3App,
} from "../server/framework-request-handler.js";
import { appStateGet, appStatePut } from "../application-state/store.js";
import { getSession } from "../server/auth.js";
import { listOnboardingSteps } from "./registry.js";
import { registerDefaultOnboardingSteps } from "./default-steps.js";
import type { OnboardingStepStatus } from "./types.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

const ONBOARDING_PREFIX = "/_agent-native/onboarding";
const OVERRIDE_KEY_PREFIX = "onboarding:override:";
const DISMISSED_KEY = "onboarding:dismissed";

export interface OnboardingPluginOptions {
  /** Skip registering the built-in default steps (llm, database, auth). */
  skipDefaultSteps?: boolean;
}

/** Resolve the session id to use for application-state scoping. */
async function resolveSessionId(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session) return "local";
  if (session.email === "local@localhost") return "local";
  return session.email;
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
  sessionId: string,
  options: { preview?: boolean } = {},
): Promise<OnboardingStepStatus[]> {
  const steps = listOnboardingSteps();
  const out: OnboardingStepStatus[] = [];
  for (const step of steps) {
    let complete = false;
    if (!options.preview) {
      try {
        complete = (await step.isComplete()) === true;
      } catch {
        complete = false;
      }
      if (!complete) {
        complete = await hasOverride(sessionId, step.id);
      }
    }
    out.push({
      id: step.id,
      title: step.title,
      description: step.description,
      order: step.order,
      required: step.required ?? false,
      complete,
      methods: step.methods,
    });
  }
  return out;
}

function allRequiredComplete(statuses: OnboardingStepStatus[]): boolean {
  return statuses.filter((s) => s.required).every((s) => s.complete);
}

export function createOnboardingPlugin(
  options: OnboardingPluginOptions = {},
): NitroPluginDef {
  return async (nitroApp: any) => {
    await awaitBootstrap(nitroApp);

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
          const sessionId = await resolveSessionId(event);
          const query = getQuery(event) as Record<string, unknown>;
          const preview = query.preview === "1" || query.preview === 1;
          return serializeSteps(sessionId, { preview });
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
          const sessionId = await resolveSessionId(event);
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
        const sessionId = await resolveSessionId(event);
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
        const sessionId = await resolveSessionId(event);
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
        const sessionId = await resolveSessionId(event);
        // On flaky networks (or transient Neon hiccups) the DB call below
        // can throw — return safe defaults so a transient connection error
        // doesn't surface as a 500 to the client.
        try {
          const value = await appStateGet(sessionId, DISMISSED_KEY);
          const dismissed = !!(
            value && (value as { dismissed?: boolean }).dismissed
          );
          const statuses = await serializeSteps(sessionId);
          return {
            dismissed,
            allComplete: allRequiredComplete(statuses),
          };
        } catch {
          return { dismissed: false, allComplete: false };
        }
      }),
    );
  };
}

/** Default plugin instance — mounted automatically when a template doesn't override. */
export const defaultOnboardingPlugin: NitroPluginDef = createOnboardingPlugin();
