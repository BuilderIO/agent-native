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
 * Everything here fails soft. No credential, a non-Postgres database, the org's
 * flag off, the gateway unreachable — all resolve to `null`, the token mint
 * 404s, and the client stays on the app's own `/_agent-native/poll`.
 */

import { createHash } from "node:crypto";

import { getDatabaseUrl, isPgliteUrl, isPostgres } from "../db/client.js";
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
import { resolveSelfDispatchBaseUrl } from "./self-dispatch.js";

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

/**
 * Well under the 10s serverless synchronous-function ceiling (and under the
 * client's own 10s mint abort). At 10s a black-holed POST gets the whole
 * function killed by the platform before the handler can return its 404, and
 * the client reads that 5xx as transient and retries into more cold starts.
 */
const REGISTER_TIMEOUT_MS = 4_000;

/**
 * How long a failed registration is remembered. Without it every request on a
 * flag-off deployment re-POSTs to the gateway; a 403 is a stable answer and
 * deserves to be treated as one.
 */
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;

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
/** Single-flight, keyed by fingerprint: concurrent requests on a cold isolate
 * must not all POST, but a caller whose inputs changed mid-flight must not be
 * served the previous inputs' channel either. */
let inFlight: {
  fingerprint: string;
  promise: Promise<RealtimeChannel | null>;
} | null = null;

/**
 * The inputs of the most recently STARTED attempt.
 *
 * An attempt whose fingerprint is no longer this one has been superseded, and
 * must not write the memo or the settings row when it finally resolves: it
 * would restore the pre-rotation channel over the current one, and the next
 * request would then see a fingerprint miss and register all over again.
 */
let currentFingerprint: string | null = null;

/** Test seam. */
export function resetRealtimeRegistrationCache(): void {
  memo = null;
  inFlight = null;
  currentFingerprint = null;
}

/**
 * True when the last resolution failed to REACH the gateway, as opposed to
 * being told no. Read by the health probe, which promises that split; every
 * other caller only needs the channel.
 */
export function realtimeRegistrationUnavailable(): boolean {
  return memo?.result.channel === null && memo.result.failure === "unavailable";
}

export function isHostedRealtimeTransport(): boolean {
  // config-ok: this exact predicate also ships as generated worker source in
  // `deploy/build.ts`, which has no app-config at runtime, and as a copy in
  // import-cycle-sensitive `poll.ts`. All three must agree byte-for-byte
  // (`realtime-transport-gate.spec.ts`), so none of them can route through
  // getAppConfig().
  return process.env.AGENT_NATIVE_REALTIME_TRANSPORT?.trim() === "hosted";
}

/**
 * What the stored channel is keyed to. The Builder credential is in here as
 * well as the database and origin: the gateway scopes a channel to the ORG the
 * key resolves to, so swapping `BUILDER_PRIVATE_KEY` to a different org has to
 * re-register. Without it an app moved between orgs kept minting tokens
 * against the old org's channel forever — the new org's rollout flag,
 * suspension and cap accounting never applying to it, the old org's governing
 * an app that no longer holds its credential.
 */
