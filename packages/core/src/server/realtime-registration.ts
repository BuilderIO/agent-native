/**
 * Self-registration with the Builder Realtime Gateway.
 *
 * Apps deployed by the Builder hosting pipeline are handed a channel id and an
 * HMAC secret as reserved env vars, because the pipeline already knows their
 * database — it provisioned it. An app deployed anywhere else has neither, and
 * the gateway has no way to reach its database at all, so hosted realtime was
 * effectively pipeline-only.
 *
 * This closes that gap from the app's side: when hosted transport is on and no
 * channel was injected, the app tells the gateway its own Postgres URL and
 * public origin, authenticating with the deployment's `BUILDER_PRIVATE_KEY` —
 * the same credential it already holds for the LLM gateway. It gets back a
 * channel id and secret and mints subscribe tokens exactly as a pipeline app
 * does.
 *
 * Registration runs on demand rather than from a CLI so it self-heals: the
 * database URL, the app origin and the secret all follow the deployment. A
 * connection string pasted once by hand goes stale on rotation and takes the
 * tail down silently.
 *
 * Everything here fails soft. No credential, the org's
 * flag off, the gateway unreachable — all resolve to `null`, the token mint
 * 404s, and the client stays on the app's own `/_agent-native/poll`.
 */

import { createHash } from "node:crypto";

import { getDatabaseUrl, isPgliteUrl } from "../db/client.js";
import { REALTIME_REGISTRATION_SETTING_KEY } from "../realtime-registration-key.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import { getSetting, putSetting } from "../settings/store.js";
import {
  getBuilderGatewayBaseUrl,
  hasPlatformRuntimeMarker,
  isHostedWorkspaceRuntime,
  readDeployCredentialEnv,
} from "./credential-provider.js";
import { resolveDeployEnvironment } from "./deploy-environment.js";
import { resolveDeploymentBaseUrl } from "./self-dispatch.js";

/**
 * Deployment-wide, so this lives in the plain settings store rather than
 * `app_secrets` — that store scopes every row to a user, org or workspace, and
 * a realtime channel belongs to none of them. The row holds an HMAC secret, so
 * treat it like one: the secret is stored ENCRYPTED (see `StoredRegistration`),
 * it is never returned by an app route, and the two `getAllSettings` consumers
 * both filter to `mcp-servers-remote` keys.
 *
 * The key is declared in its own module because `poll.ts` skips it when wiring
 * the settings emitter into the sync log and cannot import this one.
 */
const REGISTRATION_SETTING_KEY = REALTIME_REGISTRATION_SETTING_KEY;

const REGISTER_TIMEOUT_MS = 4_000;

const FAILURE_BACKOFF_MS = 10 * 60 * 1000;

const UNAVAILABLE_BACKOFF_MS = 30 * 1000;

export interface RealtimeChannel {
  channelId: string;
  hmacSecret: string;
}

interface StoredRegistration {
  channelId: string;
  /**
   * AES-256-GCM ciphertext (`v1:…`), not the secret.
   *
   * This row lives in the app's OWN database, and the standard way to make a
   * preview or a dev branch is to copy that database — Neon's branches are
   * copy-on-write clones of production. A plaintext secret here would ride
   * along, and channel id + secret is the entire subscribe-token auth story:
   * read access to any branch would mint valid tokens for arbitrary
   * owner/orgId against the PRODUCTION channel. The key material is env-only
   * (`*_SECRETS_ENCRYPTION_KEY` / `SECRETS_ENCRYPTION_KEY` /
   * `BETTER_AUTH_SECRET`), so a copied database carries ciphertext and nothing
   * that opens it.
   */
  hmacSecretEncrypted: string;
  /**
   * Digest of the inputs the channel was registered with. A rotated database
   * password, a changed app origin or a swapped Builder credential changes
   * this, which is what triggers re-registration — the gateway upserts on
   * (org, appUrl) and hands back the same channel, so a rotation never
   * invalidates a live stream.
   */
  fingerprint: string;
  registeredAt: number;
}

interface RegistrationInputs {
  databaseUrl: string;
  appUrl: string;
  privateKey: string;
  fingerprint: string;
}

/**
 * Why there is no channel. `declined` is an answer from the gateway (the org
 * is not in the rollout, the credential was refused, the body was unusable);
 * `unavailable` is not an answer at all (timeout, DNS, connection refused).
 * `/_agent-native/health` reports them as different fields on purpose — "this
 * deploy has no channel" and "we could not find out" send you to different
 * places — so the distinction must survive the resolver rather than
 * collapsing into `null` here.
 */
type RegistrationFailure = "declined" | "unavailable";
type RegistrationResult =
  | { channel: RealtimeChannel }
  | { channel: null; failure: RegistrationFailure };

let memo: {
  fingerprint: string;
  result: RegistrationResult;
  at: number;
} | null = null;
let inFlight: {
  fingerprint: string;
  promise: Promise<RealtimeChannel | null>;
} | null = null;

let currentFingerprint: string | null = null;

