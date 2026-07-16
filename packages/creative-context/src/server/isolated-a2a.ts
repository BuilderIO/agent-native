import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import type {
  CreativeContextElementProvenance,
  CreativeContextGenerationRecord,
  CreativeContextReuseLabel,
} from "../types.js";
import type {
  CreativeGenerationRole,
  ResolveGenerationCreativeContextInput,
} from "./generation-context.js";

const PROTOCOL = "creative-context-a2a-v1";
const RESPONSE_PREFIX = "CREATIVE_CONTEXT_A2A_RESPONSE_V1";
const MAX_TOKEN_LENGTH = 512_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const boundedId = z.string().min(1).max(256);
const reuseInfluence = z.enum([
  "reused",
  "adapted",
  "reference-conditioned",
  "generated",
]);
const reuseLabelSchema = z
  .object({
    itemId: boundedId.optional(),
    itemVersionId: boundedId.optional(),
    kind: z.string().min(1).max(100),
    label: z.string().min(1).max(2_000),
    dataRole: z.literal("untrusted-reference"),
    elementId: boundedId.optional(),
    influence: reuseInfluence.optional(),
  })
  .strict();
const elementProvenanceSchema = z
  .object({
    elementId: boundedId,
    influence: reuseInfluence,
    itemId: boundedId.optional(),
    itemVersionId: boundedId.optional(),
    label: z.string().max(2_000).optional(),
  })
  .strict();
const generationIdentitySchema = z
  .object({
    appId: z.string().min(1).max(100),
    artifactType: z.string().min(1).max(100),
    artifactId: boundedId,
  })
  .strict();
const generationRecordInputSchema = generationIdentitySchema
  .extend({
    contextMode: z.enum(["off", "auto", "pinned"]),
    contextPackId: boundedId.nullable(),
    reuseLabels: z.array(reuseLabelSchema).max(100),
    elementProvenance: z.array(elementProvenanceSchema).max(500).optional(),
  })
  .strict();
const artifactAccessCapabilitySchema = z.string().min(1).max(8_192);
const generationRecordPayloadSchema = generationRecordInputSchema
  .extend({
    artifactAccessCapability: artifactAccessCapabilitySchema.optional(),
  })
  .strict();
const generationRecordSchema = generationIdentitySchema
  .extend({
    id: boundedId,
    contextMode: z.enum(["off", "auto", "pinned"]),
    contextPackId: boundedId.nullable(),
    elementProvenance: z.array(elementProvenanceSchema).max(500),
    createdAt: z.iso.datetime(),
  })
  .strict();
const remoteContextResultSchema = z
  .object({
    itemId: boundedId,
    itemVersionId: boundedId,
    kind: z.string().min(1).max(100),
    title: z.string().max(20_000),
    excerpt: z.string().max(20_000),
    dataRole: z.literal("untrusted-reference"),
  })
  .strict();
const resolvedContextSchema = z
  .object({
    contextMode: z.enum(["off", "auto", "pinned"]),
    contextPackId: boundedId.nullable(),
    reuseLabels: z.array(reuseLabelSchema).max(100),
    results: z.array(remoteContextResultSchema).max(20),
  })
  .strict();

const resolvePayloadSchema = z
  .object({
    query: z.string().max(1_000).optional(),
    role: z.enum(["slides", "design", "assets", "content"]),
    limit: z.number().int().min(1).max(20).optional(),
    contextPackId: boundedId.optional(),
    contextPackSource: z.enum(["explicit", "inherited"]).optional(),
  })
  .strict();
const validatePayloadSchema = z
  .object({
    contextPackId: boundedId.nullable().optional(),
    contextPackSource: z.enum(["explicit", "inherited"]).optional(),
    reuseLabels: z.array(reuseLabelSchema).max(100).optional(),
    reuseLabelsSource: z.enum(["explicit", "inherited"]).optional(),
  })
  .strict();
const readPayloadSchema = z
  .object({
    identity: generationIdentitySchema,
    artifactAccessCapability: artifactAccessCapabilitySchema.optional(),
  })
  .strict();

