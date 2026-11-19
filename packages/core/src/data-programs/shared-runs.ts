import { resolveCredentialDetailed } from "../credentials/index.js";
import {
  runWithoutCredentialUseLedger,
  type CredentialUse,
} from "../credentials/use-ledger.js";
import { runWithRequestContext } from "../server/request-context.js";

export const SHAREABLE_BRIDGE_TOOLS: ReadonlySet<string> = new Set([
  "provider-api-request",
]);

export interface OrgSharingViewer {
  userEmail: string;
  orgId: string;
}

function isOrgCredential(
  scope: string | null,
  scopeId: string | null,
  orgId: string,
): boolean {
  return (scope === "org" || scope === "workspace") && scopeId === orgId;
}

function isOrgSharedUse(
  use: CredentialUse,
  uses: readonly CredentialUse[],
  orgId: string,
): boolean {
  if (use.kind === "stored") {
    return use.scope === null || isOrgCredential(use.scope, use.scopeId, orgId);
  }
  if (use.kind === "provider-request") return true;
  if (use.kind !== "provider-auth") return false;
  if (use.source === "workspace_connection") return false;
  if (use.connectionId !== null || use.accountId !== null) return false;
  if (!isOrgCredential(use.scope, use.scopeId, orgId)) return false;
  return uses.some(
    (stored) =>
      stored.kind === "stored" &&
      stored.key === use.key &&
      stored.scope === use.scope &&
      stored.scopeId === use.scopeId,
  );
}

export function isOrgShareableRun(input: {
  uses: readonly CredentialUse[];
  bridgeToolsUsed: readonly string[];
  orgId: string;
}): boolean {
  if (input.bridgeToolsUsed.some((tool) => !SHAREABLE_BRIDGE_TOOLS.has(tool))) {
    return false;
  }
  return input.uses.every((use) =>
    isOrgSharedUse(use, input.uses, input.orgId),
  );
}

function isCredentialUse(value: unknown): value is CredentialUse {
  if (!value || typeof value !== "object") return false;
  const use = value as Record<string, unknown>;
  const isText = (field: string) => typeof use[field] === "string";
  const isTextOrNull = (field: string) => use[field] === null || isText(field);
  switch (use.kind) {
    case "stored":
      return isText("key") && isTextOrNull("scope") && isTextOrNull("scopeId");
    case "unreadable":
      return isText("key");
    case "provider-auth":
      return (
        isText("provider") &&
        isText("key") &&
        isText("source") &&
        isTextOrNull("scope") &&
        isTextOrNull("scopeId") &&
        isTextOrNull("connectionId") &&
        isTextOrNull("accountId")
      );
    case "provider-request":
    case "provider-unresolved":
    case "provider-connection":
    case "caller-auth":
    case "custom-provider":
    case "provider-effect":
      return isText("provider");
    default:
      return false;
  }
}

export function parseCredentialUses(
  json: string | null | undefined,
): CredentialUse[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) && parsed.every(isCredentialUse)
      ? parsed
      : null;
  } catch {
    // coercion-ok: a record that can't be read can't prove the run was org-only, so it is never served.
    return null;
  }
}

function providerUseKey(use: CredentialUse): string | null {
  if (use.kind === "stored" || use.kind === "unreadable") return null;
  if (use.kind !== "provider-auth") {
    return JSON.stringify([use.kind, use.provider]);
  }
  return JSON.stringify([
    use.kind,
    use.provider,
    use.key,
    use.source,
    use.scope,
    use.scopeId,
    use.connectionId,
    use.accountId,
  ]);
}

function providerUseKeys(uses: readonly CredentialUse[]): Set<string> {
  const keys = new Set<string>();
  for (const use of uses) {
    const key = providerUseKey(use);
    if (key) keys.add(key);
  }
  return keys;
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

async function readsSameCredentials(
  uses: readonly CredentialUse[],
  viewer: OrgSharingViewer,
  appId: string | undefined,
): Promise<boolean> {
  const ctx = { userEmail: viewer.userEmail, orgId: viewer.orgId };
  for (const use of uses) {
    if (use.kind !== "stored") continue;
    const resolved = await resolveCredentialDetailed(use.key, ctx);
    if (
      (resolved?.scope ?? null) !== use.scope ||
      (resolved?.scopeId ?? null) !== use.scopeId
    ) {
      return false;
    }
  }

  const expected = providerUseKeys(uses);
  if (expected.size === 0) return true;

  if (!appId) return false;
  const {
    getRegisteredProviderApiRuntimeOptions,
    resolveProviderApiCredentialUses,
  } = await import("../provider-api/index.js");
  const runtime = getRegisteredProviderApiRuntimeOptions(appId);
  if (!runtime) return false;
  const requested = new Set(
    uses.flatMap((use) =>
      use.kind === "provider-request" ? [use.provider] : [],
    ),
  );
  const actual = new Set<string>();
  for (const provider of requested) {
    const viewerUses = await runWithRequestContext(ctx, () =>
      resolveProviderApiCredentialUses(provider, runtime),
    );
    for (const key of providerUseKeys(viewerUses)) actual.add(key);
  }
  return sameMembers(expected, actual);
}

export async function viewerReadsSameCredentials(input: {
  uses: readonly CredentialUse[];
  viewer: OrgSharingViewer;
  appId: string | undefined;
}): Promise<boolean> {
  return runWithoutCredentialUseLedger(async () => {
    try {
      return await readsSameCredentials(input.uses, input.viewer, input.appId);
    } catch {
      // coercion-ok: fail closed; a viewer whose credentials can't be checked gets their own run, which reports the error.
      return false;
    }
  });
}
