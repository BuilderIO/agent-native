/**
 * Provider-neutral workflow automation connectors.
 *
 * This is intentionally separate from provider-api: an automation connector
 * invokes a configured workflow or accepts a configured workflow callback. It
 * is not an arbitrary provider HTTP escape hatch and it is not a chat channel.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { getHeader, getRouterParam, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import { z } from "zod";

import { defineAction } from "../action.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { resolveKeyReferencesWithRequestScopes } from "../secrets/substitution.js";
import { getRequestUserEmail } from "../server/request-context.js";

const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 2;

export type AutomationResponseMode = "synchronous" | "asynchronous";
export type AutomationInvocationStatus = "completed" | "accepted";
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface AutomationRetryPolicy {
  /** Total request attempts, including the first. Bounded to three. */
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

export interface AutomationWorkflowCapabilities {
  readonly invokesExternalWorkflow: boolean;
  readonly receivesCallback: boolean;
  readonly supportsIdempotency: boolean;
  readonly supportsSynchronousResponse: boolean;
  readonly supportsAsynchronousResponse: boolean;
  readonly mayCauseExternalSideEffects: boolean;
}

export interface AutomationOutboundDefinition {
  /** An explicit, static HTTPS origin such as https://automations.example.com. */
  readonly baseUrl: string;
  /** Additional explicit origins allowed for this workflow, if any. */
  readonly allowedOrigins?: readonly string[];
  /** A static path below baseUrl. It is never supplied by an agent. */
  readonly path: string;
  readonly method?: "POST" | "PUT" | "PATCH";
  /**
   * Static headers may use `${keys.NAME}` references. They are resolved only
   * after an action call reaches the server and are redacted from all results.
   */
  readonly headers?: Readonly<Record<string, string>>;
  readonly credentialRequirements?: readonly string[];
  readonly timeoutMs?: number;
  readonly retry?: AutomationRetryPolicy;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly idempotencyHeader?: string;
}

export type AutomationCallbackAuthentication =
  | {
      readonly kind: "shared-secret";
      readonly secretRef: string;
      readonly header: string;
      readonly prefix?: string;
    }
  | {
      readonly kind: "hmac-sha256";
      readonly secretRef: string;
      readonly header: string;
      readonly prefix?: string;
    }
  | {
      readonly kind: "provider-auth";
      /**
       * Provider verification stays in the app adapter; the shared runtime
       * never pretends every provider uses the same signature protocol.
       */
      readonly verify: (input: {
        readonly rawBody: string;
        readonly headers: Headers;
      }) => Promise<boolean>;
    };

export interface AutomationInboundDefinition {
  readonly authentication: AutomationCallbackAuthentication;
  readonly eventIdHeader?: string;
  readonly maxRequestBytes?: number;
  /**
   * Receiving a callback that starts agent work requires both durable callbacks
   * below. The runtime rejects configurations that omit either one.
   */
  readonly triggersAgentExecution?: boolean;
}

export interface AutomationWorkflowDefinition {
  /** Stable app-owned ID; callers use this rather than a URL. */
  readonly id: string;
  readonly connectorId: string;
  readonly name: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly response: { readonly mode: AutomationResponseMode };
  readonly capabilities: AutomationWorkflowCapabilities;
  readonly outbound?: AutomationOutboundDefinition;
  readonly inbound?: AutomationInboundDefinition;
}

export interface AutomationInvocation {
  readonly workflowId: string;
  readonly input: Record<string, unknown>;
  readonly idempotencyKey?: string;
  readonly userEmail: string;
}

export interface AutomationInvocationResult {
  readonly workflowId: string;
  readonly connectorId: string;
  readonly status: AutomationInvocationStatus;
  readonly responseMode: AutomationResponseMode;
  readonly attempts: number;
  readonly httpStatus: number;
  readonly output?: unknown;
  readonly responseTruncated: boolean;
}

export interface AutomationCallbackInput {
  readonly workflowId: string;
  readonly rawBody: string;
  readonly headers: Headers;
}

export interface AutomationCallbackResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly eventId: string;
}

