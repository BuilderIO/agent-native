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
import { getSetting, putSetting } from "../settings/store.js";
import {
  getBuilderGatewayBaseUrl,
  isHostedWorkspaceRuntime,
  readDeployCredentialEnv,
} from "./credential-provider.js";
import { resolveDeployEnvironment } from "./deploy-environment.js";
import { resolveSelfDispatchBaseUrl } from "./self-dispatch.js";

/**
 * Deployment-wide, so this lives in the plain settings store rather than
 * `app_secrets` — that store scopes every row to a user, org or workspace, and
 * a realtime channel belongs to none of them. The row holds an HMAC secret, so
 * treat it like one: it is never returned by an app route, and the two
 * `getAllSettings` consumers both filter to `mcp-servers-remote` keys.
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

interface StoredRegistration extends RealtimeChannel {
  /**
   * Digest of the inputs the channel was registered with. A rotated database
   * password or a changed app origin changes this, which is what triggers
   * re-registration — the gateway upserts on (org, appUrl) and hands back the
   * same channel, so a rotation never invalidates a live stream.
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

let memo: {
  fingerprint: string;
  channel: RealtimeChannel | null;
  at: number;
} | null = null;
/** Single-flight, keyed by fingerprint: concurrent requests on a cold isolate
 * must not all POST, but a caller whose inputs changed mid-flight must not be
 * served the previous inputs' channel either. */
let inFlight: {
  fingerprint: string;
  promise: Promise<RealtimeChannel | null>;
} | null = null;

/** Test seam. */
export function resetRealtimeRegistrationCache(): void {
  memo = null;
  inFlight = null;
}

export function isHostedRealtimeTransport(): boolean {
  // config-ok: this exact predicate also ships as generated worker source in
  // `deploy/build.ts`, which has no app-config at runtime, and as a copy in
  // import-cycle-sensitive `poll.ts`. All three must agree byte-for-byte
  // (`realtime-transport-gate.spec.ts`), so none of them can route through
  // getAppConfig().
  return process.env.AGENT_NATIVE_REALTIME_TRANSPORT?.trim() === "hosted";
}

function fingerprintOf(databaseUrl: string, appUrl: string): string {
  return createHash("sha256")
    .update(`${databaseUrl}\n${appUrl}`)
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
  if (isHostedWorkspaceRuntime()) return null;

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
    fingerprint: fingerprintOf(databaseUrl, origin),
  };
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
      stored.hmacSecret &&
      stored.fingerprint === fingerprint
    ) {
      return { channelId: stored.channelId, hmacSecret: stored.hmacSecret };
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

async function postRegistration(
  inputs: RegistrationInputs,
): Promise<RealtimeChannel | null> {
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
      // 403 means the org isn't in the rollout yet — expected, not an error.
      if (res.status !== 403) {
        console.warn(
          `[realtime] gateway registration failed (${res.status}); staying on local sync`,
        );
      }
      return null;
    }
    const body = (await res.json()) as Partial<RealtimeChannel>;
    if (!body?.channelId || !body?.hmacSecret) return null;
    return { channelId: body.channelId, hmacSecret: body.hmacSecret };
  } catch (err) {
    console.warn(
      `[realtime] gateway registration failed (${(err as Error)?.message ?? err}); staying on local sync`,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function register(
  inputs: RegistrationInputs,
): Promise<RealtimeChannel | null> {
  const stored = await readStored(inputs.fingerprint);
  if (stored) return stored;

  const channel = await postRegistration(inputs);
  if (!channel) return null;

  try {
    // Fans out no sync event: `poll.ts` skips this key when wiring the settings
    // emitter, the same way it skips the change-marker keys.
    await putSetting(REGISTRATION_SETTING_KEY, {
      ...channel,
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
  return channel;
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
    if (memo.channel) return memo.channel;
    if (Date.now() - memo.at < FAILURE_BACKOFF_MS) return null;
  }

  // Reuse an in-flight attempt only when it is for THESE inputs. A rotation
  // mid-flight must not be answered with the previous inputs' channel, and its
  // own fingerprint must still get registered.
  if (inFlight?.fingerprint === inputs.fingerprint) return inFlight.promise;

  const attempt = register(inputs)
    .then((channel) => {
      memo = { fingerprint: inputs.fingerprint, channel, at: Date.now() };
      return channel;
    })
    .finally(() => {
      if (inFlight?.fingerprint === inputs.fingerprint) inFlight = null;
    });
  inFlight = { fingerprint: inputs.fingerprint, promise: attempt };
  return attempt;
}
