import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  JsonLeaseJournalStore,
  assertRedacted,
  createAmbientRuntimeProviders,
  executeTrustedAcceptance,
  settleBeforeCleanup,
  updateTrustedAcceptanceDirectoryScenario,
  validateTrustedAuthorityProfile,
  type ControllerExecution,
  type RedactedAcceptanceReceipt,
  type TrustedAuthorityProfile,
} from "./controller.ts";
import {
  HostedMcpClient,
  bootstrapHostedQaSession,
  createForeignDomainSentinel,
  createSyntheticQaIdentity,
  discoverPublicOAuthIdentity,
  expectUnauthorized,
  expectRejected4xx,
  runCryptographicIsolationProbes,
  runHostedOAuthCodeFlow,
  runWithdrawalScenario,
  startLoopbackCallbackListener,
  type HostedHarnessEvidence,
  type HostedQaBrowserAdapter,
  type InjectedFetch,
  type LoopbackCallback,
} from "./hosted-oauth-a2a-harness.ts";
import { createIsolatedQaPage } from "./playwright-hosted-qa.ts";
import type { RuntimeProviders } from "./runtime-authority.ts";

const execFile = promisify(execFileCallback);

type Harness =
  | {
      kind: "a2a-directory-withdrawal";
      targetApp: string;
      message: string;
      expectedResult: string;
      maxStatusPolls: number;
    }
  | {
      kind: "mcp-read-only-tool";
      tool: string;
      arguments?: Record<string, unknown>;
    };

export type TrustedHostedAcceptancePlan = {
  version: 1;
  workspace: string;
  profileSha256: string;
  tokenExpiryMs: 300000;
  members: Array<{
    id: string;
    origin: string;
    mcpUrl: string;
    wrongAudienceResource: string;
    harness: Harness;
    productionMcpUrl?: string;
    otherAcceptanceMcpUrl?: string;
  }>;
};

export type TrustedDeployManifest = {
  version?: 1;
  members: Array<{
    id: string;
    siteId: string;
    /** `artifact` is the existing workflow manifest form after provenance verification. */
    artifact?: string;
    artifactDirectory?: string;
    publishDirectory?: string;
    functionsDirectory?: string;
  }>;
  directoryFixture?: {
    siteId: string;
    artifact?: string;
    artifactDirectory?: string;
    publishDirectory?: string;
    functionsDirectory?: string;
    sha256: string;
  };
};

export type HostedQaBrowser = {
  adapter: HostedQaBrowserAdapter;
  close: () => Promise<void>;
};

export type HostedQaBrowserFactory = {
  create: (
    origin: string,
    options?: { isolated?: boolean },
  ) => Promise<HostedQaBrowser>;
  close?: () => Promise<void>;
};

export type TrustedHostedAcceptanceDependencies = {
  providers: RuntimeProviders;
  fetchFn: InjectedFetch;
  browserFactory: HostedQaBrowserFactory;
  createLoopbackCallback: () => Promise<LoopbackCallback>;
  deploy?: (input: {
    siteId: string;
    publishDirectory: string;
    functionsDirectory?: string;
    signal?: AbortSignal;
  }) => Promise<{ deployId: string }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  harnessTimeoutMs?: number;
};

export type HostedAcceptanceFiles = {
  planFile: string;
  profileFile: string;
  deployManifestFile: string;
  journalFile: string;
  receiptFile: string;
  deployResultFile: string;
};

type DeployResult = {
  version: 1;
  deployments: Array<{ id: string; deployId: string }>;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const leaseMarkerTemplate = "{{TRUSTED_ACCEPTANCE_LEASE_MARKER}}";
const statusPollIntervalMs = 5_000;
export const defaultHarnessTimeoutMs = 12 * 60_000;
export const defaultLeaseTtlMs = 30 * 60_000;

function leaseMarker(leaseId: string): string {
  return `TRUSTED_ACCEPTANCE_FIXTURE_${sha256(leaseId).slice(0, 16)}`;
}

function renderLeaseMarker(value: string, leaseId: string): string {
  if (!value.includes(leaseMarkerTemplate))
    throw new Error("A2A harness text must include the lease marker template");
  return value.replaceAll(leaseMarkerTemplate, leaseMarker(leaseId));
}

function exactHttps(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value)
    throw new Error("expected exact HTTPS origin");
  return url.origin;
}

