import { describe, expect, it, vi } from "vitest";

import {
  type EngineCredentialOwner,
  tagEngineCredentialOwner,
} from "./engine/credential-owner.js";
import { EngineError } from "./engine/types.js";
import {
  isCustomerKeyRateLimit,
  maxRetriesForError,
} from "./production-agent.js";

function engineOwnedBy(owner: EngineCredentialOwner) {
  const engine = { name: "anthropic", stream: vi.fn() } as any;
  tagEngineCredentialOwner(engine, owner);
  return engine;
}

describe("isCustomerKeyRateLimit", () => {
  it("matches a 429 by status code alone", () => {
    expect(
      isCustomerKeyRateLimit(
        new EngineError("rate limited", { statusCode: 429 }),
        engineOwnedBy("customer"),
      ),
    ).toBe(true);
  });

  it("matches a 429 by error code alone, case-insensitively", () => {
    expect(
      isCustomerKeyRateLimit(
        new EngineError("rate limited", { errorCode: "HTTP_429" }),
        engineOwnedBy("customer"),
      ),
    ).toBe(true);
  });

  it("ignores other statuses, other owners, untagged engines, and plain errors", () => {
    const rateLimited = new EngineError("rate limited", {
      statusCode: 429,
      errorCode: "http_429",
    });
    expect(
      isCustomerKeyRateLimit(
        new EngineError("overloaded", {
          statusCode: 529,
          errorCode: "http_529",
        }),
        engineOwnedBy("customer"),
      ),
    ).toBe(false);
    expect(
      isCustomerKeyRateLimit(
        new EngineError("no status"),
        engineOwnedBy("customer"),
      ),
    ).toBe(false);
    expect(
      isCustomerKeyRateLimit(rateLimited, engineOwnedBy("deployment")),
    ).toBe(false);
    expect(isCustomerKeyRateLimit(rateLimited, engineOwnedBy("builder"))).toBe(
      false,
    );
    expect(isCustomerKeyRateLimit(rateLimited, undefined)).toBe(false);
    expect(
      isCustomerKeyRateLimit(new Error("429"), engineOwnedBy("customer")),
    ).toBe(false);
  });
});

describe("maxRetriesForError", () => {
  it("does not blind-retry a 429 on a customer's own key", () => {
    const err = new EngineError("rate limited", { statusCode: 429 });
    expect(maxRetriesForError(err, engineOwnedBy("customer"))).toBe(0);
  });

  it("waits once for a customer-key 429 that names a Retry-After", () => {
    const err = new EngineError("rate limited", {
      errorCode: "http_429",
      retryAfterMs: 20_000,
    });
    expect(maxRetriesForError(err, engineOwnedBy("customer"))).toBe(1);
  });

  it("keeps the full budget for deployment keys and provider overload", () => {
    const rateLimited = new EngineError("rate limited", {
      statusCode: 429,
      errorCode: "http_429",
    });
    const overloaded = new EngineError("overloaded", {
      statusCode: 529,
      errorCode: "http_529",
    });
    expect(maxRetriesForError(rateLimited, engineOwnedBy("deployment"))).toBe(
      3,
    );
    expect(maxRetriesForError(rateLimited)).toBe(3);
    expect(maxRetriesForError(overloaded, engineOwnedBy("customer"))).toBe(3);
  });
});
