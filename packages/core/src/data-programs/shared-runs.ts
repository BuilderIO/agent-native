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

type StoredUse = Extract<CredentialUse, { kind: "stored" }>;

interface ViewerCheck {
  uses: readonly CredentialUse[];
  viewer: OrgSharingViewer;
  appId: string | undefined;
  signal?: AbortSignal;
}

function viewerContext(viewer: OrgSharingViewer) {
  return { userEmail: viewer.userEmail, orgId: viewer.orgId };
}

async function resolveViewerStoredUses(
  check: ViewerCheck,
): Promise<StoredUse[]> {
  const resolved: StoredUse[] = [];
  for (const use of check.uses) {
    if (use.kind !== "stored") continue;
    const credential = await resolveCredentialDetailed(
      use.key,
      viewerContext(check.viewer),
    );
    resolved.push({
      kind: "stored",
      key: use.key,
      scope: credential?.scope ?? null,
      scopeId: credential?.scopeId ?? null,
    });
  }
  return resolved;
}

async function resolveViewerProviderUses(
  check: ViewerCheck,
): Promise<CredentialUse[] | null> {
  const requested = new Set(
    check.uses.flatMap((use) =>
      use.kind === "provider-request" ? [use.provider] : [],
    ),
  );
  if (requested.size === 0) return [];
  if (!check.appId) return null;
  const {
    getRegisteredProviderApiRuntimeOptions,
    resolveProviderApiCredentialUses,
  } = await import("../provider-api/index.js");
  const runtime = getRegisteredProviderApiRuntimeOptions(check.appId);
  if (!runtime) return null;
  const options = check.signal ? { signal: check.signal } : {};
  const resolved: CredentialUse[] = [];
  for (const provider of requested) {
    resolved.push(
      ...(await runWithRequestContext(viewerContext(check.viewer), () =>
        resolveProviderApiCredentialUses(provider, runtime, options),
      )),
    );
  }
  return resolved;
}

async function readsSameCredentials(check: ViewerCheck): Promise<boolean> {
  const stored = await resolveViewerStoredUses(check);
  const recorded = check.uses.filter(
    (use): use is StoredUse => use.kind === "stored",
  );
  if (
    stored.some(
      (use, index) =>
        use.scope !== recorded[index]?.scope ||
        use.scopeId !== recorded[index]?.scopeId,
    )
  ) {
    return false;
  }

  const expected = providerUseKeys(check.uses);
  if (expected.size === 0) return true;
  const provider = await resolveViewerProviderUses(check);
  return provider !== null && sameMembers(expected, providerUseKeys(provider));
}

async function resolvesOnlyOrgCredentials(
  check: ViewerCheck,
): Promise<boolean> {
  const stored = await resolveViewerStoredUses(check);
  const orgId = check.viewer.orgId;
  if (!isOrgShareableRun({ uses: stored, bridgeToolsUsed: [], orgId })) {
    return false;
  }
  const provider = await resolveViewerProviderUses(check);
  return (
    provider !== null &&
    isOrgShareableRun({
      uses: [...stored, ...provider],
      bridgeToolsUsed: [],
      orgId,
    })
  );
}

function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function checkViewer(
  check: ViewerCheck,
  compare: (check: ViewerCheck) => Promise<boolean>,
): Promise<boolean> {
  return runWithoutCredentialUseLedger(async () => {
    try {
      return await untilAborted(compare(check), check.signal);
    } catch {
      // coercion-ok: fail closed; a viewer whose credentials can't be checked in time gets their own run, which reports any error.
      return false;
    }
  });
}

export function viewerReadsSameCredentials(
  check: ViewerCheck,
): Promise<boolean> {
  return checkViewer(check, readsSameCredentials);
}

export function viewerResolvesOnlyOrgCredentials(
  check: ViewerCheck,
): Promise<boolean> {
  return checkViewer(check, resolvesOnlyOrgCredentials);
}
