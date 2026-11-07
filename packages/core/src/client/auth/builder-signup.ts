import { agentNativePath } from "../api-path.js";

export type BuilderSignupAssignment =
  | {
      status: "assigned";
      id: string;
      variant: "control" | "automatic";
      policy: string;
    }
  | { status: "disabled" }
  | { status: "unavailable" };

async function request(
  body?: Record<string, unknown>,
  signal: AbortSignal = AbortSignal.timeout(8000),
): Promise<Record<string, unknown>> {
  const response = await fetch(
    agentNativePath("/_agent-native/auth/builder-signup-experiment"),
    {
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      credentials: "same-origin",
      signal,
    },
  );
  if (!response.ok)
    throw new Error(`Builder signup request failed (${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Invalid Builder signup response");
  return result as Record<string, unknown>;
}

export async function getBuilderSignupAssignment(): Promise<BuilderSignupAssignment> {
  const result = await request();
  if (result.status === "disabled") return { status: "disabled" };
  if (
    result.status === "assigned" &&
    typeof result.id === "string" &&
    typeof result.policy === "string" &&
    (result.variant === "control" || result.variant === "automatic")
  )
    return {
      status: "assigned",
      id: result.id,
      policy: result.policy,
      variant: result.variant,
    };
  throw new Error("Invalid Builder signup assignment");
}

export async function acceptBuilderSignupAssignment(
  assignmentId: string,
  attemptId: string,
  method: "password" | "magic-link" | "google",
  email?: string,
): Promise<void> {
  const result = await request({
    operation: "accept",
    assignmentId,
    attemptId,
    method,
    ...(email ? { email } : {}),
  });
  if (result.status !== "accepted")
    throw new Error("Builder signup acceptance was not recorded");
}

export async function activateBuilderSignupAssignment(): Promise<
  "connected" | "fallback" | "disabled"
> {
  const deadline = Date.now() + 30000;
  const signal = AbortSignal.timeout(30000);
  try {
    while (Date.now() < deadline) {
      const result = await request({ operation: "activate" }, signal);
      if (
        result.status === "connected" ||
        result.status === "fallback" ||
        result.status === "disabled"
      )
        return result.status;
      if (result.status !== "pending")
        throw new Error("Builder signup activation did not complete");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))),
      );
    }
    throw new Error("Builder signup activation is still pending");
  } finally {
    if (typeof document !== "undefined")
      document.cookie =
        "an_builder_signup_pending=; Path=/; Max-Age=0; SameSite=Lax";
  }
}

export function hasPendingBuilderSignupAssignment(): boolean {
  return (
    typeof document !== "undefined" &&
    document.cookie
      .split(";")
      .some((value) => value.trim() === "an_builder_signup_pending=1")
  );
}