function safePath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes(".."))
    throw new Error("deploy manifest contains an unsafe artifact path");
  return value;
}

function deploymentPaths(entry: {
  artifact?: string;
  artifactDirectory?: string;
  publishDirectory?: string;
  functionsDirectory?: string;
}): {
  artifactDirectory: string;
  publishDirectory: string;
  functionsDirectory?: string;
} {
  const artifactDirectory = entry.artifact ?? entry.artifactDirectory;
  if (!artifactDirectory)
    throw new Error("deploy manifest omitted artifact directory");
  const publishDirectory =
    entry.publishDirectory ?? join(artifactDirectory, "publish");
  const functionsDirectory =
    entry.functionsDirectory ??
    join(artifactDirectory, ".netlify/functions-internal");
  return { artifactDirectory, publishDirectory, functionsDirectory };
}

async function directoryArtifactDigest(directory: string): Promise<string> {
  const root = resolve(directory);
  const hash = createHash("sha256");
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const normalized = relative(root, file).replaceAll("\\", "/");
        hash.update(`${normalized}\0`);
        hash.update(await readFile(file));
        hash.update("\0");
      } else
        throw new Error(
          "trusted directory artifact must contain only regular files",
        );
    }
  };
  if (!(await stat(root)).isDirectory())
    throw new Error("trusted directory artifact is not a directory");
  await visit(root);
  return hash.digest("hex");
}

function assertPlan(plan: TrustedHostedAcceptancePlan): void {
  if (plan.version !== 1 || !plan.workspace || plan.tokenExpiryMs !== 300000)
    throw new Error(
      "trusted hosted plan must be version 1 with exact 5m token expiry",
    );
  if (!/^[a-f0-9]{64}$/i.test(plan.profileSha256) || !plan.members.length)
    throw new Error("trusted hosted plan is incomplete");
  const ids = new Set<string>();
  for (const member of plan.members) {
    if (!member.id || ids.has(member.id))
      throw new Error("trusted hosted plan has duplicate members");
    ids.add(member.id);
    exactHttps(member.origin);
    if (new URL(member.mcpUrl).origin !== member.origin)
      throw new Error("plan MCP URL must remain at member origin");
    if (
      !member.wrongAudienceResource ||
      new URL(member.wrongAudienceResource).origin === member.origin
    )
      throw new Error(
        "plan must name a distinct non-allowlisted OAuth resource",
      );
    if (
      member.harness.kind === "a2a-directory-withdrawal" &&
      (!member.harness.targetApp ||
        !member.harness.message ||
        !member.harness.expectedResult ||
        !member.harness.message.includes(leaseMarkerTemplate) ||
        member.harness.expectedResult !== leaseMarkerTemplate ||
        !Number.isInteger(member.harness.maxStatusPolls) ||
        member.harness.maxStatusPolls < 1 ||
        member.harness.maxStatusPolls > 60)
    )
      throw new Error("directory withdrawal harness is incomplete");
    if (
      member.harness.kind === "mcp-read-only-tool" &&
      (!member.harness.tool ||
        /(?:write|delete|create|update|send)/i.test(member.harness.tool))
    )
      throw new Error("MCP harness must name a read-only tool");
  }
}

