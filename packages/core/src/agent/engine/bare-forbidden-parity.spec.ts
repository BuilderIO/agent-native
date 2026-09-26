import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  normalizeChatError,
  PROVIDER_CREDENTIAL_REJECTED_MESSAGE,
} from "../../client/error-format.js";
import {
  continuationReasonForResumableError,
  isRetryableError,
  isTransientProviderRateLimitError,
} from "../production-agent.js";
import { isLlmCredentialError } from "./credential-errors.js";
import {
  classifyProviderError,
  isBareProviderRejectionMessage,
  PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
} from "./error-detail.js";
import { EngineError, type EngineStreamOptions } from "./types.js";

/**
 * A 403 with an empty body is the provider shedding load, not a revoked key.
 * That verdict was fixed twice already — once in `classifyProviderError` for
 * the AI SDK lane and once in `builder-engine` for the gateway lane — and both
 * times the Anthropic engine was left tagging it `http_403`, which routes a
 * working credential onto the "reconnect your provider" lane and ends the turn
 * on its first occurrence instead of retrying.
 *
 * So this file asserts the property rather than the third fix: every engine
 * reaches the same verdict on a reasonless 403, and an engine that does not is
 * a test failure instead of a production report. The static check at the bottom
 * is what catches engine number four, which no behavioral test here can see.
 */

const BARE_403_MESSAGES = ["403 status code (no body)", "Forbidden", ""];

function anthropicApiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status, name: "APIError" });
}

async function streamAnthropicFailure(err: Error): Promise<any> {
  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      throw err;
    },
    finalMessage: vi.fn(),
  };
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class MockAnthropic {
      messages = { stream: vi.fn().mockReturnValue(mockStream) };
    },
  }));
  vi.resetModules();
  const { createAnthropicEngine } = await import("./anthropic-engine.js");
  const engine = createAnthropicEngine({ apiKey: "test" });
  const opts: EngineStreamOptions = {
    model: "claude-haiku-4-5-20251001",
    systemPrompt: "Test",
    messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    tools: [],
    abortSignal: new AbortController().signal,
  };
  const events: any[] = [];
  await expect(async () => {
    for await (const e of engine.stream(opts)) events.push(e);
  }).rejects.toThrow();
  return events.find((e) => e.type === "stop");
}

afterEach(() => {
  vi.doUnmock("@anthropic-ai/sdk");
  vi.resetModules();
});

describe("a reasonless provider 403 is transient on every engine", () => {
  it.each(BARE_403_MESSAGES)(
    "Anthropic engine treats %j as a transient rejection, not a credential failure",
    async (message) => {
      const stop = await streamAnthropicFailure(
        anthropicApiError(403, message),
      );

      expect(stop?.reason).toBe("error");
      expect(stop?.errorCode).toBe(PROVIDER_TRANSIENT_REJECTION_ERROR_CODE);
      expect(stop?.statusCode).toBe(403);
      expect(stop?.providerRetryable).toBe(true);
    },
  );

  it.each(BARE_403_MESSAGES)("AI SDK lane agrees on %j", (message) => {
    const classified = classifyProviderError(
      Object.assign(new Error(message), { statusCode: 403 }),
    );

    expect(classified.errorCode).toBe(PROVIDER_TRANSIENT_REJECTION_ERROR_CODE);
    expect(classified.statusCode).toBe(403);
    expect(classified.providerRetryable).toBe(true);
  });

  it("keeps the turn on the retry lane instead of ending it", async () => {
    const stop = await streamAnthropicFailure(
      anthropicApiError(403, "403 status code (no body)"),
    );
    const err = new EngineError(stop?.error ?? "Engine stream error", {
      errorCode: stop?.errorCode,
      statusCode: stop?.statusCode,
      providerRetryable: stop?.providerRetryable,
    });

    expect(isRetryableError(err)).toBe(true);
    expect(isTransientProviderRateLimitError(err)).toBe(true);
    expect(continuationReasonForResumableError(err)).toBe("rate_limited");
    expect(isLlmCredentialError(err, stop?.errorCode)).toBe(false);
  });

  it("surfaces an actionable sentence rather than a bare HTTP status echo", async () => {
    const stop = await streamAnthropicFailure(
      anthropicApiError(403, "403 status code (no body)"),
    );
    const normalized = normalizeChatError(stop?.error, stop?.errorCode);

    expect(normalized.message).toMatch(/temporarily refused this request/i);
    expect(normalized.message).not.toMatch(/no body/i);
    expect(normalized.message).not.toMatch(/403/);
    expect(normalized.message).not.toBe(PROVIDER_CREDENTIAL_REJECTED_MESSAGE);
    expect(normalized.details).toBe("403 status code (no body)");
  });
});

describe("a 403 that carries a reason stays a credential failure", () => {
  const REASONED = "permission_error: your account lacks access to this model";

  it("keeps http_403 on the Anthropic engine", async () => {
    const stop = await streamAnthropicFailure(anthropicApiError(403, REASONED));

    expect(stop?.errorCode).toBe("http_403");
    expect(stop?.providerRetryable).toBeUndefined();
  });

  it("keeps http_403 on the AI SDK lane", () => {
    const classified = classifyProviderError(
      Object.assign(new Error(REASONED), { statusCode: 403 }),
    );

    expect(classified.errorCode).toBe("http_403");
  });

  it("honors an SDK that calls the 403 explicitly final", () => {
    const classified = classifyProviderError(
      Object.assign(new Error("403 status code (no body)"), {
        statusCode: 403,
        isRetryable: false,
      }),
    );

    expect(classified.errorCode).toBe("http_403");
  });

  it("leaves other statuses on their own lane", async () => {
    const stop = await streamAnthropicFailure(
      anthropicApiError(429, "429 status code (no body)"),
    );

    expect(stop?.errorCode).toBe("http_429");
    expect(stop?.statusCode).toBe(429);
  });
});

describe("every engine that tags http_<status> answers the bare 403", () => {
  it("has no engine mapping a raw status without the shared predicate", () => {
    const engineDir = import.meta.dirname;
    const offenders = readdirSync(engineDir)
      .filter((file) => file.endsWith("-engine.ts"))
      .filter((file) => {
        const source = readFileSync(join(engineDir, file), "utf8");
        return (
          source.includes("`http_${") &&
          !source.includes("isBareProviderRejectionMessage")
        );
      });

    expect(offenders).toEqual([]);
  });

  it("agrees with the predicate the engines share", () => {
    for (const message of BARE_403_MESSAGES) {
      expect(isBareProviderRejectionMessage(message)).toBe(true);
    }
    expect(isBareProviderRejectionMessage("permission_error: no access")).toBe(
      false,
    );
  });
});
