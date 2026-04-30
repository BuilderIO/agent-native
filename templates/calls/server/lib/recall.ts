import {
  resolveCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import { readAppSecret } from "@agent-native/core/secrets";
import { getCredentialContext } from "@agent-native/core/server/request-context";

export async function resolveRecallApiKey(
  ctx: CredentialContext | null = getCredentialContext(),
): Promise<string | undefined> {
  if (!ctx?.userEmail) return undefined;

  const userSecret = await readAppSecret({
    key: "RECALL_AI_API_KEY",
    scope: "user",
    scopeId: ctx.userEmail,
  }).catch(() => null);
  if (userSecret?.value) return userSecret.value;

  if (ctx.orgId) {
    const workspaceSecret = await readAppSecret({
      key: "RECALL_AI_API_KEY",
      scope: "workspace",
      scopeId: ctx.orgId,
    }).catch(() => null);
    if (workspaceSecret?.value) return workspaceSecret.value;
  }

  return resolveCredential("RECALL_AI_API_KEY", ctx);
}