function validateFiles(input: {
  plan: TrustedHostedAcceptancePlan;
  profile: TrustedAuthorityProfile;
  manifest: TrustedDeployManifest;
  profileText: string;
}): void {
  assertPlan(input.plan);
  const issues = validateTrustedAuthorityProfile(input.profile);
  if (issues.length)
    throw new Error(`trusted authority profile rejected: ${issues.join("; ")}`);
  if (sha256(input.profileText) !== input.plan.profileSha256.toLowerCase())
    throw new Error("plan profile digest does not match exact profile file");
  if (input.plan.workspace !== input.profile.workspace)
    throw new Error("plan workspace does not match profile workspace");
  const configured = new Map(
    input.profile.members.map((member) => [member.id, member]),
  );
  if (configured.size !== input.manifest.members.length)
    throw new Error(
      "profile and deploy manifest must name the exact same members",
    );
  for (const member of input.plan.members) {
    const profileMember = configured.get(member.id);
    const runtimeMember = input.profile.runtime.members.find(
      ({ id }) => id === member.id,
    );
    const deploy = input.manifest.members.find(({ id }) => id === member.id);
    if (
      !profileMember ||
      !runtimeMember ||
      !deploy ||
      member.origin !== profileMember.origin ||
      member.origin !== runtimeMember.origin
    )
      throw new Error(
        `member ${member.id} does not exactly match profile configuration`,
      );
    const paths = deploymentPaths(deploy);
    if (
      deploy.siteId !== runtimeMember.netlifySiteId ||
      (!deploy.artifact &&
        deploy.artifactDirectory !== profileMember.artifactDirectory)
    )
      throw new Error(
        `deploy manifest member ${member.id} does not match trusted profile`,
      );
    if (!deploy.artifact) {
      safePath(paths.artifactDirectory);
      safePath(paths.publishDirectory);
      if (paths.functionsDirectory) safePath(paths.functionsDirectory);
    }
  }
  const fixture = input.profile.directoryFixture;
  if (fixture) {
    const deploy = input.manifest.directoryFixture;
    if (
      !deploy ||
      deploy.siteId !== fixture.netlifySiteId ||
      (!deploy.artifact &&
        deploy.artifactDirectory !== fixture.artifactDirectory) ||
      deploy.sha256 !== fixture.artifactSha256
    )
      throw new Error(
        "directory deploy manifest does not match trusted artifact contract",
      );
    const paths = deploymentPaths(deploy);
    if (!deploy.artifact) {
      safePath(paths.artifactDirectory);
      safePath(paths.publishDirectory);
      if (paths.functionsDirectory) safePath(paths.functionsDirectory);
    }
  } else if (input.manifest.directoryFixture)
    throw new Error("deploy manifest names an undeclared directory fixture");
}

async function loadFiles(files: HostedAcceptanceFiles): Promise<{
  plan: TrustedHostedAcceptancePlan;
  profile: TrustedAuthorityProfile;
  manifest: TrustedDeployManifest;
}> {
  const [planText, profileText, manifestText] = await Promise.all([
    readFile(files.planFile, "utf8"),
    readFile(files.profileFile, "utf8"),
    readFile(files.deployManifestFile, "utf8"),
  ]);
  const plan = JSON.parse(planText) as TrustedHostedAcceptancePlan;
  const profile = JSON.parse(profileText) as TrustedAuthorityProfile;
  const manifest = JSON.parse(manifestText) as TrustedDeployManifest;
  validateFiles({ plan, profile, manifest, profileText });
  if (profile.directoryFixture && manifest.directoryFixture) {
    const artifactDirectory =
      manifest.directoryFixture.artifact ??
      manifest.directoryFixture.artifactDirectory;
    if (!artifactDirectory)
      throw new Error("directory deploy manifest omitted artifact directory");
    const digest = await directoryArtifactDigest(artifactDirectory);
    if (digest !== profile.directoryFixture.artifactSha256)
      throw new Error("trusted directory artifact sha256 contract failed");
  }
  return { plan, profile, manifest };
}

