import crypto from "node:crypto";

const DERIVED_SECRET_PREFIX = "agent-native:derived-secret:v1";

function isWorkspaceRuntime(): boolean {
  return (
    process.env.AGENT_NATIVE_WORKSPACE === "1" ||
    process.env.VITE_AGENT_NATIVE_WORKSPACE === "1"
  );
}

export function deriveServerSecret(
  rootSecret: string,
  purpose: string,
): string {
  return crypto
    .createHmac("sha256", rootSecret)
    .update(`${DERIVED_SECRET_PREFIX}:${purpose}`)
    .digest("hex");
}

export function getWorkspaceA2ADerivedSecret(
  purpose: "better-auth" | "oauth-state" | "short-lived-token",
): string | undefined {
  if (!isWorkspaceRuntime()) return undefined;
  const rootSecret = process.env.A2A_SECRET?.trim();
  return rootSecret ? deriveServerSecret(rootSecret, purpose) : undefined;
}