export class AutomationConnectorError extends Error {
  constructor(
    readonly code:
      | "unknown_workflow"
      | "unsupported_direction"
      | "invalid_configuration"
      | "blocked_target"
      | "payload_too_large"
      | "authentication_failed"
      | "missing_idempotency"
      | "timeout"
      | "request_failed",
    message: string,
  ) {
    super(message);
    this.name = "AutomationConnectorError";
  }
}

export interface AutomationRuntimeOptions {
  readonly workflows: readonly AutomationWorkflowDefinition[];
  /**
   * Test-only transport injection. Production calls always use the framework
   * SSRF-safe fetch path.
   */
  readonly fetch?: typeof fetch;
  /**
   * The caller receives the raw secret only inside this server-side callback.
   * Return a value for a configured secret reference; never log or return it.
   */
  readonly resolveSecret?: (
    secretRef: string,
    context: { readonly userEmail?: string },
  ) => Promise<string | null>;
  /**
   * Durable, SQL-backed idempotency claim. Return false for an already-seen
   * event. It is required when callbacks trigger agent execution.
   */
  readonly claimInboundEvent?: (input: {
    readonly workflow: AutomationWorkflowDefinition;
    readonly eventId: string;
  }) => Promise<boolean>;
  /**
   * Release a claim acquired by claimInboundEvent when durable enqueueing
   * throws. It is required when callbacks trigger agent execution so a
   * provider retry can claim the event again.
   */
  readonly releaseInboundEvent?: (input: {
    readonly workflow: AutomationWorkflowDefinition;
    readonly eventId: string;
  }) => Promise<void>;
  /**
   * Persist and dispatch agent work using the app's established durable queue.
   * This must be idempotent for the workflow/event ID pair because a transport
   * failure can make enqueue success ambiguous. Do not run an agent loop in a
   * callback request.
   */
  readonly enqueueInboundEvent?: (input: {
    readonly workflow: AutomationWorkflowDefinition;
    readonly eventId: string;
    readonly payload: unknown;
  }) => Promise<void>;
}

export interface AutomationRuntime {
  readonly listWorkflows: () => readonly AutomationWorkflowDefinition[];
  readonly getWorkflow: (
    workflowId: string,
  ) => AutomationWorkflowDefinition | undefined;
  readonly invoke: (
    input: AutomationInvocation,
  ) => Promise<AutomationInvocationResult>;
  readonly receiveCallback: (
    input: AutomationCallbackInput,
  ) => Promise<AutomationCallbackResult>;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function bytesToString(
  chunks: readonly Uint8Array[],
  byteCount: number,
): string {
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function clampBytes(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value!), 1024 * 1024));
}

function normalizeAttempts(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.min(Math.floor(value!), 3));
}

function redact(value: string, secretValues: readonly string[]): string {
  return secretValues.reduce(
    (result, secret) =>
      secret ? result.split(secret).join("[REDACTED]") : result,
    value,
  );
}

function redactUnknown(
  value: unknown,
  secretValues: readonly string[],
): unknown {
  if (typeof value === "string") return redact(value, secretValues);
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, secretValues));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactUnknown(item, secretValues),
      ]),
    );
  }
  return value;
}

