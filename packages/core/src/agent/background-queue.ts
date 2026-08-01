/**
 * Cloudflare Queues transport for durable background runs.
 *
 * The Netlify handoff is an HTTP POST to a function url that carries its own
 * 15-minute budget. Cloudflare has no such url: a request-triggered invocation
 * is unbounded only while a client stays connected, and the foreground returns
 * immediately by design. A queue consumer invocation is the equivalent budget
 * (15 minutes of wall time, documented), so the handoff becomes a queue send.
 * See `docs/adr/0003-cloudflare-queues-for-durable-background-runs.md`.
 *
 * This module owns ONLY the producer half — resolving the binding and putting
 * one message on it. The consumer half is the generated Worker entry
 * (`generateCloudflareModuleWorkerEntry` in deploy/build.ts), which reads the
 * envelope written here, synthesises a request to the processor route, and
 * delegates to the same handler that serves fetch.
 *
 * Every failure mode here is a DISTINCT typed value, never a coerced success:
 * an unbound binding, a refused oversized payload, and a rejected send are
 * three different conditions with three different repairs, and the caller
 * degrades to an inline run on any of them.
 */
import { signInternalToken } from "../integrations/internal-token.js";
import { isCloudflareRuntime } from "../shared/runtime.js";

/**
 * Producer binding the build emits into the generated Worker configuration.
 * The framework resolves the queue through THIS name only — an app that binds
 * its own queue under a different name is not the durable background transport.
 */
export const AGENT_BACKGROUND_QUEUE_BINDING = "AGENT_NATIVE_BACKGROUND_QUEUE";

/**
 * Queue name emitted for a Worker. Derived from the Worker's own name so two
 * apps in one Cloudflare account never share a background queue — a shared
 * queue would let one app's consumer claim the other's run and synthesise a
 * request to a processor route that does not exist there.
 */
export function agentBackgroundQueueName(workerName: string): string {
  return `${workerName}-agent-background`;
}

/**
 * Documented per-message cap for Cloudflare Queues: 128 KB (a batch may hold
 * 100 messages but no more than 256 KB in total; we send one message at a
 * time). Cloudflare serialises with the structured-clone algorithm rather than
 * JSON, so the JSON byte length below is a proxy — deliberately compared
 * against the full cap with no fudge factor, because the fallback for an
 * oversized payload is a working inline run, not a lost turn.
 */
export const BACKGROUND_QUEUE_MESSAGE_MAX_BYTES = 128 * 1024;

/**
 * Discriminator on the envelope. The consumer refuses to interpret a message
 * that does not carry it rather than guessing at a foreign message's shape.
 */
export const BACKGROUND_QUEUE_MESSAGE_KIND = "agent-native-background-run";

/** Envelope the producer writes and the generated consumer reads. */
export interface BackgroundQueueMessage {
  kind: typeof BACKGROUND_QUEUE_MESSAGE_KIND;
  /** Run/task id the processor claims. Signed over by `authorization`. */
  taskId: string;
  /**
   * The `Authorization: Bearer <internal token>` header value, signed here and
   * carried verbatim so the queue handoff authenticates exactly like the HTTP
   * handoff does. Null only where `fireInternalDispatch` also sends unsigned:
   * no `A2A_SECRET`, which the durable gate already refuses to open without.
   */
  authorization: string | null;
  /** Origin the consumer builds the synthesised request URL against. */
  origin: string;
  /** JSON body the processor route receives, processor-selection field and all. */
  body: Record<string, unknown>;
}

/** Minimal shape of a Cloudflare Queue producer binding. */
interface QueueProducerLike {
  send(message: unknown): Promise<void>;
}

/**
 * The one refusal that is not a failure of the transport: the payload is too
 * large to send at all. Typed so the caller can tell "we refused to truncate
 * your payload" apart from "the queue rejected the send", which is the whole
 * point — a truncated payload would run a DIFFERENT turn than the one asked
 * for, and look like a completed one.
 */
export class OversizedBackgroundQueueMessageError extends Error {
  readonly byteLength: number;
  readonly maxByteLength: number;
  constructor(byteLength: number, maxByteLength: number) {
    super(
      `[agent-chat] refusing to enqueue a ${byteLength}-byte durable background message: ` +
        `Cloudflare Queues caps a message at ${maxByteLength} bytes. The payload is NOT ` +
        "truncated — this run degrades to an inline run instead.",
    );
    this.name = "OversizedBackgroundQueueMessageError";
    this.byteLength = byteLength;
    this.maxByteLength = maxByteLength;
  }
}

