import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DisposableRuntimeAuthority,
  NeonBranches,
  NetlifyRuntime,
  OpenRouterKeys,
  type LeaseJournalStore,
  type RuntimeLease,
  type RuntimeProviders,
  type TrustedRuntimeConfig,
} from "./runtime-authority.ts";
import * as runtimeAuthority from "./runtime-authority.ts";

/**
 * This is the only orchestration layer allowed to turn an authority profile
 * into a live disposable lease. Profiles and journals are intentionally JSON;
 * provider credentials are ambient execution inputs and never profile fields.
 */
export type TrustedAuthorityProfile = {
  version: 1;
  workspace: string;
  enabled: boolean;
  leasePrefix: "trusted-acceptance-";
  runtime: Omit<TrustedRuntimeConfig, "tombstone"> & {
    /** Base64 is an inert, prebuilt tombstone ZIP; it is not credential material. */
    tombstone: { sha256: string; zipBase64: string };
  };
  members: Array<{
    id: string;
    origin: string;
    artifactDirectory: string;
    withdrawnDirectoryMember?: boolean;
  }>;
};

export type RedactedAcceptanceReceipt = {
  version: 1;
  workspace: string;
  result: "passed" | "failed" | "blocked";
  lease?: RuntimeLease;
  evidence: Array<{ assertionId: string; status: "passed" | "failed" }>;
};

export type ControllerExecution = {
  providers: RuntimeProviders;
  deployArtifact: (
    member: TrustedAuthorityProfile["members"][number],
  ) => Promise<void>;
  runStableHarness: () => Promise<RedactedAcceptanceReceipt["evidence"]>;
  runWithdrawalHarness: () => Promise<RedactedAcceptanceReceipt["evidence"]>;
  journalFile: string;
  receiptFile: string;
  ttlMs: number;
  expectedAssertionIds: readonly string[];
  now?: () => Date;
};

export type ReaperExecution = {
  providers: RuntimeProviders;
  discoverLeases: (prefix: "trusted-acceptance-") => Promise<RuntimeLease[]>;
  journalFile: string;
  now?: () => Date;
};

const secretField =
  /(?:token|secret|password|databaseurl|api[_-]?key|credential|private)/i;
const secretValue =
  /(?:postgres(?:ql)?:\/\/[^\s]+|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|gh[pous]_[A-Za-z0-9_-]+)/i;
const acceptanceOrigin = /(?:^|[-.])acceptance(?:[-.]|$)/i;

function assertNoSecrets(value: unknown, path = "profile"): void {
  if (typeof value === "string" && secretValue.test(value))
    throw new Error(`${path} contains credential-shaped material`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSecrets(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (secretField.test(key)) {
      throw new Error(
        `${path}.${key} is not permitted in a trusted authority profile`,
      );
    }
    assertNoSecrets(entry, `${path}.${key}`);
  }
}

function assertExactKeys(
  value: unknown,
  allowed: readonly string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`${path}.${key} is not allowed`);
}

function assertProfileShape(profile: TrustedAuthorityProfile): void {
  assertExactKeys(
    profile,
    ["version", "workspace", "enabled", "leasePrefix", "runtime", "members"],
    "profile",
  );
  assertExactKeys(
    profile.runtime,
    ["maxInferenceUsd", "tombstone", "members"],
    "profile.runtime",
  );
  assertExactKeys(
    profile.runtime.tombstone,
    ["sha256", "zipBase64"],
    "profile.runtime.tombstone",
  );
  for (const [index, member] of profile.runtime.members.entries())
    assertExactKeys(
      member,
      [
        "id",
        "origin",
        "neonProjectId",
        "neonDatabaseName",
        "neonRoleName",
        "netlifyAccountId",
        "netlifySiteId",
        "needsInference",
      ],
      `profile.runtime.members[${index}]`,
    );
  for (const [index, member] of profile.members.entries())
    assertExactKeys(
      member,
      ["id", "origin", "artifactDirectory", "withdrawnDirectoryMember"],
      `profile.members[${index}]`,
    );
}

function stableAcceptanceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      acceptanceOrigin.test(url.hostname) &&
      !/(?:^|[-.])(?:prod|production)(?:[-.]|$)/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Pure validation used by dry workflow commands; it neither reads env nor calls a provider. */