function responseTarget(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function assertAllowedTarget(definition: AutomationOutboundDefinition): URL {
  let base: URL;
  let target: URL;
  try {
    base = new URL(definition.baseUrl);
    target = new URL(definition.path, base);
  } catch {
    throw new AutomationConnectorError(
      "invalid_configuration",
      "Workflow has an invalid configured base URL or path.",
    );
  }
  if (base.protocol !== "https:" || target.protocol !== "https:") {
    throw new AutomationConnectorError(
      "blocked_target",
      "Automation workflow targets must use HTTPS.",
    );
  }
  const allowedOrigins = new Set([
    base.origin,
    ...(definition.allowedOrigins ?? []),
  ]);
  if (!allowedOrigins.has(target.origin)) {
    throw new AutomationConnectorError(
      "blocked_target",
      "Workflow target is outside its configured allow-listed origin.",
    );
  }
  return target;
}

async function resolveStaticHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  userEmail: string,
  resolveSecret: AutomationRuntimeOptions["resolveSecret"],
): Promise<{ headers: Record<string, string>; secretValues: string[] }> {
  const output: Record<string, string> = {};
  const secretValues: string[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    let resolved = value;
    if (value.includes("${keys.")) {
      const result = await resolveKeyReferencesWithRequestScopes(
        value,
        userEmail,
      );
      resolved = result.resolved;
      secretValues.push(...result.secretValues);
    }
    output[name] = resolved;
  }

  // A small app adapter may use named secret refs rather than the app vault
  // syntax. Resolve those only from static header values, never from agent args.
  if (resolveSecret) {
    for (const [name, value] of Object.entries(output)) {
      const match = value.match(/^\$\{automationSecret\.([A-Za-z0-9_-]+)\}$/);
      if (!match) continue;
      const secret = await resolveSecret(match[1], { userEmail });
      if (!secret) {
        throw new AutomationConnectorError(
          "invalid_configuration",
          `A configured credential is unavailable for header "${name}".`,
        );
      }
      output[name] = secret;
      secretValues.push(secret);
    }
  }
  return { headers: output, secretValues };
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<{ value: unknown; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { value: "", truncated: false };

  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  let truncated = false;
  const declaredLength = Number(response.headers.get("content-length"));
  const declaredOversize =
    Number.isFinite(declaredLength) && declaredLength > maxBytes;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;

      const remaining = maxBytes - byteCount;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        byteCount += remaining;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }

      chunks.push(value);
      byteCount += value.byteLength;
      if (byteCount === maxBytes && declaredOversize) {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bounded = bytesToString(chunks, byteCount);
  try {
    return { value: JSON.parse(bounded), truncated };
  } catch {
    return { value: bounded, truncated };
  }
}

function payloadTooLarge(maxBytes: number): AutomationConnectorError {
  return new AutomationConnectorError(
    "payload_too_large",
    `Callback exceeds the ${maxBytes}-byte limit.`,
  );
}

async function readBoundedRequestBody(
  event: H3Event,
  maxBytes: number,
): Promise<string> {
  const contentLength = getHeader(event, "content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw payloadTooLarge(maxBytes);
    }
  }

  const body = event.req.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      if (byteCount + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => {});
        throw payloadTooLarge(maxBytes);
      }
      chunks.push(value);
      byteCount += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return bytesToString(chunks, byteCount);
}

