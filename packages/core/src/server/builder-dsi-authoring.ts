import { z } from "zod";

import { fail, isActionContractError } from "../action.js";
import {
  builderDsiArtifactBodySchema,
  builderDsiMessageSchema,
  builderDsiPublicationSchema,
  builderDsiSessionSchema,
  builderDsiStartSchema,
  type BuilderDsiMessage,
  type BuilderDsiStart,
} from "../shared/builder-dsi-authoring.js";
import { resolveBuilderRequestAuthorization } from "./builder-api-auth.js";
import { getBuilderDesignSystemsBaseUrl } from "./builder-design-systems.js";
import { assertBuilderDsiAccess } from "./builder-dsi-access.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const identifier = z.string().trim().min(1).max(1024);

function invalidResponse(): never {
  return fail("Builder returned an invalid design-system authoring response.", {
    errorCode: "builder_dsi_response_invalid",
    statusCode: 502,
  });
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) return invalidResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) return invalidResponse();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(text);
  } catch {
    return invalidResponse();
  }
}

async function request<T>(
  operation: "start" | "session" | "message" | "artifact" | "publish",
  method: "GET" | "POST",
  input: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  await assertBuilderDsiAccess();
  const authorization = await resolveBuilderRequestAuthorization({
    requiredScope:
      method === "GET"
        ? "builder:designsystem:read"
        : "builder:designsystem:write",
  });
  if (authorization?.source !== "oauth")
    return fail("Reconnect your Builder account to author a design system.", {
      errorCode: "builder_dsi_oauth_required",
      statusCode: 409,
    });
  const base = getBuilderDesignSystemsBaseUrl().replace(/\/+$/, "");
  const url = new URL(`${base}/authoring/${operation}`);
  if (method === "GET") {
    for (const [key, value] of Object.entries(input))
      if (typeof value === "string") url.searchParams.set(key, value);
      else if (value !== undefined)
        throw new TypeError(`Invalid Builder query parameter: ${key}`);
  }
  let result: unknown;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: authorization.authorization,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
    });
    result = await readJson(response);
  } catch (cause) {
    if (isActionContractError(cause)) {
      if (method === "POST")
        return fail(cause.message, {
          errorCode: cause.errorCode,
          statusCode: cause.statusCode,
          details: { operation, outcome: "unknown", retryable: false },
        });
      throw cause;
    }
    return fail(
      method === "POST"
        ? "Builder's response was interrupted. Check this session before starting another request."
        : "The Builder design-system session could not be read.",
      {
        errorCode:
          method === "POST"
            ? "builder_dsi_outcome_unknown"
            : "builder_dsi_unavailable",
        statusCode: 502,
        details: {
          operation,
          outcome: method === "POST" ? "unknown" : "unavailable",
          retryable: false,
        },
      },
    );
  }
  if (!response.ok) {
    const problem = z
      .object({
        error: z.string().max(2000).optional(),
        message: z.string().max(2000).optional(),
        code: z
          .string()
          .regex(/^[a-z_]{1,80}$/)
          .optional(),
      })
      .safeParse(result);
    const providerCode = problem.success ? problem.data.code : undefined;
    return fail(
      (problem.success && (problem.data.message || problem.data.error)) ||
        "Builder could not perform this design-system operation.",
      {
        errorCode:
          response.status === 404
            ? "builder_dsi_not_found"
            : providerCode
              ? `builder_dsi_${providerCode}`
              : "builder_dsi_request_failed",
        statusCode: response.status,
        details: {
          operation,
          providerStatus: response.status,
          ...(providerCode ? { providerCode } : {}),
        },
      },
    );
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success)
    return fail(
      "Builder returned an invalid design-system authoring response.",
      {
        errorCode: "builder_dsi_response_invalid",
        statusCode: 502,
        details: {
          operation,
          outcome: method === "POST" ? "unknown" : "unavailable",
          retryable: false,
        },
      },
    );
  return parsed.data;
}

export function startBuilderDsiSession(input: BuilderDsiStart) {
  return request(
    "start",
    "POST",
    builderDsiStartSchema.parse(input),
    builderDsiSessionSchema,
  );
}

export async function getBuilderDsiSession(sessionId: string) {
  identifier.parse(sessionId);
  const result = await request(
    "session",
    "GET",
    { sessionId },
    builderDsiSessionSchema,
  );
  if (result.sessionId !== sessionId) return invalidResponse();
  return result;
}

export async function readBuilderDsiSessionByRequest(requestId: string) {
  z.string().trim().min(1).max(200).parse(requestId);
  return request("session", "GET", { requestId }, builderDsiSessionSchema);
}

export async function sendBuilderDsiMessage(input: BuilderDsiMessage) {
  const result = await request(
    "message",
    "POST",
    builderDsiMessageSchema.parse(input),
    builderDsiSessionSchema,
  );
  if (result.sessionId !== input.sessionId) return invalidResponse();
  return result;
}

export async function readBuilderDsiArtifact(input: {
  sessionId: string;
  artifactId: string;
  revision?: string;
}) {
  const args = z
    .object({
      sessionId: identifier,
      artifactId: identifier,
      revision: identifier.optional(),
    })
    .parse(input);
  const result = await request(
    "artifact",
    "GET",
    args,
    builderDsiArtifactBodySchema,
  );
  if (
    result.id !== input.artifactId ||
    (input.revision && result.hash !== input.revision)
  )
    return invalidResponse();
  return result;
}

export async function publishBuilderDsiSession(input: {
  sessionId: string;
  requestId: string;
  expectedRevision: string;
}) {
  const args = z
    .object({
      sessionId: identifier,
      requestId: identifier,
      expectedRevision: identifier,
    })
    .parse(input);
  const result = await request(
    "publish",
    "POST",
    args,
    builderDsiPublicationSchema,
  );
  if (
    result.sessionId !== input.sessionId ||
    result.revision !== input.expectedRevision
  )
    return invalidResponse();
  return result;
}