export function validateTrustedAuthorityProfile(
  profile: TrustedAuthorityProfile,
  options: { requireEnabled?: boolean } = {},
): string[] {
  const issues: string[] = [];
  try {
    assertProfileShape(profile);
    assertNoSecrets(profile);
  } catch (error) {
    issues.push(
      error instanceof Error
        ? error.message
        : "profile contains secret material",
    );
    return issues;
  }
  if (profile.version !== 1) issues.push("profile.version must be 1");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.workspace))
    issues.push("profile.workspace must be a stable slug");
  if (profile.leasePrefix !== "trusted-acceptance-")
    issues.push(
      "profile.leasePrefix must use the deterministic acceptance prefix",
    );
  if ((options.requireEnabled ?? true) && !profile.enabled)
    issues.push("profile is disabled; live execution is unavailable");
  if (!profile.members.length) issues.push("profile.members must be non-empty");
  const ids = new Set<string>();
  const origins = new Set<string>();
  const siteIds = new Set<string>();
  const neonProjectIds = new Set<string>();
  for (const member of profile.members) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(member.id) || ids.has(member.id))
      issues.push(`member ${member.id || "<empty>"} is unsafe or duplicated`);
    ids.add(member.id);
    if (!stableAcceptanceUrl(member.origin))
      issues.push(`member ${member.id} has an unsafe acceptance origin`);
    if (origins.has(member.origin))
      issues.push(`member ${member.id} has a duplicate acceptance origin`);
    origins.add(member.origin);
    if (
      !member.artifactDirectory ||
      member.artifactDirectory.startsWith("/") ||
      member.artifactDirectory.split("/").includes("..")
    )
      issues.push(`member ${member.id} has an unsafe artifact directory`);
  }
  const runtimeMembers = new Set(profile.runtime.members.map(({ id }) => id));
  if (
    runtimeMembers.size !== profile.members.length ||
    profile.members.some(({ id }) => !runtimeMembers.has(id))
  )
    issues.push("profile members must exactly match runtime allowlist members");
  const declaredOrigins = new Map(
    profile.members.map((member) => [member.id, member.origin]),
  );
  for (const member of profile.runtime.members) {
    if (
      !member.neonProjectId ||
      !member.neonDatabaseName ||
      !member.neonRoleName ||
      !member.netlifyAccountId ||
      !member.netlifySiteId ||
      typeof member.needsInference !== "boolean"
    )
      issues.push(`runtime member ${member.id} has incomplete provider config`);
    if (member.origin !== declaredOrigins.get(member.id))
      issues.push(
        `runtime member ${member.id} origin must match its declared app origin`,
      );
    if (siteIds.has(member.netlifySiteId))
      issues.push(`runtime member ${member.id} has a duplicate Netlify site`);
    siteIds.add(member.netlifySiteId);
    if (neonProjectIds.has(member.neonProjectId))
      issues.push(`runtime member ${member.id} has a duplicate Neon project`);
    neonProjectIds.add(member.neonProjectId);
  }
  if (
    !Number.isFinite(profile.runtime.maxInferenceUsd) ||
    profile.runtime.maxInferenceUsd <= 0 ||
    profile.runtime.maxInferenceUsd > 1
  )
    issues.push("profile inference cap must be positive and at most 1 USD");
  if (!/^[a-f0-9]{64}$/i.test(profile.runtime.tombstone.sha256))
    issues.push("profile tombstone must have a sha256 digest");
  try {
    const zip = Buffer.from(profile.runtime.tombstone.zipBase64, "base64");
    if (!zip.byteLength)
      issues.push("profile tombstone must contain a prebuilt ZIP");
    else if (
      createHash("sha256").update(zip).digest("hex") !==
      profile.runtime.tombstone.sha256.toLowerCase()
    )
      issues.push("profile tombstone sha256 does not match its ZIP");
  } catch {
    issues.push("profile tombstone ZIP must be base64");
  }
  return issues;
}

function runtimeConfig(profile: TrustedAuthorityProfile): TrustedRuntimeConfig {
  return {
    ...profile.runtime,
    tombstone: {
      sha256: profile.runtime.tombstone.sha256,
      zip: new Uint8Array(
        Buffer.from(profile.runtime.tombstone.zipBase64, "base64"),
      ),
    },
  };
}

export function assertRedacted(value: unknown): void {
  const credentialValue =
    /(?:postgres(?:ql)?:\/\/|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|gh[pous]_[A-Za-z0-9_-]+)/i;
  const visit = (entry: unknown): void => {
    if (typeof entry === "string" && credentialValue.test(entry))
      throw new Error("redacted acceptance output contains secret material");
    if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === "object")
      Object.values(entry).forEach(visit);
  };
  visit(value);
}

