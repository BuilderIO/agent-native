import { agentNativePath } from "@agent-native/core/client/api-path";

export type DesignSystemsWaitlistResult =
  | { status: "submitted" }
  | { status: "unavailable" }
  | { status: "failed" };

export async function submitDesignSystemsWaitlist(
  pageUrl: string,
): Promise<DesignSystemsWaitlistResult> {
  let response: Response;
  try {
    response = await fetch(
      agentNativePath("/_agent-native/builder/branch-waitlist"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl,
          source: "design_systems_page",
          useCase: "design_system_workflows_waitlist",
        }),
      },
    );
  } catch {
    return { status: "failed" };
  }

  if (!response.ok) return { status: "failed" };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "unavailable" };
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("formSubmitted" in payload) ||
    payload.formSubmitted !== true
  ) {
    return { status: "unavailable" };
  }

  return { status: "submitted" };
}

export async function submitDesignSystemWaitlist(): Promise<void> {
  const response = await fetch(
    agentNativePath("/_agent-native/builder/branch-waitlist"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "design_systems_empty_state",
        useCase: "design_system_waitlist",
      }),
    },
  );

  const responseText = await response.text();
  let payload: { error?: unknown; formSubmitted?: unknown } | null = null;
  if (responseText) {
    try {
      const parsed: unknown = JSON.parse(responseText);
      if (parsed !== null && typeof parsed === "object") {
        payload = parsed as { error?: unknown; formSubmitted?: unknown };
      }
    } catch {
      throw new Error("Invalid waitlist response");
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Waitlist request failed",
    );
  }
  if (payload?.formSubmitted !== true) {
    throw new Error("Waitlist signup is unavailable");
  }
}