function fingerprintOf(
  databaseUrl: string,
  appUrl: string,
  privateKey: string,
): string {
  return createHash("sha256")
    .update(`${databaseUrl}\n${appUrl}\n${privateKey}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * A database the gateway could actually dial from its own network.
 *
 * `isPostgres()` alone is too generous: it reports true for PGlite and for any
 * `postgres://` host including localhost and VPC-private addresses. The server
 * refuses those, so registering one only fails — but it fails *after* the
 * connection string has already left the machine, and a credential we know is
 * unusable should never be sent at all.
 */
function isRegisterableDatabase(databaseUrl: string): boolean {
  if (!isPostgres() || isPgliteUrl(databaseUrl)) return false;
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    // An unparseable connection string is not a registerable one, and it is
    // also a real misconfiguration the operator should see rather than
    // discover as "hosted realtime silently never turned on".
    console.warn(
      "[realtime] DATABASE_URL is not a parseable URL; staying on local sync",
    );
    return false;
  }
  if (!host || host === "localhost" || host.endsWith(".local")) return false;
  if (host.endsWith(".internal") || host.endsWith(".svc.cluster.local")) {
    return false;
  }
  // Any IP literal: the gateway rejects these, and a bare address is never a
  // managed-Postgres endpoint.
  return !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.includes(":");
}

/**
 * Everything the gateway needs, or null if this deployment can't self-register.
 */
function collectInputs(): RegistrationInputs | null {
  const databaseUrl = getDatabaseUrl().trim();
  if (!databaseUrl || !isRegisterableDatabase(databaseUrl)) return null;

  // Production deploys only. A deploy preview has its own self URL, so it would
  // register its OWN channel — correct for isolation, but a busy repo mints one
  // per pull request and burns the per-org cap on branches that are gone a day
  // later. It also means a preview's throwaway database credential never leaves
  // the machine. Previews keep local sync, which is what they had before.
  if (resolveDeployEnvironment() !== "production") return null;

  // A Builder workspace container carries an env key it does not own. Sharing
  // the container's dev database under that key's org is the exact conflation
  // `canUseBuilderDeployCredentialFallbackForRequest` exists to prevent, so
  // this path declines there rather than inheriting someone else's identity.
  //
  // The predicate is broader than that rationale: `AGENT_NATIVE_WORKSPACE` is
  // also baked into the function wrappers of a customer's own
  // `agent-native deploy` workspace bundle, so a customer workspace app
  // deployed to their own Netlify/Vercel declines here too. That is deliberate
  // for now — sibling apps in a workspace share one origin, and the gateway
  // upserts on (org, origin), so they would collide on one channel and repoint
  // each other's database. It is not obvious from `registered: false`, so say
  // it once rather than leaving an operator to infer it from the rollout flag.
  if (isHostedWorkspaceRuntime()) {
    warnOnce(
      "workspace",
      "[realtime] hosted realtime self-registration is not available to workspace deployments; staying on local sync",
    );
    return null;
  }

  // Deployment-level only, via the one resolver for that key. A per-user
  // Builder OAuth connection authorizes that user's LLM calls; it must not
  // silently register the whole deployment's database under whichever org
  // happened to make the first request.
  const privateKey = readDeployCredentialEnv("BUILDER_PRIVATE_KEY")?.trim();
  if (!privateKey) return null;

  // This deployment's OWN address, not the app's canonical URL. They differ on
  // a deploy preview, and the gateway upserts a registration on (org, appUrl):
  // a preview posting the production origin with its own branch database would
  // repoint production's channel at the preview database.
  //
  // `resolveSelfDispatchBaseUrl` prefers the platform's per-deploy vars but
  // falls back to `app.url`, the CANONICAL origin, which every environment
  // built from the production env file shares. Registering that from a process
  // that is NOT the production deployment is the failure the preview check
  // above exists to prevent, arriving by a different door: a built server run
  // on a laptop against a branch database resolves "production" (the default
  // when no platform context vars are set) and repoints production's channel.
  // Production never heals — its own stored fingerprint still matches, so it
  // never re-registers — and tails the wrong database indefinitely.
  //
  // So the fallback additionally requires a marker written by the PLATFORM —
  // `hasPlatformRuntimeMarker`, not `isProductionLikeRuntime`. The difference
  // is the whole guard: `NODE_ENV=production` lives in the app's own env file
  // and therefore travels to a laptop with a copied `.env`, which is precisely
  // the process this is meant to exclude.
  const fromPlatform = Boolean(
    process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || process.env.URL,
  );
  if (!fromPlatform && !hasPlatformRuntimeMarker()) {
    warnOnce(
      "self-url",
      "[realtime] no per-deploy URL from the platform and no platform runtime marker, so " +
        "this could be a local run of a production build; refusing to register the app's " +
        "canonical origin. Staying on local sync. Set URL (or DEPLOY_URL) to this " +
        "deployment's own origin on a self-hosted deploy.",
    );
    return null;
  }

  let origin: string;
  try {
    origin = new URL(resolveSelfDispatchBaseUrl()).origin;
  } catch {
    console.warn(
      "[realtime] this deployment has no parseable self URL; staying on local sync",
    );
    return null;
  }

  return {
    databaseUrl,
    appUrl: origin,
    privateKey,
    fingerprint: fingerprintOf(databaseUrl, origin, privateKey),
  };
}

/** One line per reason per process: these are boot-time facts, not events. */
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
    // Only the fingerprint gates reuse. There was a time-based revalidation
    // here as well, to catch a channel rotated gateway-side — but nothing
    // rotates one today, so it bought nothing and made every healthy app
    // re-register twice a day. When rotation exists, the trigger should be the
    // gateway rejecting a token, not a blind timer.
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
    // Settings table not ready (first boot, migration in flight). Registering
    // again is idempotent, so falling through is safe — but an unreadable store
    // is not the same as "never registered", and a persistent read failure that
    // re-POSTs on every cold start should be visible rather than inferred from
    // gateway traffic.
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
  // `sentry-config.ts` and the generated worker source, or the app registers on
  // one gateway and the browser connects to another.
  const explicit = process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL?.trim();
  if (explicit) return `${explicit.replace(/\/+$/, "")}/register`;
  return `${getBuilderGatewayBaseUrl().replace(/\/+$/, "")}/realtime/register`;
}