export class JsonLeaseJournalStore implements LeaseJournalStore {
  constructor(private readonly file: string) {}

  async save(lease: RuntimeLease): Promise<void> {
    assertRedacted(lease);
    await writeFile(this.file, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
  }
}

async function writeReceipt(
  file: string,
  receipt: RedactedAcceptanceReceipt,
): Promise<void> {
  assertRedacted(receipt);
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

function receiptFor(
  profile: TrustedAuthorityProfile,
  lease: RuntimeLease | undefined,
  result: RedactedAcceptanceReceipt["result"],
  evidence: RedactedAcceptanceReceipt["evidence"],
): RedactedAcceptanceReceipt {
  return {
    version: 1,
    workspace: profile.workspace,
    result,
    ...(lease ? { lease } : {}),
    evidence,
  };
}

function hasCompleteEvidence(
  evidence: RedactedAcceptanceReceipt["evidence"],
  expectedAssertionIds: readonly string[],
): boolean {
  if (!expectedAssertionIds.length) return false;
  const expected = new Set(expectedAssertionIds);
  const actual = new Set(evidence.map(({ assertionId }) => assertionId));
  return (
    actual.size === evidence.length &&
    actual.size === expected.size &&
    [...expected].every((id) => actual.has(id)) &&
    evidence.every(({ status }) => status === "passed")
  );
}

/** Runs only after a trusted workflow has verified inert artifact provenance. */
export async function executeTrustedAcceptance(
  profile: TrustedAuthorityProfile,
  execution: ControllerExecution,
): Promise<RedactedAcceptanceReceipt> {
  const issues = validateTrustedAuthorityProfile(profile);
  if (issues.length)
    throw new Error(`trusted authority profile rejected: ${issues.join("; ")}`);
  const journalStore = new JsonLeaseJournalStore(execution.journalFile);
  const authority = new DisposableRuntimeAuthority(
    runtimeConfig(profile),
    execution.providers,
    execution.now,
    journalStore,
  );
  let lease: RuntimeLease | undefined;
  let evidence: RedactedAcceptanceReceipt["evidence"] = [];
  let failure: unknown;
  let completedReceipt: RedactedAcceptanceReceipt | undefined;
  try {
    const acquired = await authority.acquire(execution.ttlMs);
    lease = acquired.lease;
    // Secrets remain in the acquire return value only; no controller output receives it.
    for (const member of profile.members)
      await execution.deployArtifact(member);
    evidence = [
      ...(await execution.runStableHarness()),
      ...(await execution.runWithdrawalHarness()),
    ];
  } catch (error) {
    failure = error;
  } finally {
    if (lease) await authority.revoke(lease);
    const clean =
      lease?.state === "revoked" &&
      lease.verification.tombstoneActive &&
      lease.members.every(
        (member) => !member.runtimeOwned || Boolean(member.tombstoneDeployId),
      );
    const receipt = receiptFor(
      profile,
      lease,
      !failure &&
        clean &&
        hasCompleteEvidence(evidence, execution.expectedAssertionIds)
        ? "passed"
        : "failed",
      evidence,
    );
    completedReceipt = receipt;
    await writeReceipt(execution.receiptFile, receipt);
    if (!clean)
      throw new Error(
        "cleanup verification failed: lease was not revoked with tombstone IDs",
      );
  }
  if (failure) throw failure;
  if (!completedReceipt)
    throw new Error("trusted acceptance did not produce a controller receipt");
  return completedReceipt;
}

/** Discovery is injected so providers can be reconciled without candidate code or stored credentials. */
export async function reapTrustedAcceptanceLeases(
  profile: TrustedAuthorityProfile,
  execution: ReaperExecution,
): Promise<RuntimeLease[]> {
  const issues = validateTrustedAuthorityProfile(profile, {
    requireEnabled: false,
  });
  if (issues.length)
    throw new Error(`trusted authority profile rejected: ${issues.join("; ")}`);
  const authority = new DisposableRuntimeAuthority(
    runtimeConfig(profile),
    execution.providers,
    execution.now,
    new JsonLeaseJournalStore(execution.journalFile),
  );
  const leases = await execution.discoverLeases("trusted-acceptance-");
  return authority.reapExpired(leases);
}

async function profileFromFile(file: string): Promise<TrustedAuthorityProfile> {
  return JSON.parse(
    await readFile(resolve(file), "utf8"),
  ) as TrustedAuthorityProfile;
}

function requiredAmbientCredentials(): Record<string, string> {
  const keys = [
    "ACCEPTANCE_NEON_API_KEY",
    "ACCEPTANCE_NETLIFY_AUTH_TOKEN",
    "ACCEPTANCE_OPENROUTER_API_KEY",
  ] as const;
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length)
    throw new Error(
      `live controller credentials are unavailable: ${missing.join(", ")}`,
    );
  return Object.fromEntries(
    keys.map((key) => [key, process.env[key]!]),
  ) as Record<string, string>;
}

function ambientProviders(): RuntimeProviders {
  const credentials = requiredAmbientCredentials();
  return {
    neon: new NeonBranches(fetch, credentials.ACCEPTANCE_NEON_API_KEY),
    netlify: new NetlifyRuntime(
      fetch,
      credentials.ACCEPTANCE_NETLIFY_AUTH_TOKEN,
    ),
    openrouter: new OpenRouterKeys(
      fetch,
      credentials.ACCEPTANCE_OPENROUTER_API_KEY,
    ),
  };
}

async function leaseFromFile(file: string): Promise<RuntimeLease> {
  const lease = JSON.parse(
    await readFile(resolve(file), "utf8"),
  ) as RuntimeLease;
  assertRedacted(lease);
  return lease;
}

function assertRevoked(lease: RuntimeLease): void {
  if (
    lease.state !== "revoked" ||
    !lease.verification.tombstoneActive ||
    !lease.members.every(
      (member) => !member.runtimeOwned || Boolean(member.tombstoneDeployId),
    )
  ) {
    throw new Error(
      "cleanup verification failed: lease was not revoked with tombstone IDs",
    );
  }
}

type RuntimeDiscovery = (
  config: TrustedRuntimeConfig,
  providers: Pick<RuntimeProviders, "neon" | "openrouter">,
  now: Date,
) => Promise<RuntimeLease[]>;

function discoverExpiredLeases(): RuntimeDiscovery {
  const candidate = (
    runtimeAuthority as unknown as {
      discoverExpiredLeases?: RuntimeDiscovery;
    }
  ).discoverExpiredLeases;
  if (!candidate) throw new Error("trusted runtime discovery is not available");
  return candidate;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const option = (name: string): string | undefined =>
    args[args.indexOf(name) + 1];
  const profileFile = option("--profile");
  if (!command || !profileFile)
    throw new Error(
      "usage: controller <validate-profile|acquire|revoke|reap> --profile <file> --journal <file>",
    );
  const profile = await profileFromFile(profileFile);
  if (command === "validate-profile") {
    const issues = validateTrustedAuthorityProfile(profile);
    process.stdout.write(
      `${JSON.stringify({ ok: issues.length === 0, issues })}\n`,
    );
    if (issues.length) process.exitCode = 1;
    return;
  }
  if (!new Set(["acquire", "revoke", "reap"]).has(command))
    throw new Error(`unknown controller command: ${command}`);
  const issues = validateTrustedAuthorityProfile(profile, {
    requireEnabled: command === "acquire",
  });
  if (issues.length)
    throw new Error(`trusted authority profile rejected: ${issues.join("; ")}`);
  const journalFile = option("--journal");
  if (!journalFile)
    throw new Error("live controller commands require --journal");
  const providers = ambientProviders();
  const authority = new DisposableRuntimeAuthority(
    runtimeConfig(profile),
    providers,
    undefined,
    new JsonLeaseJournalStore(journalFile),
  );
  if (command === "acquire") {
    const result = await authority.acquire(
      Number(option("--ttl-ms") ?? 3600000),
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, leaseId: result.lease.id })}\n`,
    );
    return;
  }
  if (command === "revoke") {
    const revoked = await authority.revoke(await leaseFromFile(journalFile));
    assertRevoked(revoked);
    process.stdout.write(
      `${JSON.stringify({ ok: true, leaseId: revoked.id, state: revoked.state })}\n`,
    );
    return;
  }
  if (command === "reap") {
    const discovered = await discoverExpiredLeases()(
      runtimeConfig(profile),
      providers,
      new Date(),
    );
    const reaped = await authority.reapExpired(discovered);
    for (const lease of reaped) {
      if (new Date(lease.expiresAt).getTime() <= Date.now())
        assertRevoked(lease);
    }
    await writeFile(
      journalFile,
      `${JSON.stringify(reaped, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, discovered: discovered.length, reaped: reaped.filter(({ state }) => state === "revoked").map(({ id }) => id) })}\n`,
    );
    return;
  }
  throw new Error(`unreachable controller command: ${command}`);
}

if (process.argv[1]?.endsWith("controller.ts")) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
