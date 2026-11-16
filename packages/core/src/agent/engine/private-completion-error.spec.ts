import { describe, expect, it } from "vitest";

import {
  PRIVATE_COMPLETION_ERROR_CODE,
  PRIVATE_COMPLETION_ERROR_MESSAGE,
  PrivateCompletionError,
  toPrivateCompletionError,
} from "./private-completion-error.js";
import { ProviderAuthenticationError } from "./provider-auth-error.js";
import { EngineError } from "./types.js";

/** A synthetic selected body echoed by a hostile provider failure. */
const PRIVATE_CANARY = "canary-private-email-body-9c2f";

function errorSurface(error: unknown): string {
  const err = error as { message?: unknown; stack?: unknown; cause?: unknown };
  return [
    String(err?.message ?? ""),
    String(err?.stack ?? ""),
    String(err?.cause ?? ""),
    JSON.stringify(error),
  ].join("\n");
}

describe("PrivateCompletionError", () => {
  it("normalizes registered SDK engine names to a trusted provider", () => {
    expect(
      toPrivateCompletionError({ status: 401 }, "ai-sdk:openai").provider,
    ).toBe("openai");
    expect(
      toPrivateCompletionError({}, `ai-sdk:${PRIVATE_CANARY}`).provider,
    ).toBe("model");
  });
  it("discards arbitrary constructor copy and code", () => {
    const error = new PrivateCompletionError("anthropic", {
      status: 503,
      code: PRIVATE_CANARY,
      message: PRIVATE_CANARY,
    });
    expect(error.message).toBe(PRIVATE_COMPLETION_ERROR_MESSAGE);
    expect(error.code).toBe("http_503");
    expect(errorSurface(error)).not.toContain(PRIVATE_CANARY);
  });

  it("does not trust a forged private-error prototype", () => {
    const forged = Object.assign(
      Object.create(PrivateCompletionError.prototype),
      {
        message: PRIVATE_CANARY,
        code: PRIVATE_CANARY,
        statusCode: 500,
        stack: PRIVATE_CANARY,
      },
    );
    const error = toPrivateCompletionError(forged, "anthropic");
    expect(error).not.toBe(forged);
    expect(error.code).toBe("http_500");
    expect(errorSurface(error)).not.toContain(PRIVATE_CANARY);
  });

  it("keeps a constructed error immutable before reusing its identity", () => {
    const error = new PrivateCompletionError("anthropic", { status: 401 });
    expect(Object.isFrozen(error)).toBe(true);
    expect(() => Object.assign(error, { message: PRIVATE_CANARY })).toThrow();
    expect(toPrivateCompletionError(error)).toBe(error);
    expect(errorSurface(error)).not.toContain(PRIVATE_CANARY);
  });

  it("does not let a provider error accessor or proxy escape the boundary", () => {
    const raw = new ProviderAuthenticationError("anthropic", 401);
    Object.defineProperty(raw, "provider", {
      get() {
        throw new Error(PRIVATE_CANARY);
      },
    });
    const safe = toPrivateCompletionError(raw, "anthropic");
    expect(safe.code).toBe("http_401");
    expect(errorSurface(safe)).not.toContain(PRIVATE_CANARY);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(errorSurface(toPrivateCompletionError(revoked.proxy))).not.toContain(
      PRIVATE_CANARY,
    );
  });

  it("builds a fixed, app-owned error from an untrusted status error", () => {
    const raw = Object.assign(new Error(`echo ${PRIVATE_CANARY}`), {
      statusCode: 401,
      errorCode: `ec_${PRIVATE_CANARY}`,
      requestId: `req_${PRIVATE_CANARY}`,
      upgradeUrl: `https://example.invalid/${PRIVATE_CANARY}`,
      cause: new Error(`cause ${PRIVATE_CANARY}`),
      response: { body: PRIVATE_CANARY },
    });

    const err = toPrivateCompletionError(raw, "anthropic");

    expect(err).toBeInstanceOf(PrivateCompletionError);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.message).toBe(PRIVATE_COMPLETION_ERROR_MESSAGE);
    expect(err.provider).toBe("anthropic");
    expect(err.code).toBe("http_401");
    expect(err.statusCode).toBe(401);
    expect(err.status).toBe(401);
    expect((err as { cause?: unknown }).cause).toBeUndefined();
    expect((err as { requestId?: unknown }).requestId).toBeUndefined();
    expect((err as { upgradeUrl?: unknown }).upgradeUrl).toBeUndefined();
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
    expect(JSON.stringify(err.details())).not.toContain(PRIVATE_CANARY);
  });

  it("uses the fixed generic code for statuses outside 400..599 and non-integers", () => {
    for (const status of [200, 399, 600, 401.5, "401", null, undefined]) {
      const raw = Object.assign(new Error(PRIVATE_CANARY), {
        statusCode: status,
      });
      const err = toPrivateCompletionError(raw, "openai");
      expect(err.code).toBe(PRIVATE_COMPLETION_ERROR_CODE);
      expect(err.statusCode).toBeUndefined();
      expect(err.status).toBeUndefined();
      expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
    }
  });

  it("reads the alternative status field and ignores a hostile status getter", () => {
    const hostileStatus = new Error(`getter ${PRIVATE_CANARY}`);
    Object.defineProperty(hostileStatus, "statusCode", {
      get() {
        throw new Error(`hostile statusCode getter ${PRIVATE_CANARY}`);
      },
      enumerable: true,
    });
    Object.assign(hostileStatus, { status: 429 });

    const fromStatus = toPrivateCompletionError(hostileStatus, "google");
    expect(fromStatus.code).toBe("http_429");
    expect(fromStatus.statusCode).toBe(429);
    expect(errorSurface(fromStatus)).not.toContain(PRIVATE_CANARY);

    const bothHostile = new Error(PRIVATE_CANARY);
    Object.defineProperty(bothHostile, "statusCode", {
      get() {
        throw new Error(PRIVATE_CANARY);
      },
      enumerable: true,
    });
    Object.defineProperty(bothHostile, "status", {
      get() {
        throw new Error(PRIVATE_CANARY);
      },
      enumerable: true,
    });

    const fromNothing = toPrivateCompletionError(bothHostile, "google");
    expect(fromNothing.code).toBe(PRIVATE_COMPLETION_ERROR_CODE);
    expect(fromNothing.statusCode).toBeUndefined();
    expect(errorSurface(fromNothing)).not.toContain(PRIVATE_CANARY);
  });

  it("retypes the canonical provider 401 class preserving code, provider, and status", () => {
    const native = toPrivateCompletionError(
      new ProviderAuthenticationError("anthropic", 401),
      "model",
    );
    expect(native).toBeInstanceOf(PrivateCompletionError);
    expect(native.provider).toBe("anthropic");
    expect(native.code).toBe("http_401");
    expect(native.statusCode).toBe(401);

    const builder = toPrivateCompletionError(
      new ProviderAuthenticationError("builder", 401),
      "model",
    );
    expect(builder.provider).toBe("builder");
    expect(builder.code).toBe("builder_auth_error");
    expect(builder.statusCode).toBe(401);
  });

  it("falls back to the model provider for an untrusted provider name", () => {
    const raw = Object.assign(new Error(PRIVATE_CANARY), { statusCode: 500 });
    const err = toPrivateCompletionError(raw, `evil ${PRIVATE_CANARY}`);
    expect(err.provider).toBe("model");
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
  });

  it("returns the same instance when the error is already private", () => {
    const first = new PrivateCompletionError("anthropic", { status: 401 });
    expect(toPrivateCompletionError(first, "model")).toBe(first);
  });

  it("exposes stable typed metadata with no canary in details or stopEvent", () => {
    const err = new PrivateCompletionError("anthropic", { status: 401 });
    expect(err.details()).toEqual({
      message: PRIVATE_COMPLETION_ERROR_MESSAGE,
      provider: "anthropic",
      code: "http_401",
      status: 401,
    });
    expect(err.stopEvent()).toMatchObject({
      type: "stop",
      reason: "error",
      error: PRIVATE_COMPLETION_ERROR_MESSAGE,
      errorCode: "http_401",
      provider: "anthropic",
      statusCode: 401,
    });
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
  });

  it("sanitizes an unsupported provider and non-canonical status at construction", () => {
    const err = new PrivateCompletionError(`hostile ${PRIVATE_CANARY}`, {
      status: 1234,
    });
    expect(err.provider).toBe("model");
    expect(err.code).toBe(PRIVATE_COMPLETION_ERROR_CODE);
    expect(err.statusCode).toBeUndefined();
    expect(errorSurface(err)).not.toContain(PRIVATE_CANARY);
  });
});
