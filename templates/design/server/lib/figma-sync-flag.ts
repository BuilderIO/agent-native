import { fail } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";

import { FIGMA_SYNC } from "../../shared/design-flags.js";

export const FIGMA_SYNC_AGENT_ACTIONS = [
  "sync-figma-screen",
  "sync-figma-comments",
] as const;

export const FIGMA_SYNC_AGENT_INSTRUCTIONS = `When Design sync is enabled, use sync-figma-screen mode check before a pull or push. Pull only a source-only change. For a push, require a Design-only result, inspect the linked file and design system, then use the connected official remote use_figma tool with skillNames="figma-use" to update mapped nodes in place. Preserve nodes with no Design mapping and source properties the current Design model cannot represent; never replace the whole frame with a flat SVG. Return every changed node id and report unsupported properties. After the write, verify the same file and node again, then call sync-figma-screen mode record-push with the exact before and after source versions and node hashes plus the exported Design hash. If both sides changed, access is missing, the mapping is ambiguous, or any write is uncertain, stop without advancing the baseline. If the remote connection is unavailable, ask the user to connect it and stop; do not substitute SVG or code-layer export. Use sync-figma-comments for comment import and publishing; resolution only flows from the source into Design.`;

export function prepareFigmaSyncAgentRequest(
  input: { message: string; displayMessage?: string },
  enabled: boolean,
): { message: string; displayMessage: string } | undefined {
  if (!enabled) return undefined;
  return {
    message: `${input.message}\n\n${FIGMA_SYNC_AGENT_INSTRUCTIONS}`,
    displayMessage: input.displayMessage ?? input.message,
  };
}

export function filterFigmaSyncAgentActions(
  availableActionNames: readonly string[],
  enabled: boolean,
): string[] {
  if (enabled) return [...availableActionNames];
  const hidden = new Set<string>(FIGMA_SYNC_AGENT_ACTIONS);
  return availableActionNames.filter((name) => !hidden.has(name));
}

export async function isFigmaSyncEnabled(): Promise<boolean> {
  const userEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();
  return isFeatureFlagEnabled(FIGMA_SYNC, {
    ...(userEmail === undefined ? {} : { userEmail }),
    ...(orgId === undefined ? {} : { orgId }),
  });
}

export async function assertFigmaSyncEnabled(): Promise<void> {
  if (!(await isFigmaSyncEnabled())) {
    fail("Design sync is not enabled for this account.", {
      errorCode: "figma_sync_disabled",
      statusCode: 403,
    });
  }
}