export const creativeContextA2ARequestSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        protocol: z.literal(PROTOCOL),
        requestId: z.uuid(),
        operation: z.literal("resolve"),
        payload: resolvePayloadSchema,
      })
      .strict(),
    z
      .object({
        protocol: z.literal(PROTOCOL),
        requestId: z.uuid(),
        operation: z.literal("validate"),
        payload: validatePayloadSchema,
      })
      .strict(),
    z
      .object({
        protocol: z.literal(PROTOCOL),
        requestId: z.uuid(),
        operation: z.literal("read"),
        payload: readPayloadSchema,
      })
      .strict(),
    z
      .object({
        protocol: z.literal(PROTOCOL),
        requestId: z.uuid(),
        operation: z.literal("record"),
        payload: generationRecordPayloadSchema,
      })
      .strict(),
  ],
);

export type CreativeContextA2ARequest = z.infer<
  typeof creativeContextA2ARequestSchema
>;
export type CreativeContextA2AOperation =
  CreativeContextA2ARequest["operation"];

type RemoteResultByOperation = {
  resolve: z.infer<typeof resolvedContextSchema>;
  validate: z.infer<typeof resolvedContextSchema>;
  read: CreativeContextGenerationRecord | null;
  record: CreativeContextGenerationRecord;
};

const responseEnvelopeSchema = z
  .object({
    protocol: z.literal(PROTOCOL),
    requestId: z.uuid(),
    operation: z.enum(["resolve", "validate", "read", "record"]),
    ok: z.literal(true),
    result: z.unknown(),
  })
  .strict();

export function hasIsolatedCreativeContextA2A(): boolean {
  return Boolean(process.env.CREATIVE_CONTEXT_A2A_URL?.trim());
}

export function decodeCreativeContextA2ARequest(
  requestToken: string,
): CreativeContextA2ARequest {
  if (!requestToken || requestToken.length > MAX_TOKEN_LENGTH) {
    throw new Error("Creative Context A2A request exceeds the protocol limit");
  }
  return creativeContextA2ARequestSchema.parse(
    JSON.parse(Buffer.from(requestToken, "base64url").toString("utf8")),
  );
}

export function createCreativeContextA2AResponseToken(
  request: CreativeContextA2ARequest,
  result: unknown,
): string {
  const response = {
    protocol: PROTOCOL,
    requestId: request.requestId,
    operation: request.operation,
    ok: true as const,
    result: normalizeRemoteResult(request.operation, result),
  };
  const encoded = Buffer.from(JSON.stringify(response), "utf8").toString(
    "base64url",
  );
  if (encoded.length > MAX_TOKEN_LENGTH) {
    throw new Error("Creative Context A2A response exceeds the protocol limit");
  }
  return `${RESPONSE_PREFIX}:${request.requestId}:${encoded}`;
}

export async function callIsolatedCreativeContextA2A<
  TOperation extends CreativeContextA2AOperation,
