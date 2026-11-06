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
const COOKIE = "an_builder_signup";
const TTL = 7 * 24 * 60 * 60;
const assignmentSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  variant: z.enum(["control", "automatic"]),
  issuedAt: z.number().int(),
  acceptedAt: z.number().int().optional(),
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
  setCookie(event, COOKIE, encodeBuilderSignupAssignment(assignment), {
    httpOnly: true,
    secure:
      getHeader(event, "x-forwarded-proto") === "https" ||
      getHeader(event, "host")?.includes("localhost") !== true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL,
  });
}

export function createBuilderSignupExperimentHandler(dependencies: {
  getSession: (event: H3Event) => Promise<AuthSession | null>;
  sameOrigin: (event: H3Event) => boolean;
  activate: (
    event: H3Event,
    session: AuthSession,
  ) => Promise<{ ok: boolean; code?: string }>;
}) {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, "Cache-Control", "no-store");
    const refuse = (status: number, code: string) => {
      setResponseStatus(event, status);
      return { status: "unavailable" as const, code };
    };
    if (!getAppConfig().onboarding.builderSignupExperiment)
      return { status: "disabled" as const };
    const method = getMethod(event);
    if (method !== "GET" && method !== "POST")
      return refuse(405, "method_not_allowed");
    if (!dependencies.sameOrigin(event)) return refuse(403, "cross_origin");
    const session = await dependencies.getSession(event);
    let assignment = decodeBuilderSignupAssignment(getCookie(event, COOKIE));
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
      assignment = { ...assignment, acceptedAt: Date.now() };
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
    if (!assignment.acceptedAt) return terminal("fallback");
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
      return status === "started"
        ? { status: "pending" as const }
        : terminal(status);
    }
    const attempt = randomBytes(16).toString("hex");
    const record = await mutateSetting(
      key,
      (current) =>
        current ?? {
          ...assignment,
          status: "started",
          attempt,
          userId: session.userId,
        },
    );
    if (record.attempt !== attempt) return { status: "pending" as const };
    const result =
      assignment.variant === "control"
        ? { ok: false, code: "control" }
        : await dependencies.activate(event, session);
    const status = result.ok ? "connected" : "fallback";
    await putSetting(key, {
      ...record,
      status,
      code: result.code ?? null,
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