/** Uses child environment only: the management token is never an argv value or deploy result field. */
export async function deployWithNetlifyCli(input: {
  siteId: string;
  publishDirectory: string;
  functionsDirectory?: string;
  token: string;
  signal?: AbortSignal;
}): Promise<{ deployId: string }> {
  const args = [
    "deploy",
    "--prod",
    "--no-build",
    "--json",
    "--site",
    input.siteId,
    "--dir",
    input.publishDirectory,
  ];
  if (input.functionsDirectory)
    args.push("--functions", input.functionsDirectory);
  const result = await execFile("netlify", args, {
    env: { ...process.env, NETLIFY_AUTH_TOKEN: input.token },
    timeout: 120_000,
    signal: input.signal,
  });
  const parsed = JSON.parse(result.stdout) as {
    deploy_id?: unknown;
    id?: unknown;
  };
  const deployId = parsed.deploy_id ?? parsed.id;
  if (typeof deployId !== "string" || !deployId)
    throw new Error("Netlify deploy did not return an ID");
  return { deployId };
}

function evidence(
  assertionId: string,
  status: "passed" | "failed",
  origin: string,
): HostedHarnessEvidence {
  return {
    assertionId,
    status,
    timestamp: new Date().toISOString(),
    origins: [origin],
  };
}

function abortableFetch(
  fetchFn: InjectedFetch,
  signal: AbortSignal,
): InjectedFetch {
  return (url, init) =>
    fetchFn(url, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
    });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("trusted hosted harness aborted");
}

async function awaitWithAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = () => rejectPromise(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        rejectPromise(error);
      },
    );
  });
}

function abortableBrowserAdapter(
  browser: HostedQaBrowserAdapter,
  signal: AbortSignal,
): HostedQaBrowserAdapter {
  return {
    origin: browser.origin,
    postJson: (path, body) =>
      awaitWithAbort(browser.postJson(path, body), signal),
    getJson: (path) => awaitWithAbort(browser.getJson(path), signal),
    ...(browser.authorize
      ? {
          authorize: (url: string) =>
            awaitWithAbort(browser.authorize!(url), signal),
        }
      : {}),
    ...(browser.authorizeExpectRejected
      ? {
          authorizeExpectRejected: (url: string) =>
            awaitWithAbort(browser.authorizeExpectRejected!(url), signal),
        }
      : {}),
  };
}

function abortableCallback(
  callback: LoopbackCallback,
  signal: AbortSignal,
): LoopbackCallback {
  return {
    redirectUri: callback.redirectUri,
    waitForCallback: () => awaitWithAbort(callback.waitForCallback(), signal),
    close: callback.close,
  };
}

async function closeWithTimeout(close: () => Promise<void>): Promise<void> {
  await awaitWithAbort(close(), AbortSignal.timeout(10_000)).catch(
    () => undefined,
  );
}

async function createBrowserWithAbort(
  factory: HostedQaBrowserFactory,
  origin: string,
  signal: AbortSignal,
  options?: { isolated?: boolean },
): Promise<HostedQaBrowser> {
  const creation = factory.create(origin, options);
  try {
    return await awaitWithAbort(creation, signal);
  } catch (error) {
    if (signal.aborted)
      void creation.then(
        (browser) => closeWithTimeout(browser.close),
        () => undefined,
      );
    throw error;
  }
}

async function createCallbackWithAbort(
  create: () => Promise<LoopbackCallback>,
  signal: AbortSignal,
): Promise<LoopbackCallback> {
  const creation = create();
  try {
    return await awaitWithAbort(creation, signal);
  } catch (error) {
    if (signal.aborted)
      void creation.then(
        (callback) => closeWithTimeout(callback.close),
        () => undefined,
      );
    throw error;
  }
}

/**
 * Runs entirely in process once callers have supplied verified files and injected
 * provider/browser seams. It never executes candidate-authored commands.
 */
