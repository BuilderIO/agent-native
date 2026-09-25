import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  clearDefaultAgentEngineSelection,
  recordDefaultAgentEngineRefusal,
  resolveDefaultAgentEngineAuthority,
} from "../agent/default-agent-engine.js";
import { getOrgContext } from "../org/context.js";
import { getSession } from "./auth.js";
import { runWithRequestContext } from "./request-context.js";

export const AGENT_ENGINE_DISCONNECT_ACTION_NAME = "agent-engine-disconnect";
export const AGENT_ENGINE_API_KEY_ACTION_NAME = "agent-engine-api-key";

/**
 * POST /_agent-native/agent-engine/disconnect — clear the default model for
 * the caller's organization (owners and admins), or for a signed-in user with
 * no organization. Env vars are left alone so the next chat turn falls back to
 * resolveEngine's credential detection.
 */
export function createAgentEngineDisconnectHandler() {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }
    try {
      const session = await getSession(event);
      if (!session?.email) {
        setResponseStatus(event, 401);
        return { error: "unauthorized" };
      }
      // Not caught separately: an unreadable org context must not downgrade an
      // org member's clear to a personal one that answers "ok" and changes
      // nothing.
      const orgCtx = await getOrgContext(event);
      const ctx = { userEmail: session.email, orgId: orgCtx.orgId };
      const meta = {
        actionName: AGENT_ENGINE_DISCONNECT_ACTION_NAME,
        caller: "http" as const,
      };
      const authority = await resolveDefaultAgentEngineAuthority(ctx);
      if (!authority.allowed) {
        await recordDefaultAgentEngineRefusal(ctx, authority, "clear", meta);
        setResponseStatus(event, 403);
        return { ok: false, error: authority.message };
      }
      await clearDefaultAgentEngineSelection(authority, meta);
      return { ok: true, scope: authority.scope };
    } catch (err) {
      console.error("[agent-engine/disconnect] failed", err);
      setResponseStatus(event, 500);
      return { ok: false, error: "Could not clear the default model." };
    }
  });
}

export interface DefaultModelSelectionRequest {
  engine: string;
  model?: string;
}

/**
 * Parse the optional `defaultModel: { engine, model }` field of a provider-key
 * save. Present means "also make this the default model when I may".
 */
export function readDefaultModelSelectionRequest(
  body: unknown,
):
  | { ok: true; request: DefaultModelSelectionRequest | null }
  | { ok: false; error: string } {
  const raw =
    body && typeof body === "object"
      ? (body as { defaultModel?: unknown }).defaultModel
      : undefined;
  if (raw == null) return { ok: true, request: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "defaultModel must be an object." };
  }
  const { engine, model } = raw as { engine?: unknown; model?: unknown };
  if (typeof engine !== "string" || !engine.trim()) {
    return { ok: false, error: "defaultModel.engine is required." };
  }
  if (model != null && typeof model !== "string") {
    return { ok: false, error: "defaultModel.model must be a string." };
  }
  return {
    ok: true,
    request: {
      engine: engine.trim(),
      ...(model?.trim() ? { model: model.trim() } : {}),
    },
  };
}

/**
 * What a provider-key save did to the default model. `skipped` is not a
 * failure: members, and owners or admins saving a personal key, only save the
 * key because the default model uses organization providers.
 */
export type SavedKeyDefaultModelOutcome =
  | { status: "selected"; engine: string; model: string }
  | { status: "skipped"; reason: "not-allowed" | "personal-key" }
  | { status: "failed"; error: string };

/**
 * After a provider key is saved, make it the default model when the key and
 * the default share a scope and the caller may change the default. This is
 * what lets one Save replace the old Save-then-Apply.
 */
export async function selectDefaultModelForSavedKey(
  event: H3Event,
  input: {
    keyScope: "user" | "org";
    keyScopeId: string;
    request: DefaultModelSelectionRequest;
  },
): Promise<SavedKeyDefaultModelOutcome> {
  try {
    const session = await getSession(event);
    const userEmail = session?.email;
    if (!userEmail) return { status: "skipped", reason: "not-allowed" };
    let orgId: string | null;
    if (input.keyScope === "org") {
      orgId = input.keyScopeId;
    } else {
      orgId = (await getOrgContext(event)).orgId;
      if (orgId) return { status: "skipped", reason: "personal-key" };
    }
    const ctx = { userEmail, orgId };
    // Loaded here so the key-save route doesn't pull the engine registry into
    // its module graph for saves that don't touch the default.
    const { selectDefaultAgentEngine } =
      await import("../scripts/agent-engines/set-agent-engine.js");
    const result = await runWithRequestContext(
      { userEmail, ...(orgId ? { orgId } : {}) },
      () =>
        selectDefaultAgentEngine(
          input.request,
          { actionName: AGENT_ENGINE_API_KEY_ACTION_NAME, caller: "http" },
          ctx,
        ),
    );
    if (result.status === "selected") {
      return { status: "selected", engine: result.engine, model: result.model };
    }
    if (result.status === "refused") {
      return { status: "skipped", reason: "not-allowed" };
    }
    return { status: "failed", error: result.message };
  } catch (err) {
    console.error("[agent-engine/api-key] default model selection failed", err);
    return {
      status: "failed",
      error: "The key was saved, but the default model could not be changed.",
    };
  }
}
