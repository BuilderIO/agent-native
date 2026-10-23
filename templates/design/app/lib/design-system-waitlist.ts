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