export async function runHostedAcceptance(
  files: HostedAcceptanceFiles,
  deps: TrustedHostedAcceptanceDependencies,
): Promise<RedactedAcceptanceReceipt> {
  const { plan, profile, manifest } = await loadFiles(files);
  const deploy =
    deps.deploy ??
    ((input) => {
      const token = process.env.ACCEPTANCE_NETLIFY_AUTH_TOKEN;
      if (!token) throw new Error("protected Netlify token is unavailable");
      return deployWithNetlifyCli({ ...input, token });
    });
  const deployments: DeployResult["deployments"] = [];
  const deployMember = async (
    id: string,
    signal?: AbortSignal,
  ): Promise<void> => {
    const member = manifest.members.find((entry) => entry.id === id);
    if (!member) throw new Error(`missing deploy manifest entry for ${id}`);
    const paths = deploymentPaths(member);
    const result = await deploy({
      siteId: member.siteId,
      publishDirectory: paths.publishDirectory,
      ...(paths.functionsDirectory
        ? { functionsDirectory: paths.functionsDirectory }
        : {}),
      ...(signal ? { signal } : {}),
    });
    deployments.push({ id, deployId: result.deployId });
  };
  const deployDirectory = async (signal?: AbortSignal): Promise<void> => {
    const fixture = manifest.directoryFixture;
    if (!fixture) throw new Error("missing trusted directory deploy manifest");
    const paths = deploymentPaths(fixture);
    const result = await deploy({
      siteId: fixture.siteId,
      publishDirectory: paths.publishDirectory,
      ...(paths.functionsDirectory
        ? { functionsDirectory: paths.functionsDirectory }
        : {}),
      ...(signal ? { signal } : {}),
    });
    deployments.push({ id: "directory-fixture", deployId: result.deployId });
  };
  const active: Array<{
    member: TrustedHostedAcceptancePlan["members"][number];
    browser: HostedQaBrowser;
    token: string;
    tokenIssuedAt: number;
  }> = [];
  const expected = [
    ...plan.members.flatMap(({ id }) => [
      `${id}:wrong-password-rejected`,
      `${id}:session`,
      `${id}:second-tenant-data-isolated`,
      `${id}:oauth`,
      `${id}:unauthenticated-oauth-code-rejected`,
      `${id}:oauth-authorization-code-replay-rejected`,
      `${id}:oauth-wrong-audience-rejected`,
      `${id}:harness`,
      `${id}:expiry`,
      `${id}:post-cleanup`,
    ]),
    ...plan.members.flatMap(({ id, productionMcpUrl, otherAcceptanceMcpUrl }) =>
      productionMcpUrl && otherAcceptanceMcpUrl
        ? [
            `${id}:acceptance-token-rejected-by-production-resource`,
            `${id}:acceptance-token-rejected-by-other-acceptance-resource`,
            `${id}:foreign-domain-sentinel-rejected-by-acceptance`,
            `${id}:production-oauth-metadata-distinct`,
          ]
        : [],
    ),
    ...(profile.directoryFixture ? ["directory:withdrawal-redeployed"] : []),
  ];
  const harnessTimeoutMs = deps.harnessTimeoutMs ?? defaultHarnessTimeoutMs;
  const controller: ControllerExecution = {
    providers: deps.providers,
    journalFile: files.journalFile,
    receiptFile: files.receiptFile,
    ttlMs: defaultLeaseTtlMs,
    harnessTimeoutMs,
    expectedAssertionIds: expected,
    now: deps.now,
    async deployArtifact(member) {
      await deployMember(member.id);
    },
    ...(profile.directoryFixture
      ? {
          async deployDirectoryArtifact() {
            await deployDirectory();
          },
        }
      : {}),
    async runStableHarness(lease, signal) {
      const results: HostedHarnessEvidence[] = [];
      const fetchFn = abortableFetch(deps.fetchFn, signal);
      for (const member of plan.members) {
        const isolated = await createBrowserWithAbort(
          deps.browserFactory,
          member.origin,
          signal,
          { isolated: true },
        );
        const isolatedAdapter = abortableBrowserAdapter(
          isolated.adapter,
          signal,
        );
        const identity = createSyntheticQaIdentity(
          lease.id,
          profile.directoryFixture?.orgDomain,
        );
        try {
          const wrong = await identity.withPassword((password) =>
            isolatedAdapter.postJson("/_agent-native/auth/login", {
              email: identity.email,
              password: `${password}-wrong`,
            }),
          );
          if (wrong.status !== 401)
            throw new Error("wrong-password probe did not fail closed");
          results.push(
            evidence(
              `${member.id}:wrong-password-rejected`,
              "passed",
              member.origin,
            ),
          );
        } finally {
          await closeWithTimeout(isolated.close);
        }
        const browser = await createBrowserWithAbort(
          deps.browserFactory,
          member.origin,
          signal,
        );
        const browserAdapter = abortableBrowserAdapter(browser.adapter, signal);
        let retained = false;
        try {
          const session = await bootstrapHostedQaSession({
            browser: browserAdapter,
            appOrigin: member.origin,
            identity,
          });
          results.push({ ...session, assertionId: `${member.id}:session` });
          const rawCallback = await createCallbackWithAbort(
            deps.createLoopbackCallback,
            signal,
          );
          const callback = abortableCallback(rawCallback, signal);
          let flow;
          try {
            flow = await runHostedOAuthCodeFlow({
              fetchFn,
              appOrigin: member.origin,
              browser: browserAdapter,
              callback,
              nonAllowlistedResource: member.wrongAudienceResource,
            });
          } finally {
            await closeWithTimeout(rawCallback.close);
          }
          results.push(
            ...flow.evidence.map((entry) => ({
              ...entry,
              assertionId:
                entry.assertionId ===
                "hosted-oauth-dynamic-registration-s256-pkce"
                  ? `${member.id}:oauth`
                  : `${member.id}:${entry.assertionId}`,
            })),
          );
          const primaryClient = new HostedMcpClient(
            fetchFn,
            member.mcpUrl,
            flow.accessToken,
          );
          const isolationMarker = `Lease ${sha256(lease.id).slice(0, 16)}`;
          await primaryClient.callTool("update-user-profile", {
            name: isolationMarker,
          });
          const secondIdentity = createSyntheticQaIdentity(
            `${lease.id}-second-tenant`,
            profile.directoryFixture?.orgDomain,
          );
          const secondBrowser = await createBrowserWithAbort(
            deps.browserFactory,
            member.origin,
            signal,
            { isolated: true },
          );
          try {
            const secondAdapter = abortableBrowserAdapter(
              secondBrowser.adapter,
              signal,
            );
            await bootstrapHostedQaSession({
              browser: secondAdapter,
              appOrigin: member.origin,
              identity: secondIdentity,
            });
            const rawSecondCallback = await createCallbackWithAbort(
              deps.createLoopbackCallback,
              signal,
            );
            let secondFlow;
            try {
              secondFlow = await runHostedOAuthCodeFlow({
                fetchFn,
                appOrigin: member.origin,
                browser: secondAdapter,
                callback: abortableCallback(rawSecondCallback, signal),
              });
            } finally {
              await closeWithTimeout(rawSecondCallback.close);
            }
            const secondProfile = await new HostedMcpClient(
              fetchFn,
              member.mcpUrl,
              secondFlow.accessToken,
            ).callTool("get-user-profile", {});
            const primaryProfile = await primaryClient.callTool(
              "get-user-profile",
              {},
            );
            if (
              JSON.stringify(secondProfile).includes(isolationMarker) ||
              !JSON.stringify(primaryProfile).includes(isolationMarker)
            )
              throw new Error(
                "second synthetic tenant could read the harness tenant profile",
              );
            results.push(
              evidence(
                `${member.id}:second-tenant-data-isolated`,
                "passed",
                member.origin,
              ),
            );
          } finally {
            await closeWithTimeout(secondBrowser.close);
          }
          active.push({
            member,
            browser,
            token: flow.accessToken,
            tokenIssuedAt: (deps.now?.() ?? new Date()).getTime(),
          });
          retained = true;
        } finally {
          if (!retained) await closeWithTimeout(browser.close);
        }
      }
      return results;
    },
    async runWithdrawalHarness(lease, signal) {
      const results: HostedHarnessEvidence[] = [];
      const fetchFn = abortableFetch(deps.fetchFn, signal);
      for (const current of active) {
        const client = new HostedMcpClient(
          fetchFn,
          current.member.mcpUrl,
          current.token,
        );
        if (current.member.harness.kind === "a2a-directory-withdrawal") {
          if (!profile.directoryFixture)
            throw new Error(
              "directory harness requires the trusted directory fixture",
            );
          results.push(
            ...(
              await runWithdrawalScenario({
                client,
                targetApp: current.member.harness.targetApp,
                message: renderLeaseMarker(
                  current.member.harness.message,
                  lease.id,
                ),
                expectedResult: renderLeaseMarker(
                  current.member.harness.expectedResult,
                  lease.id,
                ),
                maxStatusPolls: current.member.harness.maxStatusPolls,
                wait: () =>
                  (
                    deps.sleep ??
                    ((ms) =>
                      new Promise<void>((resolve) => setTimeout(resolve, ms)))
                  )(statusPollIntervalMs),
                controller: {
                  async withdrawDirectoryMember() {
                    signal.throwIfAborted();
                    await updateTrustedAcceptanceDirectoryScenario(
                      profile,
                      lease,
                      deps.providers,
                      deps.now,
                      new JsonLeaseJournalStore(files.journalFile),
                    );
                    // This is a cleanup barrier, not an abort race. Once a
                    // provider has accepted a deploy, killing the local CLI
                    // cannot prove that deploy will not become active later.
                    // Settle both bounded CLI operations before allowing the
                    // controller to place and verify its final tombstones.
                    await settleBeforeCleanup(
                      [deployDirectory(), deployMember(current.member.id)],
                      signal,
                    );
                  },
                },
              })
            ).map((entry) => ({
              ...entry,
              assertionId: `${current.member.id}:harness`,
            })),
          );
          results.push(
            evidence(
              "directory:withdrawal-redeployed",
              "passed",
              profile.directoryFixture.origin,
            ),
          );
        } else {
          await client.callTool(
            current.member.harness.tool,
            current.member.harness.arguments ?? {},
          );
          results.push(
            evidence(
              `${current.member.id}:harness`,
              "passed",
              current.member.origin,
            ),
          );
        }
        if (
          current.member.productionMcpUrl &&
          current.member.otherAcceptanceMcpUrl
        ) {
          const productionIdentity = await discoverPublicOAuthIdentity(
            fetchFn,
            new URL(current.member.productionMcpUrl).origin,
          );
          const acceptanceIdentity = await discoverPublicOAuthIdentity(
            fetchFn,
            current.member.origin,
          );
          if (
            productionIdentity.resource === acceptanceIdentity.resource ||
            productionIdentity.issuer === acceptanceIdentity.issuer
          ) {
            throw new Error(
              "production and acceptance OAuth identities must remain distinct",
            );
          }
          results.push({
            ...evidence(
              `${current.member.id}:production-oauth-metadata-distinct`,
              "passed",
              current.member.origin,
            ),
            publicResource: productionIdentity.resource,
            publicIssuer: productionIdentity.issuer,
          });
          results.push(
            ...(
              await runCryptographicIsolationProbes({
                fetchFn,
                acceptanceToken: current.token,
                acceptanceMcpUrl: current.member.mcpUrl,
                productionMcpUrl: current.member.productionMcpUrl,
                otherAcceptanceMcpUrl: current.member.otherAcceptanceMcpUrl,
                foreignDomainSentinel: createForeignDomainSentinel({
                  productionResource: current.member.productionMcpUrl,
                  acceptanceResource: current.member.mcpUrl,
                }),
              })
            ).map((entry) => ({
              ...entry,
              assertionId: `${current.member.id}:${entry.assertionId}`,
            })),
          );
        }
        const elapsed =
          (deps.now?.() ?? new Date()).getTime() - current.tokenIssuedAt;
        await awaitWithAbort(
          (
            deps.sleep ??
            ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
          )(Math.max(0, plan.tokenExpiryMs - elapsed + 1_000)),
          signal,
        );
        await expectUnauthorized(fetchFn, current.member.mcpUrl, {
          headers: { Authorization: `Bearer ${current.token}` },
        });
        results.push({
          ...evidence(
            `${current.member.id}:expiry`,
            "passed",
            current.member.origin,
          ),
          httpStatus: 401,
        });
      }
      return results;
    },
    async runPostCleanupHarness(_lease, signal) {
      const results: HostedHarnessEvidence[] = [];
      const fetchFn = abortableFetch(deps.fetchFn, signal);
      try {
        for (const current of active) {
          const rejected = await expectRejected4xx(
            fetchFn,
            current.member.mcpUrl,
            {
              headers: { Authorization: `Bearer ${current.token}` },
            },
          );
          results.push({
            ...evidence(
              `${current.member.id}:post-cleanup`,
              "passed",
              current.member.origin,
            ),
            httpStatus: rejected.status,
          });
        }
        return results;
      } finally {
        await Promise.all(
          active.map(({ browser }) => closeWithTimeout(browser.close)),
        );
      }
    },
  };
  try {
    const receipt = await executeTrustedAcceptance(profile, controller);
    assertRedacted(receipt);
    return receipt;
  } finally {
    try {
      assertRedacted(deployments);
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(
          files.deployResultFile,
          `${JSON.stringify({ version: 1, deployments }, null, 2)}\n`,
          "utf8",
        ),
      );
    } finally {
      await Promise.all(
        active.map(({ browser }) => browser.close().catch(() => undefined)),
      );
      await deps.browserFactory.close?.();
    }
  }
}