>(
  operation: TOperation,
  payload: Extract<
    CreativeContextA2ARequest,
    { operation: TOperation }
  >["payload"],
  options: {
    callAgent?: typeof import("@agent-native/core/a2a").callAgent;
  } = {},
): Promise<RemoteResultByOperation[TOperation]> {
  const url = parseConfiguredUrl();
  const userEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (!userEmail) {
    throw new Error(
      "Isolated Creative Context requires an authenticated caller identity",
    );
  }
  const orgSecret = process.env.CREATIVE_CONTEXT_A2A_KEY?.trim();
  if (!orgSecret && !process.env.A2A_SECRET?.trim()) {
    throw new Error(
      "CREATIVE_CONTEXT_A2A_URL requires CREATIVE_CONTEXT_A2A_KEY or A2A_SECRET",
    );
  }
  const request = creativeContextA2ARequestSchema.parse({
    protocol: PROTOCOL,
    requestId: crypto.randomUUID(),
    operation,
    payload,
  }) as Extract<CreativeContextA2ARequest, { operation: TOperation }>;
  const requestToken = Buffer.from(JSON.stringify(request), "utf8").toString(
    "base64url",
  );
  const prompt = [
    "Creative Context machine protocol request.",
    "Call the creative-context-a2a action exactly once with this JSON input:",
    JSON.stringify({ requestToken }),
    "Return only the responseToken string from that action. Do not summarize or modify it.",
  ].join("\n");
  const callAgent =
    options.callAgent ?? (await import("@agent-native/core/a2a")).callAgent;
  let responseText: string;
  try {
    responseText = await callAgent(url, prompt, {
      userEmail,
      orgDomain: emailDomain(userEmail),
      orgSecret,
      async: true,
      timeoutMs: configuredTimeoutMs(),
      returnRecoverableArtifactsOnTimeout: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Isolated Creative Context A2A request failed: ${message}`);
  }
  if (responseText.length > MAX_TOKEN_LENGTH + 1_000) {
    throw new Error(
      "Isolated Creative Context A2A response exceeds the protocol limit",
    );
  }
  const tokenPattern = new RegExp(
    `${RESPONSE_PREFIX}:${request.requestId}:([A-Za-z0-9_-]+)`,
  );
  const encoded = tokenPattern.exec(responseText)?.[1];
  if (!encoded) {
    throw new Error(
      "Isolated Creative Context returned a malformed protocol response",
    );
  }
  let envelope: z.infer<typeof responseEnvelopeSchema>;
  try {
    envelope = responseEnvelopeSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error(
      "Isolated Creative Context returned a malformed protocol response",
    );
  }
  if (
    envelope.requestId !== request.requestId ||
    envelope.operation !== operation
  ) {
    throw new Error(
      "Isolated Creative Context response did not match the request",
    );
  }
  return normalizeRemoteResult(
    operation,
    envelope.result,
  ) as RemoteResultByOperation[TOperation];
}

function normalizeRemoteResult(
  operation: CreativeContextA2AOperation,
  result: unknown,
): RemoteResultByOperation[CreativeContextA2AOperation] {
  switch (operation) {
    case "resolve":
    case "validate": {
      const value = result as Record<string, unknown>;
      const rows = Array.isArray(value?.results) ? value.results : [];
      return resolvedContextSchema.parse({
        contextMode: value?.contextMode,
        contextPackId: value?.contextPackId,
        reuseLabels: value?.reuseLabels,
        results: rows.map((entry) => {
          const row = entry as Record<string, unknown>;
          return {
            itemId: row.itemId,
            itemVersionId: row.itemVersionId,
            kind: row.kind,
            title: row.title,
            excerpt: row.excerpt,
            dataRole: row.dataRole,
          };
        }),
      });
    }
    case "read":
      return result === null
        ? null
        : generationRecordSchema.parse(canonicalGenerationRecord(result));
    case "record":
      return generationRecordSchema.parse(canonicalGenerationRecord(result));
  }
}

function canonicalGenerationRecord(result: unknown) {
  const value = result as Record<string, unknown>;
  return {
    id: value?.id,
    appId: value?.appId,
    artifactType: value?.artifactType,
    artifactId: value?.artifactId,
    contextMode: value?.contextMode,
    contextPackId: value?.contextPackId,
    elementProvenance: value?.elementProvenance,
    createdAt: value?.createdAt,
  };
}

function parseConfiguredUrl(): string {
  const value = process.env.CREATIVE_CONTEXT_A2A_URL?.trim();
  if (!value) throw new Error("CREATIVE_CONTEXT_A2A_URL is not configured");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CREATIVE_CONTEXT_A2A_URL must be a valid HTTP(S) URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("CREATIVE_CONTEXT_A2A_URL must be a valid HTTP(S) URL");
  }
  return url.toString().replace(/\/$/, "");
}

function configuredTimeoutMs(): number {
  const parsed = Number(process.env.CREATIVE_CONTEXT_A2A_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(60_000, Math.floor(parsed)));
}

function emailDomain(email: string): string | undefined {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain || undefined;
}

export type IsolatedResolvePayload = {
  query?: string;
  role: CreativeGenerationRole;
  limit?: number;
  contextPackId?: string;
  contextPackSource?: "explicit" | "inherited";
};

export function isolatedResolvePayload(
  input: ResolveGenerationCreativeContextInput,
): IsolatedResolvePayload {
  return {
    query: input.query,
    role: input.role,
    limit: input.limit,
    contextPackId: input.contextPackId,
    contextPackSource: input.contextPackSource,
  };
}

export type IsolatedRecordPayload = {
  appId: string;
  artifactType: string;
  artifactId: string;
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  reuseLabels: CreativeContextReuseLabel[];
  elementProvenance?: CreativeContextElementProvenance[];
  artifactAccessCapability?: string;
};