function shouldRetry(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createAutomationRuntime(
  options: AutomationRuntimeOptions,
): AutomationRuntime {
  const workflows = new Map(
    options.workflows.map((workflow) => [workflow.id, workflow]),
  );

  async function invoke(
    invocation: AutomationInvocation,
  ): Promise<AutomationInvocationResult> {
    const workflow = workflows.get(invocation.workflowId);
    if (!workflow) {
      throw new AutomationConnectorError(
        "unknown_workflow",
        `Unknown automation workflow "${invocation.workflowId}".`,
      );
    }
    if (!workflow.outbound || !workflow.capabilities.invokesExternalWorkflow) {
      throw new AutomationConnectorError(
        "unsupported_direction",
        `Workflow "${workflow.id}" does not support outbound invocation.`,
      );
    }

    const target = assertAllowedTarget(workflow.outbound);
    const body = JSON.stringify(invocation.input);
    const maxRequestBytes = clampBytes(
      workflow.outbound.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
    );
    if (byteLength(body) > maxRequestBytes) {
      throw new AutomationConnectorError(
        "payload_too_large",
        `Automation input exceeds the ${maxRequestBytes}-byte limit.`,
      );
    }
    if (
      workflow.outbound.idempotencyHeader &&
      workflow.capabilities.supportsIdempotency &&
      !invocation.idempotencyKey
    ) {
      throw new AutomationConnectorError(
        "missing_idempotency",
        "This workflow requires an idempotency key.",
      );
    }

    const { headers, secretValues } = await resolveStaticHeaders(
      workflow.outbound.headers,
      invocation.userEmail,
      options.resolveSecret,
    );
    headers["content-type"] ??= "application/json";
    if (workflow.outbound.idempotencyHeader && invocation.idempotencyKey) {
      headers[workflow.outbound.idempotencyHeader] = invocation.idempotencyKey;
    }

    const attempts = normalizeAttempts(workflow.outbound.retry?.maxAttempts);
    const timeoutMs = Math.max(
      1,
      Math.min(workflow.outbound.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000),
    );
    const maxResponseBytes = clampBytes(
      workflow.outbound.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
    );
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const request: RequestInit = {
          method: workflow.outbound.method ?? "POST",
          headers,
          body,
          signal: abort.signal,
        };
        const response = options.fetch
          ? await options.fetch(target.href, { ...request, redirect: "manual" })
          : await ssrfSafeFetch(target.href, request, {
              httpsOnly: true,
              maxRedirects: 0,
            });
        const parsed = await readBoundedResponse(response, maxResponseBytes);
        if (
          !response.ok &&
          shouldRetry(response.status) &&
          attempt < attempts
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, workflow.outbound!.retry?.retryDelayMs ?? 250),
          );
          continue;
        }
        if (!response.ok) {
          throw new AutomationConnectorError(
            "request_failed",
            `Workflow request to ${responseTarget(target)} failed with HTTP ${response.status}.`,
          );
        }
        return {
          workflowId: workflow.id,
          connectorId: workflow.connectorId,
          status:
            workflow.response.mode === "asynchronous"
              ? "accepted"
              : "completed",
          responseMode: workflow.response.mode,
          attempts: attempt,
          httpStatus: response.status,
          output: redactUnknown(parsed.value, secretValues),
          responseTruncated: parsed.truncated,
        };
      } catch (error) {
        lastError = error;
        if (abort.signal.aborted) {
          lastError = new AutomationConnectorError(
            "timeout",
            `Workflow request to ${responseTarget(target)} timed out.`,
          );
        }
        const retryable =
          abort.signal.aborted ||
          !(lastError instanceof AutomationConnectorError);
        if (attempt < attempts && retryable) {
          await new Promise((resolve) =>
            setTimeout(resolve, workflow.outbound!.retry?.retryDelayMs ?? 250),
          );
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastError instanceof AutomationConnectorError) throw lastError;
    throw new AutomationConnectorError(
      "request_failed",
      `Workflow request to ${responseTarget(target)} failed after ${attempts} attempts.`,
    );
  }

  async function receiveCallback(
    input: AutomationCallbackInput,
  ): Promise<AutomationCallbackResult> {
    const workflow = workflows.get(input.workflowId);
    if (!workflow) {
      throw new AutomationConnectorError(
        "unknown_workflow",
        "Unknown automation callback.",
      );
    }
    if (!workflow.inbound || !workflow.capabilities.receivesCallback) {
      throw new AutomationConnectorError(
        "unsupported_direction",
        "This workflow does not accept callbacks.",
      );
    }
    const maxRequestBytes = clampBytes(
      workflow.inbound.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
    );
    if (byteLength(input.rawBody) > maxRequestBytes) {
      throw new AutomationConnectorError(
        "payload_too_large",
        `Callback exceeds the ${maxRequestBytes}-byte limit.`,
      );
    }

    const auth = workflow.inbound.authentication;
    let authenticated = false;
    if (auth.kind === "provider-auth") {
      authenticated = await auth.verify({
        rawBody: input.rawBody,
        headers: input.headers,
      });
    } else {
      const secret = await options.resolveSecret?.(auth.secretRef, {});
      if (!secret) {
        throw new AutomationConnectorError(
          "invalid_configuration",
          "The configured automation callback credential is unavailable.",
        );
      }
      const supplied = input.headers.get(auth.header) ?? "";
      const expected =
        auth.kind === "hmac-sha256"
          ? `${auth.prefix ?? "sha256="}${createHmac("sha256", secret).update(input.rawBody).digest("hex")}`
          : `${auth.prefix ?? ""}${secret}`;
      authenticated = secureEqual(supplied, expected);
    }
    if (!authenticated) {
      throw new AutomationConnectorError(
        "authentication_failed",
        "Automation callback authentication failed.",
      );
    }

    const suppliedEventId = input.headers
      .get(workflow.inbound.eventIdHeader ?? "x-event-id")
      ?.trim();
    let eventId: string;
    if (workflow.inbound.triggersAgentExecution) {
      if (
        !options.claimInboundEvent ||
        !options.releaseInboundEvent ||
        !options.enqueueInboundEvent
      ) {
        throw new AutomationConnectorError(
          "invalid_configuration",
          "Agent-triggering callbacks require durable claim, release, and queue handlers.",
        );
      }
      if (!suppliedEventId) {
        throw new AutomationConnectorError(
          "missing_idempotency",
          "Agent-triggering callbacks require a stable provider event ID.",
        );
      }
      eventId = suppliedEventId;
      const claimed = await options.claimInboundEvent({ workflow, eventId });
      if (!claimed) return { accepted: true, duplicate: true, eventId };
      let payload: unknown = input.rawBody;
      try {
        payload = JSON.parse(input.rawBody);
      } catch {
        // A plain-text callback is permitted; the payload bound above still applies.
      }
      try {
        await options.enqueueInboundEvent({ workflow, eventId, payload });
      } catch (error) {
        await options.releaseInboundEvent({ workflow, eventId });
        throw error;
      }
    } else {
      eventId =
        suppliedEventId ??
        createHmac("sha256", workflow.id).update(input.rawBody).digest("hex");
    }
    return { accepted: true, duplicate: false, eventId };
  }

  return {
    listWorkflows: () => [...workflows.values()],
    getWorkflow: (workflowId) => workflows.get(workflowId),
    invoke,
    receiveCallback,
  };
}