export function resetRealtimeRegistrationCache(): void {
  memo = null;
  inFlight = null;
  currentFingerprint = null;
}

export function realtimeRegistrationUnavailable(): boolean {
  return memo?.result.channel === null && memo.result.failure === "unavailable";
}

export function isHostedRealtimeTransport(): boolean {
  // config-ok: this exact predicate also ships as generated worker source in
  return process.env.AGENT_NATIVE_REALTIME_TRANSPORT?.trim() === "hosted";
}

/**
 * What the stored channel is keyed to.
 *
 * The Builder credential is in here as well as the database and origin: the
 * gateway scopes a channel to the ORG the key resolves to, so swapping
 * `BUILDER_PRIVATE_KEY` to a different org has to re-register. Without it an
 * app moved between orgs kept minting tokens against the old org's channel
 * forever — the new org's suspension and cap accounting never applying to it,
 * the old org's governing an app that no longer holds its credential.
 *
 * So is the gateway endpoint, for the reason `registrationEndpoint` states:
 * the channel only exists on the gateway it was registered with. Repointing an
 * app from staging to production (or vice versa) leaves the stored fingerprint
 * matching, so without this the app reuses a channel the new gateway has never
 * heard of and every connect fails against a secret one side has never seen.
 */
function fingerprintOf(
  databaseUrl: string,
  appUrl: string,
  privateKey: string,
  endpoint: string,
): string {
  return createHash("sha256")
    .update(`${databaseUrl}\n${appUrl}\n${privateKey}\n${endpoint}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * A database the gateway could actually dial from its own network.
 *
 * A URL check alone is too generous: it accepts PGlite and any Postgres host
 * including localhost and VPC-private addresses. The server refuses those, so
 * registering one only fails - but it fails *after* the
 * connection string has already left the machine, and a credential we know is
 * unusable should never be sent at all.
 *
 * Spelling only, and deliberately so. A name like `127.0.0.1.nip.io` resolves
 * to loopback while looking nothing like it, and no lexical test catches that
 * class. The gateway is where the policy is actually enforced: it resolves
 * every address at register AND at connect (`isPublicDatabaseHost`) and
 * re-checks inside the socket's own `lookup` on every dial, so a name that
 * changes its answer later still cannot be reached. This function only keeps a
 * credential we already know is unusable from leaving the machine.
 */
function isRegisterableDatabase(databaseUrl: string): boolean {
  if (isPgliteUrl(databaseUrl)) return false;
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    console.warn(
      "[realtime] DATABASE_URL is not a parseable URL; staying on local sync",
    );
    return false;
  }
  if (!host || host === "localhost" || host.endsWith(".local")) return false;
  if (host.endsWith(".internal") || host.endsWith(".svc.cluster.local")) {
    return false;
  }
  return !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.includes(":");
}

function collectInputs(): RegistrationInputs | null {
  const databaseUrl = getDatabaseUrl().trim();
  if (!databaseUrl || !isRegisterableDatabase(databaseUrl)) return null;

  // later. It also means a preview's throwaway database credential never leaves
  if (resolveDeployEnvironment() !== "production") return null;

  if (isHostedWorkspaceRuntime()) {
    warnOnce(
      "workspace",
      "[realtime] hosted realtime self-registration is not available to workspace deployments; staying on local sync",
    );
    return null;
  }

  const privateKey = readDeployCredentialEnv("BUILDER_PRIVATE_KEY")?.trim();
  if (!privateKey) return null;

  // config-ok: read raw, like the other realtime env vars in this module —
  // it gates whether a credential leaves the machine, so it must not depend on
  const declaredAppUrl = process.env.AGENT_NATIVE_REALTIME_APP_URL?.trim();
  const fromPlatform = Boolean(
    process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL,
  );
  if (!declaredAppUrl && !fromPlatform && !hasPlatformRuntimeMarker()) {
    warnOnce(
      "self-url",
      "[realtime] this process shows no sign of being the deployment that serves the app's " +
        "origin (no platform runtime marker, no per-deploy platform URL), so registering " +
        "that origin could repoint production's channel; staying on local sync. On a " +
        "self-hosted deploy set AGENT_NATIVE_REALTIME_APP_URL to this deployment's own " +
        "origin.",
    );
    return null;
  }

  let origin: string;
  try {
    origin = new URL(declaredAppUrl || resolveDeploymentBaseUrl()).origin;
  } catch {
    console.warn(
      "[realtime] this deployment has no parseable self URL; staying on local sync",
    );
    return null;
  }

  let endpoint: string;
  try {
    endpoint = registrationEndpoint();
  } catch {
    console.warn(
      "[realtime] the gateway endpoint could not be resolved; staying on local sync",
    );
    return null;
  }

  return {
    databaseUrl,
    appUrl: origin,
    privateKey,
    fingerprint: fingerprintOf(databaseUrl, origin, privateKey, endpoint),
  };
}

const warnedOnce = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

async function readStored(
  fingerprint: string,
): Promise<RealtimeChannel | null> {
  try {
    const stored = (await getSetting(
      REGISTRATION_SETTING_KEY,
    )) as StoredRegistration | null;
    if (
      stored?.channelId &&
      stored.hmacSecretEncrypted &&
      stored.fingerprint === fingerprint
    ) {
      return {
        channelId: stored.channelId,
        hmacSecret: decryptSecretValue(stored.hmacSecretEncrypted),
      };
    }
  } catch (err) {
    console.warn(
      `[realtime] could not read the stored registration (${(err as Error)?.message ?? err}); re-registering`,
    );
  }
  return null;
}

/**
 * Where to register. MUST resolve to the same gateway the browser is sent to by
 * `resolveRealtimeClientConfig` — registering on production while the client
 * talks to staging mints a secret one side has never seen, and every connect
 * 401s. `AGENT_NATIVE_REALTIME_GATEWAY_URL` is the client's override, so it is
 * this function's override too.
 */
function registrationEndpoint(): string {
  // config-ok: must read the same raw env var as the client-config emitters in
  const explicit = process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL?.trim();
  if (explicit) return `${explicit.replace(/\/+$/, "")}/register`;
  return `${getBuilderGatewayBaseUrl().replace(/\/+$/, "")}/realtime/register`;
}

async function readRejectionCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body?.code === "string" ? body.code : undefined;
  } catch {
    // coercion-ok: "sent no code" and "sent an unparseable body" are the same
    return undefined;
  }
}

async function postRegistration(
  inputs: RegistrationInputs,
): Promise<RegistrationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS);
  try {
    const res = await fetch(registrationEndpoint(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${inputs.privateKey}`,
      },
      body: JSON.stringify({
        appUrl: inputs.appUrl,
        databaseUrl: inputs.databaseUrl,
      }),
    });
    if (!res.ok) {
      const code =
        res.status === 403 ? await readRejectionCode(res) : undefined;
      if (code !== "flag_off") {
        console.warn(
          `[realtime] gateway registration failed (${res.status}${code ? `: ${code}` : ""}); staying on local sync`,
        );
      }
      return {
        channel: null,
        failure: res.status >= 500 ? "unavailable" : "declined",
      };
    }
    const body = (await res.json()) as Partial<RealtimeChannel>;
    const channelId = typeof body?.channelId === "string" ? body.channelId : "";
    const hmacSecret =
      typeof body?.hmacSecret === "string" ? body.hmacSecret : "";
    if (!channelId || !hmacSecret) {
      console.warn(
        "[realtime] gateway returned an unusable channel; staying on local sync",
      );
      return { channel: null, failure: "declined" };
    }
    return { channel: { channelId, hmacSecret } };
  } catch (err) {
    console.warn(
      `[realtime] gateway registration failed (${(err as Error)?.message ?? err}); staying on local sync`,
    );
    return { channel: null, failure: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

async function register(
  inputs: RegistrationInputs,
): Promise<RegistrationResult> {
  const stored = await readStored(inputs.fingerprint);
  if (stored) return { channel: stored };

  const result = await postRegistration(inputs);
  const channel = result.channel;
  if (!channel) return result;

  if (currentFingerprint !== inputs.fingerprint) return result;

  try {
    await putSetting(REGISTRATION_SETTING_KEY, {
      channelId: channel.channelId,
      hmacSecretEncrypted: encryptSecretValue(channel.hmacSecret),
      fingerprint: inputs.fingerprint,
      registeredAt: Date.now(),
    } satisfies StoredRegistration);
  } catch (err) {
    console.warn(
      `[realtime] could not persist the registration (${(err as Error)?.message ?? err}); it will be re-fetched next cold start`,
    );
  }
  return result;
}

/**
 * The channel this deployment registered for itself, or null.
 *
 * Callers should prefer an injected channel (the pipeline's env vars) over this
 * — see `realtime-token.ts`. Cheap on the hot path: one in-process memo, one
 * settings read on a cold isolate, and a network call only when the inputs
 * changed or nothing was stored.
 */
export async function resolveRegisteredRealtimeChannel(): Promise<RealtimeChannel | null> {
  if (!isHostedRealtimeTransport()) return null;

  const inputs = collectInputs();
  if (!inputs) return null;

  if (memo && memo.fingerprint === inputs.fingerprint) {
    const cached = memo.result;
    if (cached.channel) return cached.channel;
    const backoff =
      "failure" in cached && cached.failure === "unavailable"
        ? UNAVAILABLE_BACKOFF_MS
        : FAILURE_BACKOFF_MS;
    if (Date.now() - memo.at < backoff) return null;
  }

  if (inFlight?.fingerprint === inputs.fingerprint) return inFlight.promise;

  currentFingerprint = inputs.fingerprint;
  const attempt = register(inputs)
    .then((result) => {
      if (currentFingerprint === inputs.fingerprint) {
        memo = { fingerprint: inputs.fingerprint, result, at: Date.now() };
      }
      return result.channel;
    })
    .finally(() => {
      if (inFlight?.fingerprint === inputs.fingerprint) inFlight = null;
    });
  inFlight = { fingerprint: inputs.fingerprint, promise: attempt };
  return attempt;
}