/** The server's disambiguating `{code}`, or undefined if it sent none. */
async function readRejectionCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body?.code === "string" ? body.code : undefined;
  } catch {
    // coercion-ok: "sent no code" and "sent an unparseable body" are the same
    // answer to the caller, which logs the status either way.
    return undefined;
  }
}

async function postRegistration(
  inputs: RegistrationInputs,
): Promise<RegistrationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS);
  try {
    // Inside the try: a throw here (a non-string base, a malformed override)
    // must resolve to null like every other failure, not reject into the mint.
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
      // A 403 is NOT only "the org isn't in the rollout yet". The same status
      // comes back for a revoked or malformed key, an org that opted out of
      // the gateway, a suspended org, an unverified email, and a PAT policy
      // rejection — and the server distinguishes them in the body's `code`.
      // Swallowing all of them sent an operator whose key was revoked to check
      // a rollout flag, while the deployment silently re-POSTed every ten
      // minutes forever with nothing in the logs.
      const code =
        res.status === 403 ? await readRejectionCode(res) : undefined;
      if (code !== "flag_off") {
        console.warn(
          `[realtime] gateway registration failed (${res.status}${code ? `: ${code}` : ""}); staying on local sync`,
        );
      }
      // The gateway answered. A 5xx is the one status that is a failure to
      // serve rather than a decision, so it reads as unavailable.
      return {
        channel: null,
        failure: res.status >= 500 ? "unavailable" : "declined",
      };
    }
    const body = (await res.json()) as Partial<RealtimeChannel>;
    // Types, not truthiness. `{ channelId: {} }` is truthy, and it would then
    // reach `createHash().update()` in the health probe and the token signer,
    // where a non-string throws — turning a bad gateway response into a 500 on
    // routes whose entire contract is to fail soft to local sync.
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
    // Abort, DNS, connection refused, unreadable body: we never got an answer.
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

  // A superseded attempt must not persist: its channel is the one the current
  // inputs just moved away from, and writing it here would also make the next
  // request miss on fingerprint and register a third time.
  if (currentFingerprint !== inputs.fingerprint) return result;

  try {
    // Fans out no sync event, in either direction: `poll.ts` skips this key
    // when wiring the settings emitter (this process) and excludes it from the
    // settings watermark (every other live isolate), the same way it handles
    // the change-marker keys.
    await putSetting(REGISTRATION_SETTING_KEY, {
      channelId: channel.channelId,
      hmacSecretEncrypted: encryptSecretValue(channel.hmacSecret),
      fingerprint: inputs.fingerprint,
      registeredAt: Date.now(),
    } satisfies StoredRegistration);
  } catch (err) {
    // Worth using for this process even if it can't be persisted; the next cold
    // start just registers again, which the gateway treats as the same channel.
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
    if (memo.result.channel) return memo.result.channel;
    if (Date.now() - memo.at < FAILURE_BACKOFF_MS) return null;
  }

  // Reuse an in-flight attempt only when it is for THESE inputs. A rotation
  // mid-flight must not be answered with the previous inputs' channel, and its
  // own fingerprint must still get registered.
  if (inFlight?.fingerprint === inputs.fingerprint) return inFlight.promise;

  currentFingerprint = inputs.fingerprint;
  const attempt = register(inputs)
    .then((result) => {
      // Same reason `register` skips the persist: a superseded attempt
      // resolving late must not put the pre-rotation channel back in the memo
      // on top of the current one.
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
