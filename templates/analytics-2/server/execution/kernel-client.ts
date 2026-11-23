import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  defineAppConfigSection,
  readDeployCredentialEnv,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  CONTRACT_VERSION,
  kernelAcknowledgementSchema,
  kernelCommandSchema,
  kernelEventSchema,
  type KernelAcknowledgement,
  type KernelCommand,
  type KernelEvent,
} from "../../shared/kernel-contract.js";
import {
  kernelGenerationSchema,
  namespaceIdSchema,
  runIdSchema,
} from "../../shared/notebook-execution.js";
import type { AuthorizedResultRef } from "../../shared/notebook-result-contract.js";
import {
  decimalIntegerSchema,
  workspaceIdSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { environmentReportSchema } from "../model/environment-packages.js";
import {
  readKernelBinding,
  type KernelActor,
  type KernelBinding,
  type KernelHostPin,
  type NotebookKernelExecution,
} from "../model/kernel-namespaces.js";

export const analyticsKernelConfig = defineAppConfigSection(
  "analyticsKernel",
  z.object({
    hosts: z.string().optional().meta({
      env: "ANALYTICS_KERNEL_HOSTS",
      doc: "JSON array of trusted kernel command and stream origins with pinned service builds.",
    }),
    keyId: z.string().optional().meta({
      env: "ANALYTICS_KERNEL_KEY_ID",
      doc: "Active key ID in the kernel gateway signing keyring.",
    }),
    execution: z.custom<NotebookKernelExecution>().optional(),
  }),
);

declare module "@agent-native/core/server" {
  interface AppConfigSections {
    analyticsKernel: typeof analyticsKernelConfig.schema;
  }
}

const issuer = "analytics2";
const audience = "analytics-kernel";
const lifetimeSeconds = 60;
const requestTimeoutMs = 5_000;
const maxArtifactBytes = 32 * 1024 * 1024;
const maxInputsBytes = 64 * 1024 * 1024;
const arrowContentType = "application/vnd.apache.arrow.stream";
const hostPath = /^(?:\/|\/hosts\/[a-z][a-z0-9-]{0,62}\/?)$/;
const sha = z.union([
  z.literal("development"),
  z.string().regex(/^[a-f0-9]{40}$/),
]);
const digest = z.union([
  z.literal("development"),
  z.string().regex(/^sha256:[a-f0-9]{64}$/),
]);
const endpoint = z
  .strictObject({
    commandUrl: z.url(),
    eventUrl: z.url(),
    sha,
    digest,
  })
  .superRefine((host, ctx) => {
    for (const address of [host.commandUrl, host.eventUrl]) {
      const url = new URL(address);
      const development =
        host.sha === "development" && host.digest === "development";
      const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
        url.hostname,
      );
      if (
        url.username ||
        url.password ||
        !hostPath.test(url.pathname) ||
        url.search ||
        url.hash ||
        (development && !loopback) ||
        (url.protocol !== "https:" &&
          !(development && url.protocol === "http:"))
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Invalid kernel service origin",
        });
      }
    }
    if ((host.sha === "development") !== (host.digest === "development")) {
      ctx.addIssue({
        code: "custom",
        message: "Kernel service build must have both SHA and digest",
      });
    }
  });
const endpointsSchema = z.array(endpoint).min(1).max(6);
const healthSchema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_VERSION),
  hostId: z.string().min(1),
  sha,
  digest,
  cordoned: z.boolean(),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  resident: z.number().int().nonnegative(),
});
const keysSchema = z.record(
  z.string().regex(/^[A-Za-z0-9._-]+$/),
  z.string().refine((key) => Buffer.byteLength(key) >= 32),
);

const hostScopeSchema = z.strictObject({
  iss: z.literal(issuer),
  aud: z.literal(audience),
  hostId: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});