const invokeAutomationWorkflowSchema = z.object({
  workflowId: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8).max(256).optional(),
});

/**
 * Creates the narrow action applications expose to their agent and UI. The
 * workflow identity resolves to static server configuration; callers cannot
 * supply arbitrary target URLs or credentials.
 */
export function createInvokeAutomationWorkflowAction(
  runtime: AutomationRuntime,
  options: {
    readonly description?: string;
    readonly requireApproval?: boolean;
  } = {},
) {
  return defineAction({
    description:
      options.description ??
      "Invoke a configured external automation workflow by its stable workflow ID. This cannot call arbitrary URLs and never exposes credentials.",
    schema: invokeAutomationWorkflowSchema,
    http: false,
    needsApproval: (args) =>
      options.requireApproval ??
      runtime.getWorkflow(args.workflowId)?.capabilities
        .mayCauseExternalSideEffects !== false,
    run: async (args) => {
      const userEmail = getRequestUserEmail();
      if (!userEmail)
        throw new Error("You must be signed in to invoke a workflow.");
      return runtime.invoke({ ...args, userEmail });
    },
  });
}

/**
 * Builds a route-only H3 callback handler. Mount it at
 * `/_agent-native/automations/callback/:workflowId`; ordinary app operations
 * still use actions. The callback only authenticates, deduplicates, and
 * durably enqueues work before returning a quick acknowledgement.
 */
export function createAutomationCallbackHandler(runtime: AutomationRuntime) {
  return async (event: H3Event) => {
    const workflowId = getRouterParam(event, "workflowId");
    if (!workflowId) {
      setResponseStatus(event, 404);
      return { error: "Unknown automation workflow." };
    }
    try {
      const workflow = runtime.getWorkflow(workflowId);
      if (!workflow?.inbound || !workflow.capabilities.receivesCallback) {
        throw new AutomationConnectorError(
          workflow ? "unsupported_direction" : "unknown_workflow",
          "Unknown automation callback.",
        );
      }
      const maxRequestBytes = clampBytes(
        workflow.inbound.maxRequestBytes,
        DEFAULT_MAX_REQUEST_BYTES,
      );
      const rawBody = await readBoundedRequestBody(event, maxRequestBytes);
      const result = await runtime.receiveCallback({
        workflowId,
        rawBody,
        headers: new Headers(event.headers),
      });
      setResponseStatus(event, result.duplicate ? 200 : 202);
      return {
        accepted: true,
        duplicate: result.duplicate,
        eventId: result.eventId,
      };
    } catch (error) {
      let status = 500;
      if (error instanceof AutomationConnectorError) {
        switch (error.code) {
          case "unknown_workflow":
          case "unsupported_direction":
            status = 404;
            break;
          case "authentication_failed":
            status = 401;
            break;
          case "missing_idempotency":
            status = 400;
            break;
          case "payload_too_large":
            status = 413;
            break;
        }
      }
      setResponseStatus(event, status);
      return { error: "Automation callback rejected." };
    }
  };
}
