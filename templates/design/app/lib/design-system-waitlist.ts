import { agentNativePath } from "@agent-native/core/client/api-path";

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