const scopeSchema = hostScopeSchema.extend({
  sub: z.string().min(1),
  workspaceId: workspaceIdSchema,
  namespaceId: namespaceIdSchema,
  generation: kernelGenerationSchema,
  runId: runIdSchema,
});
const eventTicketSchema = scopeSchema.extend({
  operation: z.literal("events"),
  jti: z.uuid(),
});
const ticketHeaderSchema = z.strictObject({
  alg: z.literal("HS256"),
  kid: z.string().min(1),
  typ: z.literal("JWT"),
});

export class KernelGatewayError extends Error {
  constructor(
    readonly code:
      | "not_configured"
      | "unreadable"
      | "host_unavailable"
      | "stale_generation"
      | "access_denied"
      | "cursor_expired"
      | "transfer_rejected",
  ) {
    super(code);
  }
}

function deploymentEndpoints() {
  const configured = analyticsKernelConfig.read().hosts;
  if (!configured) throw new KernelGatewayError("not_configured");
  return endpointsSchema.parse(JSON.parse(configured));
}

export function usesBrowserNotebookKernel() {
  const { hosts, execution } = analyticsKernelConfig.read();
  return !hosts && execution === undefined;
}

export function kernelBuildManifest() {
  const configured = analyticsKernelConfig.read().hosts;
  return {
    protocolVersion: CONTRACT_VERSION,
    builds: configured
      ? deploymentEndpoints().map(({ sha, digest }) => ({ sha, digest }))
      : [],
  } as const;
}

type Endpoint = z.infer<typeof endpoint>;
type HostHealth = z.infer<typeof healthSchema> & Endpoint;

function kernelRoute(address: string, path: string) {
  const url = new URL(address);
  url.pathname = url.pathname.replace(/\/$/, "") + path;
  return url.href;
}

