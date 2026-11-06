import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import {
  defineEventHandler,
  deleteCookie,
  getCookie,
  getHeader,
  getMethod,
  setCookie,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { z } from "zod";

import { getAppConfig } from "../app-config/index.js";
import { getSetting, mutateSetting, putSetting } from "../settings/store.js";
import { track } from "../tracking/index.js";
import type { AuthSession } from "./auth.js";
import {
  getAuthSecret,
  getBetterAuthInternalAdapter,
} from "./better-auth-instance.js";
import { readBodyWithSizeLimit } from "./h3-helpers.js";

export const BUILDER_SIGNUP_EXPERIMENT = "design_builder_signup_v1";
export const BUILDER_SIGNUP_POLICY = "builder-signup-2026-11-06";
export const BUILDER_SIGNUP_COOKIE = "an_builder_signup";
const TTL = 7 * 24 * 60 * 60;
const assignmentSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  variant: z.enum(["control", "automatic"]),
  issuedAt: z.number().int(),
  acceptedAt: z.number().int().optional(),
  attemptId: z.string().min(16).max(128).optional(),
  method: z.enum(["password", "magic-link", "google"]).optional(),
  email: z.string().email().max(320).optional(),
  policy: z.literal(BUILDER_SIGNUP_POLICY),
});
type Assignment = z.infer<typeof assignmentSchema>;

function mac(body: string): Buffer {
  return createHmac("sha256", getAuthSecret())
    .update(`${BUILDER_SIGNUP_EXPERIMENT}:${body}`)
    .digest();
}