export function parseHostedAcceptanceCliArgs(
  args: readonly string[],
): HostedAcceptanceFiles {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !value || !flag.startsWith("--") || flags.has(flag))
      throw new Error(
        "usage: run-hosted-acceptance --plan <file> --profile <file> --deploy-manifest <file> --journal <file> --receipt <file> --deploy-result <file>",
      );
    flags.set(flag, value);
  }
  const expected = [
    "--plan",
    "--profile",
    "--deploy-manifest",
    "--journal",
    "--receipt",
    "--deploy-result",
  ] as const;
  if (
    flags.size !== expected.length ||
    expected.some((flag) => !flags.has(flag))
  )
    throw new Error(
      "usage: run-hosted-acceptance --plan <file> --profile <file> --deploy-manifest <file> --journal <file> --receipt <file> --deploy-result <file>",
    );
  return {
    planFile: flags.get("--plan")!,
    profileFile: flags.get("--profile")!,
    deployManifestFile: flags.get("--deploy-manifest")!,
    journalFile: flags.get("--journal")!,
    receiptFile: flags.get("--receipt")!,
    deployResultFile: flags.get("--deploy-result")!,
  };
}

/** The CLI has no secret flags: protected management values are process-only. */
async function main(): Promise<void> {
  const files = parseHostedAcceptanceCliArgs(process.argv.slice(2));
  // Launch before reading protected provider credentials; browser setup can fail without any runtime authority.
  const playwright = await import("@playwright/test");
  const browser = await playwright.chromium.launch({ headless: true });
  const browserFactory: HostedQaBrowserFactory = {
    async create(origin) {
      const page = await createIsolatedQaPage(browser, origin);
      return { adapter: page.adapter, close: () => page.context.close() };
    },
    close: () => browser.close(),
  };
  try {
    const receipt = await runHostedAcceptance(files, {
      providers: createAmbientRuntimeProviders(),
      fetchFn: fetch,
      browserFactory,
      createLoopbackCallback: () => startLoopbackCallbackListener(),
    });
    process.stdout.write(
      `${JSON.stringify({ result: receipt.result, workspace: receipt.workspace })}\n`,
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith("run-hosted-acceptance.ts")) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