function readCloudflareEnv(): Record<string, unknown> | null {
  const scope = globalThis as {
    __cf_env?: Record<string, unknown>;
    __env__?: Record<string, unknown>;
  };
  return scope.__cf_env ?? scope.__env__ ?? null;
}

/**
 * The bound producer, or null when nothing is bound. Null is "absent", not
 * "unreadable": a binding that exists but has no `send` is a configuration
 * error, and it too resolves to null here so the caller falls back — but it is
 * reported, because a named binding that cannot send is not the same fact as
 * no binding at all.
 */
export function resolveBackgroundQueueProducer(): QueueProducerLike | null {
  const env = readCloudflareEnv();
  if (!env) return null;
  const binding = env[AGENT_BACKGROUND_QUEUE_BINDING];
  if (binding == null) return null;
  if (
    typeof binding !== "object" ||
    typeof (binding as QueueProducerLike).send !== "function"
  ) {
    console.error(
      `[agent-chat] the ${AGENT_BACKGROUND_QUEUE_BINDING} binding exists but is not a queue ` +
        "producer (no send()) — the durable background transport is unavailable on this Worker.",
    );
    return null;
  }
  return binding as QueueProducerLike;
}

/** True when this Worker can actually hand a run to the queue consumer. */
export function hasBoundBackgroundQueue(): boolean {
  if (!isCloudflareRuntime()) return false;
  return resolveBackgroundQueueProducer() !== null;
}

/**
 * Build the envelope for one run. Exported so the size refusal and the token
 * handling are testable without a queue binding.
 *
 * `origin` is supplied by the caller rather than resolved here: the consumer
 * has no inbound request to copy one from, and `resolveSelfDispatchBaseUrl` is
 * already the single resolver for "which URL is this deployment". A second
 * env-reading copy of that decision would split the two transports in two.
 */
export function buildBackgroundQueueMessage(input: {
  taskId: string;
  origin: string;
  body?: Record<string, unknown>;
}): BackgroundQueueMessage {
  let authorization: string | null = null;
  try {
    authorization = `Bearer ${signInternalToken(input.taskId)}`;
  } catch (err) {
    // Mirrors `fireInternalDispatch`: a missing A2A_SECRET is the documented
    // unsigned-dev path, anything else is a real signing failure and must not
    // pass as one.
    if (err instanceof Error && !/A2A_SECRET/i.test(err.message)) {
      console.error(
        `[agent-chat] signInternalToken failed unexpectedly for ${input.taskId}:`,
        err,
      );
    }
  }
  return {
    kind: BACKGROUND_QUEUE_MESSAGE_KIND,
    taskId: input.taskId,
    authorization,
    origin: input.origin,
    body: { taskId: input.taskId, ...(input.body ?? {}) },
  };
}

export function backgroundQueueMessageByteLength(
  message: BackgroundQueueMessage,
): number {
  return new TextEncoder().encode(JSON.stringify(message)).length;
}

/**
 * Put one run on the durable background queue. Resolves only once Cloudflare
 * confirms the message is written to disk, which is the queue's equivalent of
 * the awaited 202 the Netlify handoff waits for.
 *
 * Throws on every failure — no binding, an oversized payload, or a rejected
 * send. The caller catches and degrades to an inline run, exactly as it does
 * for a failed HTTP handoff today.
 */
export async function sendBackgroundQueueMessage(input: {
  taskId: string;
  /** Origin the consumer builds the synthesised request URL against. */
  origin: string;
  body?: Record<string, unknown>;
}): Promise<void> {
  const producer = resolveBackgroundQueueProducer();
  if (!producer) {
    throw new Error(
      `[agent-chat] durable background dispatch resolved to the queue transport but no ` +
        `${AGENT_BACKGROUND_QUEUE_BINDING} binding is available on this Worker.`,
    );
  }
  const message = buildBackgroundQueueMessage(input);
  const byteLength = backgroundQueueMessageByteLength(message);
  if (byteLength > BACKGROUND_QUEUE_MESSAGE_MAX_BYTES) {
    throw new OversizedBackgroundQueueMessageError(
      byteLength,
      BACKGROUND_QUEUE_MESSAGE_MAX_BYTES,
    );
  }
  await producer.send(message);
}
