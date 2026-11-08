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
import { getSetting, mutateSetting } from "../settings/store.js";
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
const consentSchema = assignmentSchema.extend({
  variant: z.literal("automatic"),
  acceptedAt: z.number().int(),
  attemptId: z.string().min(16).max(128),
  userId: z.string().min(1),
  email: z.string().email(),
  method: z.enum(["password", "magic-link", "google"]),
});

function hasSignupConsentOwnership(
  consent: z.infer<typeof consentSchema>,
  original: Assignment | null,
): boolean {
  // Google and email-link bindings happen after ownership verification.
  // Password binding happens before verification, so retain its browser binding.
  if (consent.method !== "password") return true;
  return (
    original?.id === consent.id &&
    original.attemptId === consent.attemptId &&
    original.acceptedAt === consent.acceptedAt &&
    original.method === "password"
  );
}

function experimentProperties(
  assignment?: Assignment,
): Record<string, unknown> {
  return {
    app_name: "design",
    template_name: "design",
    experiment_id: BUILDER_SIGNUP_EXPERIMENT,
    ...(assignment
      ? { experiment_variant: assignment.variant, assignment_id: assignment.id }
      : {}),
  };
}

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
  const normalizedEmail = email.trim().toLowerCase();
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
    createdAtMs < assignment.issuedAt
  )
    return false;
  track(
    "builder_signup_experiment_enrolled",
    { ...experimentProperties(assignment), method },
    { authUserId: identity.user.id, userId: normalizedEmail },
  );
  if (assignment.variant === "control") {
    const key = `${BUILDER_SIGNUP_EXPERIMENT}:${identity.user.id}`;
    const record = await mutateSetting(
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
    if (record.id === assignment.id && record.status === "control") {
      track(
        "builder_signup_experiment_outcome",
        {
          ...experimentProperties(assignment),
          status: "control",
        },
        { authUserId: identity.user.id, userId: normalizedEmail },
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
  if (
    assignment.method !== method ||
    (assignment.email && assignment.email !== normalizedEmail)
  )
    return false;
  if (createdAtMs < assignment.acceptedAt) return false;
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

async function finishSignupActivation(
  key: string,
  attempt: string,
  outcome: {
    status: "connected" | "fallback";
    code?: string;
    message?: string;
  },
) {
  const committed = await mutateSetting(key, (current) => {
    if (!current || current.attempt !== attempt)
      throw new Error("Signup activation reservation ownership changed");
    const status = z
      .enum(["started", "connected", "fallback"])
      .parse(current.status);
    if (status !== "started") return current;
    return {
      ...current,
      status: outcome.status,
      code: outcome.code ?? null,
      message: outcome.message ?? null,
      completedAt: Date.now(),
    };
  });
  return z
    .object({
      status: z.enum(["connected", "fallback"]),
      code: z.string().nullable().optional(),
    })
    .parse(committed);
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
    if (!isBuilderSignupExperimentEnabled()) {
      if (getCookie(event, "an_builder_signup_pending"))
        deleteCookie(event, "an_builder_signup_pending", { path: "/" });
      return { status: "disabled" as const };
    }
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
        operation: z.enum(["accept", "activate", "status"]),
        assignmentId: z.string().optional(),
        attemptId: z.string().min(16).max(128).optional(),
        method: z.enum(["password", "magic-link", "google"]).optional(),
        email: z.string().email().max(320).optional(),
      })
      .safeParse(await readBodyWithSizeLimit(event, 4096));
    if (!body.success) return refuse(400, "invalid_request");
    // Consent was bound to the newly created identity during signup. Browser
    // cookies are transport hints; a callback or later visit can lose them.
    const consent =
      body.data.operation !== "accept" &&
      session?.emailVerified &&
      session.userId
        ? await getSetting(
            `${BUILDER_SIGNUP_EXPERIMENT}:consent:${session.userId}`,
          )
        : null;
    if (consent && session?.userId) {
      const saved = consentSchema.safeParse(consent);
      if (
        !saved.success ||
        saved.data.issuedAt > saved.data.acceptedAt ||
        saved.data.acceptedAt > Date.now() ||
        saved.data.userId !== session.userId ||
        saved.data.email !== session.email.trim().toLowerCase()
      ) {
        track(
          "builder_signup_experiment_activation_unavailable",
          {
            ...experimentProperties(assignment ?? undefined),
            code: "consent_invalid",
          },
          { userId: session.email, authUserId: session.userId },
        );
        return refuse(409, "consent_invalid");
      }
      if (!hasSignupConsentOwnership(saved.data, assignment)) {
        deleteCookie(event, "an_builder_signup_pending", { path: "/" });
        return {
          status: "disabled" as const,
          code: "password_acceptance_cookie_required",
        };
      }
      assignment = saved.data;
    }
    if (body.data.operation === "status") {
      if (!session?.emailVerified || !session.userId)
        return refuse(401, "verified_session_required");
      if (!consent) {
        deleteCookie(event, "an_builder_signup_pending", { path: "/" });
        return { status: "disabled" as const, code: "not_enrolled" };
      }
      const existing = await getSetting(
        `${BUILDER_SIGNUP_EXPERIMENT}:${session.userId}`,
      );
      if (existing) {
        const status = z
          .enum(["started", "connected", "fallback"])
          .parse(existing.status);
        deleteCookie(event, "an_builder_signup_pending", { path: "/" });
        return {
          status: "disabled" as const,
          code:
            status === "started"
              ? "activation_in_progress"
              : "already_completed",
        };
      }
      return { status: "eligible" as const };
    }
    if (
      !assignment &&
      body.data.operation === "activate" &&
      session?.emailVerified &&
      session.userId
    ) {
      deleteCookie(event, "an_builder_signup_pending", { path: "/" });
      return { status: "disabled" as const, code: "not_enrolled" };
    }
    if (!assignment) {
      deleteCookie(event, "an_builder_signup_pending", { path: "/" });
      if (body.data.operation === "activate") {
        if (session?.emailVerified && session.userId)
          track(
            "builder_signup_experiment_unattributed",
            {
              ...experimentProperties(),
              code: "assignment_missing",
            },
            { userId: session.email, authUserId: session.userId },
          );
        return { status: "fallback" as const, code: "assignment_missing" };
      }
      return refuse(409, "assignment_missing");
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
    const trackingSource = {
      userId: session.email,
      authUserId: session.userId,
    };
    const terminal = (
      status: "connected" | "fallback",
      code?: string,
      replayed = false,
      durationMs?: number,
    ) => {
      track(
        "builder_signup_experiment_outcome",
        {
          ...experimentProperties(assignment),
          status,
          code: code ?? status,
          replayed,
          ...(durationMs === undefined
            ? {}
            : { activation_duration_ms: durationMs }),
        },
        trackingSource,
      );
      deleteCookie(event, "an_builder_signup_pending", { path: "/" });
      return { status, ...(code ? { code } : {}) };
    };
    if (assignment.variant !== "automatic")
      return terminal("fallback", "control");
    if (!assignment.acceptedAt || !assignment.attemptId)
      return terminal("fallback", "acceptance_missing");
    if (
      !consent ||
      consent.attemptId !== assignment.attemptId ||
      consent.id !== assignment.id ||
      consent.userId !== session.userId ||
      consent.email !== session.email.trim().toLowerCase()
    )
      return terminal("fallback", "signup_attempt_unbound");
    const adapter = await getBetterAuthInternalAdapter();
    if (!adapter) {
      track(
        "builder_signup_experiment_activation_unavailable",
        {
          ...experimentProperties(assignment),
          code: "identity_unavailable",
        },
        { userId: session.email, authUserId: session.userId },
      );
      return refuse(503, "identity_unavailable");
    }
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
      return terminal("fallback", "identity_ineligible");
    const key = `${BUILDER_SIGNUP_EXPERIMENT}:${session.userId}`;
    const existing = await getSetting(key);
    if (existing) {
      const status = z
        .enum(["started", "connected", "fallback"])
        .parse(existing.status);
      if (status !== "started")
        return terminal(
          status,
          z.string().nullable().optional().parse(existing.code) ?? undefined,
          true,
        );
      return { status: "pending" as const };
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
    track(
      "builder_signup_experiment_activation_started",
      {
        ...experimentProperties(assignment),
      },
      { userId: session.email, authUserId: session.userId },
    );
    let result: { ok: boolean; code?: string; message?: string };
    try {
      result = await dependencies.activate(event, session);
    } catch {
      result = { ok: false, code: "activation_interrupted" };
    }
    const committed = await finishSignupActivation(key, attempt, {
      status: result.ok ? "connected" : "fallback",
      ...(result.code ? { code: result.code } : {}),
      ...(result.message ? { message: result.message } : {}),
    });
    const status = committed.status;
    return terminal(
      status,
      committed.code ?? undefined,
      false,
      Date.now() - z.number().parse(record.startedAt),
    );
  });
}