async function requestKernel(
  address: string,
  init: RequestInit,
  timeoutMs = requestTimeoutMs,
) {
  try {
    return await fetch(address, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new KernelGatewayError("unreadable");
  }
}

async function probeHost(host: Endpoint): Promise<HostHealth> {
  const response = await requestKernel(
    kernelRoute(host.commandUrl, "/healthz"),
    {},
  );
  if (!response.ok) throw new KernelGatewayError("unreadable");
  const report = healthSchema.parse(await response.json());
  if (report.sha !== host.sha || report.digest !== host.digest) {
    throw new KernelGatewayError("unreadable");
  }
  return { ...host, ...report };
}

export async function attestDevelopmentKernelBuilds() {
  if (!analyticsKernelConfig.read().hosts) return false;
  const hosts = deploymentEndpoints();
  if (hosts.some(({ sha }) => sha !== "development")) return false;
  const reports = await Promise.allSettled(hosts.map(probeHost));
  return reports.every(({ status }) => status === "fulfilled");
}

async function resolveHost(pin?: KernelHostPin): Promise<HostHealth> {
  const candidates = deploymentEndpoints().filter(
    (host) =>
      !pin || (host.sha === pin.serviceSha && host.digest === pin.imageDigest),
  );
  const reports = await Promise.allSettled(candidates.map(probeHost));
  for (const report of reports) {
    if (report.status !== "fulfilled") continue;
    const host = report.value;
    if (pin ? host.hostId === pin.hostId : !host.cordoned) return host;
  }
  if (reports.some((report) => report.status === "rejected")) {
    throw new KernelGatewayError("unreadable");
  }
  throw new KernelGatewayError("host_unavailable");
}

export async function selectKernelHost(): Promise<KernelHostPin> {
  const { hostId, sha: serviceSha, digest: imageDigest } = await resolveHost();
  return { hostId, serviceSha, imageDigest };
}

export async function readHostedKernelEnvironment() {
  const host = await resolveHost();
  const { token } = signKernelToken({
    ...hostScope(host.hostId, Date.now()),
    operation: "environment",
  });
  const response = await requestKernel(
    kernelRoute(host.commandUrl, "/v1/environment"),
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new KernelGatewayError("unreadable");
  return environmentReportSchema.parse(await response.json());
}

function signingKeys() {
  const configured = readDeployCredentialEnv("ANALYTICS_KERNEL_KEYS");
  if (!configured) throw new KernelGatewayError("not_configured");
  return keysSchema.parse(JSON.parse(configured));
}

function encode(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function hostScope(hostId: string, now: number) {
  const iat = Math.floor(now / 1000);
  return hostScopeSchema.parse({
    iss: issuer,
    aud: audience,
    hostId,
    iat,
    exp: iat + lifetimeSeconds,
  });
}

function signKernelToken(claims: { exp: number } & Record<string, unknown>) {
  const kid = analyticsKernelConfig.read().keyId;
  const keys = signingKeys();
  const key = kid && Object.hasOwn(keys, kid) ? keys[kid] : undefined;
  if (!kid || !key) throw new KernelGatewayError("not_configured");
  const signingInput = `${encode({ alg: "HS256", kid, typ: "JWT" })}.${encode(claims)}`;
  const signature = createHmac("sha256", key)
    .update(signingInput)
    .digest("base64url");
  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

function signGrant(
  actor: KernelActor,
  hostId: string,
  envelope: Pick<KernelCommand, "namespaceId" | "generation" | "runId">,
  grant: object,
  now: number,
) {
  const claims = scopeSchema.parse({
    ...hostScope(hostId, now),
    sub: actor.principalId,
    workspaceId: actor.workspaceId,
    ...envelope,
  });
  return signKernelToken({ ...claims, ...grant });
}

export function verifyKernelStreamTicket(
  token: string,
  now = Date.now(),
): z.infer<typeof eventTicketSchema> {
  const [encodedHeader, encodedClaims, encodedSignature, extra] =
    token.split(".");
  if (
    !encodedHeader ||
    !encodedClaims ||
    !encodedSignature ||
    extra !== undefined ||
    token.length > 4096
  ) {
    throw new KernelGatewayError("access_denied");
  }
  const header = ticketHeaderSchema.parse(
    JSON.parse(Buffer.from(encodedHeader, "base64url").toString()),
  );
  const keys = signingKeys();
  const key = Object.hasOwn(keys, header.kid) ? keys[header.kid] : undefined;
  if (!key) throw new KernelGatewayError("access_denied");
  const expected = createHmac("sha256", key)
    .update(`${encodedHeader}.${encodedClaims}`)
    .digest();
  const signature = Buffer.from(encodedSignature, "base64url");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  ) {
    throw new KernelGatewayError("access_denied");
  }
  const claims = eventTicketSchema.parse(
    JSON.parse(Buffer.from(encodedClaims, "base64url").toString()),
  );
  const clock = Math.floor(now / 1000);
  if (
    claims.iat > clock ||
    claims.exp <= clock ||
    claims.exp - claims.iat !== lifetimeSeconds
  ) {
    throw new KernelGatewayError("access_denied");
  }
  return claims;
}

export async function openKernelEventTicket(
  actor: KernelActor,
  envelope: Pick<KernelCommand, "namespaceId" | "generation" | "runId">,
  cursor: string,
  now = Date.now(),
) {
  const binding = await readKernelBinding(
    actor,
    envelope.namespaceId,
    envelope.generation,
  );
  if (!binding) return { status: "absent", reason: "not_found" } as const;
  const host = await resolveHost(binding);
  const grant = signGrant(
    actor,
    host.hostId,
    envelope,
    {
      operation: "events",
      jti: randomUUID(),
    },
    now,
  );
  return {
    streamUrl: kernelRoute(host.eventUrl, "/v1/events"),
    ...grant,
    cursor: decimalIntegerSchema.parse(cursor),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a === b ? 0 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function kernelCommandIntent(command: KernelCommand): string {
  const { protocolVersion, commandId, generation, namespaceId, runId } =
    command;
  return createHash("sha256")
    .update(
      canonicalJson({
        protocolVersion,
        commandId,
        generation,
        namespaceId,
        runId,
        command: command.command,
      }),
    )
    .digest("hex");
}

type AuthorizeClaim = (
  actor: KernelActor,
  command: KernelCommand,
) => Promise<boolean>;
type ReadArrowInput = (result: AuthorizedResultRef) => Promise<Uint8Array>;

function inputs(command: KernelCommand) {
  const operation = command.command;
  return "inputs" in operation
    ? new Map(
        operation.inputs.map(({ manifest }) => [
          manifest.result.resultId,
          manifest.result,
        ]),
      )
    : new Map<string, AuthorizedResultRef>();
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function assertEcho(receipt: KernelAcknowledgement, command: KernelCommand) {
  if (
    receipt.namespaceId !== command.namespaceId ||
    receipt.generation !== command.generation ||
    receipt.commandId !== command.commandId ||
    receipt.runId !== command.runId ||
    receipt.attemptId !== command.attemptId
  )
    throw new KernelGatewayError("unreadable");
}

function workerHeaders(
  actor: KernelActor,
  hostId: string,
  command: KernelCommand,
  intentHash: string,
  inputIds: string[],
) {
  const { namespaceId, generation, runId, commandId, attemptId } = command;
  const { token } = signGrant(
    actor,
    hostId,
    { namespaceId, generation, runId },
    {
      operation: command.command.operation,
      commandId,
      attemptId,
      intentHash,
      inputIds,
    },
    Date.now(),
  );
  return authHeader(token);
}

async function postCommand(
  host: HostHealth,
  headers: Record<string, string>,
  command: KernelCommand,
) {
  const response = await requestKernel(
    kernelRoute(host.commandUrl, "/v1/commands"),
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    },
  );
  const receipt = kernelAcknowledgementSchema.parse(await response.json());
  assertEcho(receipt, command);
  return receipt;
}

export async function terminateKernelGeneration(
  actor: KernelActor,
  prior: KernelBinding,
  command: KernelCommand,
  authorizeControl: AuthorizeClaim,
): Promise<KernelAcknowledgement> {
  kernelCommandSchema.parse(command);
  if (
    (command.command.operation !== "close" &&
      command.command.operation !== "restart") ||
    prior.id !== command.namespaceId ||
    String(prior.generation) !== command.generation ||
    prior.orgId !== actor.workspaceId ||
    prior.principalId !== actor.principalId ||
    (await readKernelBinding(actor, command.namespaceId, command.generation))
  )
    throw new KernelGatewayError("access_denied");
  const host = await resolveHost(prior);
  if (!(await authorizeControl(actor, command)))
    throw new KernelGatewayError("access_denied");
  return postCommand(
    host,
    workerHeaders(
      actor,
      host.hostId,
      command,
      kernelCommandIntent(command),
      [],
    ),
    command,
  );
}

export function createKernelCommandSession(
  actor: KernelActor,
  command: KernelCommand,
  authorizeClaim: AuthorizeClaim,
  original: KernelCommand = command,
) {
  kernelCommandSchema.parse(command);
  kernelCommandSchema.parse(original);
  const inspect = command.command.operation === "inspect";
  if (
    inspect &&
    (original.namespaceId !== command.namespaceId ||
      original.generation !== command.generation ||
      original.commandId !== command.commandId ||
      original.runId !== command.runId ||
      !("inputs" in original.command))
  )
    throw new KernelGatewayError("access_denied");

  const approvedInputs = inputs(original);
  const intentHash = kernelCommandIntent(original);

  async function authorize() {
    if (!(await authorizeClaim(actor, command)))
      throw new KernelGatewayError("access_denied");
    const binding = await readKernelBinding(
      actor,
      command.namespaceId,
      command.generation,
    );
    if (!binding) throw new KernelGatewayError("stale_generation");
    return binding;
  }

  async function target() {
    const binding = await authorize();
    const host = await resolveHost(binding);
    await authorize();
    const inputIds = inspect ? [] : [...approvedInputs.keys()];
    return {
      host,
      headers: workerHeaders(actor, host.hostId, command, intentHash, inputIds),
    };
  }

  return {
    async submit(readArrow?: ReadArrowInput): Promise<KernelAcknowledgement> {
      if (!inspect && approvedInputs.size > 0) {
        if (!readArrow) throw new KernelGatewayError("transfer_rejected");
        let inputBytes = 0;
        for (const [id, result] of approvedInputs) {
          await authorize();
          const body = await readArrow(result);
          inputBytes += body.byteLength;
          if (body.byteLength > maxArtifactBytes || inputBytes > maxInputsBytes)
            throw new KernelGatewayError("transfer_rejected");
          const { host, headers } = await target();
          const response = await requestKernel(
            kernelRoute(
              host.commandUrl,
              `/v1/artifacts/${encodeURIComponent(id)}`,
            ),
            {
              method: "PUT",
              headers: { ...headers, "Content-Type": arrowContentType },
              body: Buffer.from(body),
            },
          );
          if (!response.ok) throw new KernelGatewayError("transfer_rejected");
        }
      }
      const { host, headers } = await target();
      return postCommand(host, headers, command);
    },
    async *events(
      after: string | null,
      signal?: AbortSignal,
    ): AsyncGenerator<KernelEvent> {
      const { host, headers } = await target();
      const response = await requestKernel(
        kernelRoute(host.commandUrl, "/v1/events"),
        {
          headers: {
            ...headers,
            ...(after !== null
              ? { "Last-Event-ID": decimalIntegerSchema.parse(after) }
              : {}),
          },
          signal: signal
            ? AbortSignal.any([
                signal,
                AbortSignal.timeout(lifetimeSeconds * 1000),
              ])
            : AbortSignal.timeout(lifetimeSeconds * 1000),
        },
      );
      if (response.status === 409) {
        const reason = z
          .object({ reason: z.enum(["cursor_expired", "stale_generation"]) })
          .parse(await response.json()).reason;
        throw new KernelGatewayError(reason);
      }
      if (!response.ok || !response.body)
        throw new KernelGatewayError("unreadable");
      let previous = BigInt(after ?? "0");
      for await (const event of readEvents(response.body)) {
        if (
          event.namespaceId !== original.namespaceId ||
          event.generation !== original.generation ||
          event.commandId !== original.commandId ||
          event.runId !== original.runId ||
          event.attemptId !== original.attemptId ||
          BigInt(event.sequence) <= previous
        ) {
          throw new KernelGatewayError("unreadable");
        }
        await authorize();
        previous = BigInt(event.sequence);
        yield event;
      }
    },
    async readArtifact(event: KernelEvent) {
      if (
        (event.event.type !== "result" && event.event.type !== "display") ||
        event.namespaceId !== original.namespaceId ||
        event.generation !== original.generation ||
        event.commandId !== original.commandId ||
        event.runId !== original.runId ||
        event.attemptId !== original.attemptId
      ) {
        throw new KernelGatewayError("access_denied");
      }
      const { host, headers } = await target();
      const response = await requestKernel(
        kernelRoute(
          host.commandUrl,
          `/v1/artifacts/${encodeURIComponent(event.event.artifactId)}`,
        ),
        { headers },
      );
      if (!response.ok || !response.body)
        throw new KernelGatewayError("transfer_rejected");
      const contentType = response.headers.get("Content-Type");
      if (
        contentType !== arrowContentType &&
        contentType !== "application/json"
      )
        throw new KernelGatewayError("transfer_rejected");
      const bytes = await readBoundedBytes(response.body);
      await authorize();
      return { contentType, bytes };
    },
  };
}

async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<KernelEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let boundary = buffered.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const payload = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (payload.length > 1024 * 1024)
          throw new KernelGatewayError("unreadable");
        if (payload) yield kernelEventSchema.parse(JSON.parse(payload));
        boundary = buffered.indexOf("\n\n");
      }
      if (buffered.length > 1024 * 1024 || (done && buffered.length))
        throw new KernelGatewayError("unreadable");
      if (done) break;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function readBoundedBytes(
  body: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxArtifactBytes)
        throw new KernelGatewayError("transfer_rejected");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
