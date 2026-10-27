import { MCP_APP_CARDS_LAB } from "../labs/core-labs.js";
import { registerLabs } from "../labs/registry.js";
import { getUserLabEnabled } from "../labs/store.js";
import type { MCPCallerIdentity } from "./build-server.js";

// Env switches from #1411 that predate Labs. They no longer do anything.
const RETIRED_INLINE_ENV_VARS = [
  "AGENT_NATIVE_MCP_APPS_INLINE",
  "AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS",
] as const;

let warnedRetiredInlineEnv = false;

function warnIfRetiredInlineEnvSet(): void {
  if (warnedRetiredInlineEnv) return;
  const set = RETIRED_INLINE_ENV_VARS.filter((name) =>
    process.env[name]?.trim(),
  );
  if (set.length === 0) return;
  warnedRetiredInlineEnv = true;
  console.warn(
    `[mcp] ${set.join(" and ")} ${set.length === 1 ? "is" : "are"} ignored. ` +
      `MCP Apps cards are now the per-person "${MCP_APP_CARDS_LAB.displayName}" lab (${MCP_APP_CARDS_LAB.key}); ` +
      "each person turns it on in Settings → Labs.",
  );
}

/** Lists the lab in Settings → Labs for every app that mounts an MCP server. */
export function registerMcpAppCardsLab(): void {
  registerLabs([MCP_APP_CARDS_LAB]);
  warnIfRetiredInlineEnvSet();
}

/**
 * Whether this caller's own lab choice asks for MCP Apps cards. No email
 * (standalone stdio, a shared token with no owner) or a service principal
 * means no cards, since the lab is a person's choice. A choice that can't be
 * read, or a server that never registered the lab, also means no cards, and
 * logs why.
 */
export async function isMcpAppsInlineEnabled(
  identity: MCPCallerIdentity | undefined,
): Promise<boolean> {
  warnIfRetiredInlineEnvSet();
  const email = identity?.userEmail?.trim();
  if (!email || identity?.identityAssurance === "service") return false;
  try {
    return await getUserLabEnabled(
      email,
      MCP_APP_CARDS_LAB,
      identity?.orgId ? { orgId: identity.orgId } : {},
    );
  } catch (error) {
    console.warn(
      `[mcp] Couldn't read the "${MCP_APP_CARDS_LAB.key}" lab for this caller, so tools return plain results:`,
      error,
    );
    return false;
  }
}

export function _resetRetiredInlineEnvWarningForTests(): void {
  warnedRetiredInlineEnv = false;
}