export function encodeBuilderSignupAssignment(assignment: Assignment): string {
  const body = Buffer.from(JSON.stringify(assignment)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function decodeBuilderSignupAssignment(
  value: string | undefined,
): Assignment | null {
  if (!value || value.length > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  const expected = mac(body);
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    // coercion-ok: malformed anonymous cookies are rejected, never used as consent.
    return null;
  }
  const parsed = assignmentSchema.safeParse(json);
  if (!parsed.success) return null;
  const assignment = parsed.data;
  if (
    assignment.issuedAt > Date.now() ||
    Date.now() - assignment.issuedAt > TTL * 1000
  )
    return null;
  if (
    assignment.acceptedAt !== undefined &&
    (assignment.acceptedAt < assignment.issuedAt ||
      assignment.acceptedAt > Date.now())
  )
    return null;
  return assignment;
}

function writeAssignment(event: H3Event, assignment: Assignment): void {
  setCookie(
    event,
    BUILDER_SIGNUP_COOKIE,
    encodeBuilderSignupAssignment(assignment),
    {
      httpOnly: true,
      secure:
        getHeader(event, "x-forwarded-proto") === "https" ||
        getHeader(event, "host")?.includes("localhost") !== true,
      sameSite: "lax",
      path: "/",
      maxAge: TTL,
    },
  );
}

export function isBuilderSignupExperimentEnabled(): boolean {
  const config = getAppConfig().onboarding;
  return (
    config.builderSignupExperimentOverride ?? config.builderSignupExperiment
  );
}

export async function bindBuilderSignupAttempt(
  event: H3Event,
  attemptId: unknown,
  method: "password" | "magic-link" | "google",
  email: string,
): Promise<boolean> {
  if (!isBuilderSignupExperimentEnabled()) return false;
  const assignment = decodeBuilderSignupAssignment(
    getCookie(event, BUILDER_SIGNUP_COOKIE),
  );
  if (!assignment) return false;
  if (assignment.variant === "control") {
    const adapter = await getBetterAuthInternalAdapter();
    if (!adapter) throw new Error("Signup identity store is unavailable");
    const identity = await adapter.findUserByEmail(email, {
      includeAccounts: false,
    });
    const createdAt = identity?.user.createdAt;
    const createdAtMs = createdAt ? new Date(createdAt).getTime() : Number.NaN;
    if (
      !identity ||
      !Number.isFinite(createdAtMs) ||
      createdAtMs < assignment.issuedAt
    )
      return false;
    const key = `${BUILDER_SIGNUP_EXPERIMENT}:${identity.user.id}`;
    if (!(await getSetting(key))) {
      await mutateSetting(
        key,
        (current) =>
          current ?? {
            id: assignment.id,
            variant: "control",
            issuedAt: assignment.issuedAt,
            policy: assignment.policy,
            userId: identity.user.id,
            status: "control",
          },
      );
      track(
        "builder_signup_experiment_outcome",
        {
          experiment_id: BUILDER_SIGNUP_EXPERIMENT,
          experiment_variant: "control",
          assignment_id: assignment.id,
          status: "control",
        },
        { authUserId: identity.user.id, userId: email },
      );
    }
    return false;
  }
  if (
    typeof attemptId !== "string" ||
    attemptId.length > 128 ||
    !assignment.acceptedAt ||
    assignment.attemptId !== attemptId
  )
    return false;
  const key = `${BUILDER_SIGNUP_EXPERIMENT}:attempt:${attemptId}`;
  const normalizedEmail = email.trim().toLowerCase();
  if (
    assignment.method !== method ||
    (assignment.email && assignment.email !== normalizedEmail)
  )
    return false;
  const adapter = await getBetterAuthInternalAdapter();
  if (!adapter) throw new Error("Signup identity store is unavailable");
  const identity = await adapter.findUserByEmail(normalizedEmail, {
    includeAccounts: false,
  });
  const createdAt = identity?.user.createdAt;
  const createdAtMs = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  if (
    !identity ||
    !Number.isFinite(createdAtMs) ||
    createdAtMs < assignment.acceptedAt
  )
    return false;
  const bound = z
    .object({ id: z.string(), boundUserId: z.string() })
    .parse(
      await mutateSetting(
        key,
        (current) =>
          current ?? { id: assignment.id, boundUserId: identity.user.id },
      ),
    );
  if (bound.id !== assignment.id || bound.boundUserId !== identity.user.id)
    return false;
  await mutateSetting(
    `${BUILDER_SIGNUP_EXPERIMENT}:consent:${identity.user.id}`,
    (current) =>
      current ?? {
        ...assignment,
        userId: identity.user.id,
        email: normalizedEmail,
      },
  );
  setCookie(event, "an_builder_signup_pending", "1", {
    path: "/",
    sameSite: "lax",
    maxAge: TTL,
    secure: getHeader(event, "host")?.includes("localhost") !== true,
  });
  return true;
}

export async function getBuilderSignupConnectError(
  userId: string | undefined,
): Promise<
  { code: "account_exists"; message: string; at: number } | undefined
> {
  if (!userId || !isBuilderSignupExperimentEnabled()) return undefined;
  const record = await getSetting(`${BUILDER_SIGNUP_EXPERIMENT}:${userId}`);
  if (record?.status !== "fallback" || record.code !== "account_exists")
    return undefined;
  const error = z
    .object({ message: z.string(), completedAt: z.number().finite() })
    .parse(record);
  return {
    code: "account_exists",
    message: error.message,
    at: error.completedAt,
  };
}

export function createBuilderSignupExperimentHandler(dependencies: {
  getSession: (event: H3Event) => Promise<AuthSession | null>;
  sameOrigin: (event: H3Event) => boolean;
  activate: (
    event: H3Event,
    session: AuthSession,
  ) => Promise<{ ok: boolean; code?: string; message?: string }>;
}) {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, "Cache-Control", "no-store");
    const refuse = (status: number, code: string) => {
      setResponseStatus(event, status);
      return { status: "unavailable" as const, code };
    };
    if (!isBuilderSignupExperimentEnabled())
      return { status: "disabled" as const };
    const method = getMethod(event);
    if (method !== "GET" && method !== "POST")
      return refuse(405, "method_not_allowed");
    if (!dependencies.sameOrigin(event)) return refuse(403, "cross_origin");
    const session = await dependencies.getSession(event);
    let assignment = decodeBuilderSignupAssignment(
      getCookie(event, BUILDER_SIGNUP_COOKIE),
    );
    if (method === "GET") {
      if (session) return { status: "disabled" as const };
      if (!assignment) {
        assignment = {
          id: randomBytes(16).toString("hex"),
          variant: randomInt(2) === 0 ? "control" : "automatic",
          issuedAt: Date.now(),
          policy: BUILDER_SIGNUP_POLICY,
        };
        writeAssignment(event, assignment);
      }
      return { status: "assigned" as const, ...assignment };
    }
    if (
      !/^application\/json\s*(;|$)/i.test(
        getHeader(event, "content-type") ?? "",
      )
    )
      return refuse(415, "json_required");
    const body = z
      .object({
        operation: z.enum(["accept", "activate"]),
        assignmentId: z.string().optional(),
        attemptId: z.string().min(16).max(128).optional(),
        method: z.enum(["password", "magic-link", "google"]).optional(),
        email: z.string().email().max(320).optional(),
      })
      .safeParse(await readBodyWithSizeLimit(event, 4096));
    if (!body.success) return refuse(400, "invalid_request");
    if (!assignment) {
      deleteCookie(event, "an_builder_signup_pending", { path: "/" });
      return body.data.operation === "activate"
        ? { status: "fallback" as const }
        : refuse(409, "assignment_missing");
    }
    if (body.data.operation === "accept") {
      if (session || body.data.assignmentId !== assignment.id)
        return refuse(409, "assignment_mismatch");
      if (assignment.variant !== "automatic")
        return { status: "not_required" as const };
      if (
        !body.data.attemptId ||
        !body.data.method ||
        (body.data.method !== "google" && !body.data.email)
      )
        return refuse(400, "attempt_required");
      assignment = {
        ...assignment,
        acceptedAt: Date.now(),
        attemptId: body.data.attemptId,
        method: body.data.method,
        ...(body.data.email
          ? { email: body.data.email.trim().toLowerCase() }
          : {}),
      };
      writeAssignment(event, assignment);
      setCookie(event, "an_builder_signup_pending", "1", {
        path: "/",
        sameSite: "lax",
        maxAge: TTL,
        secure: getHeader(event, "host")?.includes("localhost") !== true,
      });
      return { status: "accepted" as const };
    }
    if (!session?.emailVerified || !session.userId)
      return refuse(401, "verified_session_required");
    const terminal = (status: "connected" | "fallback", code?: string) => {
      deleteCookie(event, "an_builder_signup_pending", { path: "/" });
      return { status, ...(code ? { code } : {}) };
    };
    if (assignment.variant !== "automatic")
      return terminal("fallback", "control");
    if (!assignment.acceptedAt || !assignment.attemptId)
      return terminal("fallback");
    const consent = await getSetting(
      `${BUILDER_SIGNUP_EXPERIMENT}:consent:${session.userId}`,
    );
    if (
      !consent ||
      consent.attemptId !== assignment.attemptId ||
      consent.id !== assignment.id ||
      consent.userId !== session.userId ||
      consent.email !== session.email.trim().toLowerCase()
    )
      return terminal("fallback", "signup_attempt_unbound");
    const adapter = await getBetterAuthInternalAdapter();
    if (!adapter) return refuse(503, "identity_unavailable");
    const identity = await adapter.findUserByEmail(session.email, {
      includeAccounts: false,
    });
    const createdAt = identity?.user.createdAt;
    const createdAtMs = createdAt ? new Date(createdAt).getTime() : Number.NaN;
    if (
      !identity ||
      identity.user.id !== session.userId ||
      !Number.isFinite(createdAtMs) ||
      createdAtMs < assignment.acceptedAt
    )
      return terminal("fallback");
    const key = `${BUILDER_SIGNUP_EXPERIMENT}:${session.userId}`;
    const existing = await getSetting(key);
    if (existing) {
      const status = z
        .enum(["started", "connected", "fallback"])
        .parse(existing.status);
      if (status !== "started") return terminal(status);
      const startedAt = z.number().finite().parse(existing.startedAt);
      if (Date.now() - startedAt < 45000) return { status: "pending" as const };
      await mutateSetting(key, (current) =>
        current &&
        current.attempt === existing.attempt &&
        current.status === "started"
          ? {
              ...current,
              status: "fallback",
              code: "activation_interrupted",
              completedAt: Date.now(),
            }
          : (current ?? {
              ...existing,
              status: "fallback",
              code: "activation_interrupted",
            }),
      );
      return terminal("fallback", "activation_interrupted");
    }
    const attempt = randomBytes(16).toString("hex");
    const record = await mutateSetting(
      key,
      (current) =>
        current ?? {
          ...assignment,
          status: "started",
          startedAt: Date.now(),
          attempt,
          userId: session.userId,
        },
    );
    if (record.attempt !== attempt) return { status: "pending" as const };
    let result: { ok: boolean; code?: string; message?: string };
    try {
      result = await dependencies.activate(event, session);
    } catch {
      result = { ok: false, code: "activation_interrupted" };
    }
    const status = result.ok ? "connected" : "fallback";
    await putSetting(key, {
      ...record,
      status,
      code: result.code ?? null,
      message: result.message ?? null,
      completedAt: Date.now(),
    });
    track(
      "builder_signup_experiment_outcome",
      {
        experiment_id: BUILDER_SIGNUP_EXPERIMENT,
        experiment_variant: assignment.variant,
        assignment_id: assignment.id,
        status,
        code: result.code ?? null,
      },
      { userId: session.email, authUserId: session.userId },
    );
    return terminal(status, result.code);
  });
}
