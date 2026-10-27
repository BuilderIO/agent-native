import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  isAgentConnectionRequiredError: (error: unknown) =>
    (error as { name?: string } | null)?.name ===
    "AgentConnectionRequiredError",
}));
vi.mock("../../lib/provider-api.js", () => ({
  executeProviderApiRequest: executeRequestMock,
}));

import { createProviderHttp } from "./provider-http.js";
import { OptionListError } from "./types.js";

async function failureOf(call: Promise<unknown>): Promise<OptionListError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof OptionListError) return error;
    throw error;
  }
  throw new Error("Expected the request to fail.");
}

beforeEach(() => vi.clearAllMocks());

describe("createProviderHttp", () => {
  it("sends one GET to the named provider and reads status, body and headers", async () => {
    executeRequestMock.mockResolvedValue({
      response: {
        status: 200,
        ok: true,
        truncated: false,
        json: { ok: true },
        headers: { Link: "<x>; rel=next", "set-cookie-count": 3 },
      },
    });
    const response = await createProviderHttp("github")({
      path: "/user/repos",
      query: { page: "1" },
    });
    expect(executeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "github",
        method: "GET",
        path: "/user/repos",
        query: { page: "1" },
      }),
    );
    expect(response).toEqual({
      status: 200,
      ok: true,
      truncated: false,
      json: { ok: true },
      headers: { link: "<x>; rel=next" },
    });
  });

  it("reads how long a quota cooldown lasts", async () => {
    executeRequestMock.mockResolvedValue({
      response: {
        status: 429,
        ok: false,
        json: undefined,
        headers: {},
        quota: { retryAfterMs: 12_300 },
      },
    });
    const response = await createProviderHttp("slack")({ path: "/x" });
    expect(response.retryAfterSeconds).toBe(13);
  });

  it("reports a provider that is not connected as credential_missing", async () => {
    executeRequestMock.mockRejectedValue(
      Object.assign(new Error("connect"), {
        name: "AgentConnectionRequiredError",
      }),
    );
    const error = await failureOf(createProviderHttp("slack")({ path: "/x" }));
    expect(error).toMatchObject({
      code: "credential_missing",
      reason: "not_connected",
    });
    executeRequestMock.mockRejectedValue(
      new Error("SLACK_BOT_TOKEN is not configured for this workspace"),
    );
    const plain = await failureOf(createProviderHttp("slack")({ path: "/x" }));
    expect(plain.code).toBe("credential_missing");
  });

  describe("a request that did not complete", () => {
    const failed = (cause: unknown) =>
      Object.assign(
        new Error(
          "Provider API request failed (ECONNRESET): GET sentry.io/api/0/organizations/?query=acme",
        ),
        { cause },
      );

    it.each([
      [
        "a timeout",
        Object.assign(
          new Error(
            "Provider API request timed out after 15000ms: GET sentry.io/api/0/organizations/?query=acme",
          ),
          { cause: new DOMException("aborted", "AbortError") },
        ),
      ],
      [
        "a connection that was reset",
        failed(
          Object.assign(new TypeError("fetch failed"), {
            cause: { code: "ECONNRESET" },
          }),
        ),
      ],
      ["a failed lookup", failed({ code: "ENOTFOUND" })],
    ])(
      "is unreadable and retryable after %s, and logs its cause without the query",
      async (_label, thrown) => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        executeRequestMock.mockRejectedValue(thrown);

        const error = await failureOf(
          createProviderHttp("sentry")({ path: "/x" }),
        );

        expect(error).toMatchObject({
          code: "provider_unreadable",
          retryable: true,
        });
        const line = String(log.mock.calls[0]?.[0]);
        expect(line).toContain("sentry");
        expect(line).toContain("network or timeout");
        expect(line).toContain("Error");
        expect(line).not.toContain("query=acme");
        log.mockRestore();
      },
    );

    it("is unreadable but not retryable for an error that is no network failure, and logs what it was", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      executeRequestMock.mockRejectedValue(
        new TypeError(
          "Cannot read properties of undefined (reading 'secrets') xoxb-secret",
        ),
      );

      const error = await failureOf(
        createProviderHttp("sentry")({ path: "/x" }),
      );

      expect(error).toMatchObject({
        code: "provider_unreadable",
        retryable: false,
      });
      expect(error.message).not.toContain("xoxb");
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain("unexpected");
      expect(line).toContain("TypeError");
      expect(line).toContain("Cannot read properties of undefined");
      expect(line).not.toContain("xoxb-secret");
      log.mockRestore();
    });
  });

  it("lets a caller's own abort through instead of calling it a provider failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException("aborted", "AbortError");
    executeRequestMock.mockRejectedValue(aborted);
    await expect(
      createProviderHttp("slack", controller.signal)({ path: "/x" }),
    ).rejects.toBe(aborted);
  });

  it("refuses an answer that has no status", async () => {
    executeRequestMock.mockResolvedValue({ response: { json: {} } });
    const error = await failureOf(createProviderHttp("github")({ path: "/x" }));
    expect(error.code).toBe("provider_unreadable");
  });
});
