import { afterEach, describe, expect, it, vi } from "vitest";

import { requestJevThroughBuilder, type JevRequest } from "./jev.js";

const requestFixture: JevRequest = {
  model: "jev-latest",
  state: { input: "The customer asks for a refund." },
  questions: {
    isRefundRequest: {
      type: "noul",
      instructions: "Is the customer asking for a refund?",
    },
    route: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: {
        billing: "Payment questions",
        support: "Product questions",
      },
    },
  },
};

const responseFixture = {
  answers: {
    isRefundRequest: { type: "noul", noul: 0.96 },
    route: { type: "choice", choice: "billing" },
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("requestJevThroughBuilder", () => {
  it("sends verified predicate and choice questions through the Builder proxy", async () => {
    vi.stubEnv("BUILDER_PROXY_ORIGIN", "https://proxy.example.test");
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json(responseFixture),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestJevThroughBuilder(
      {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
      requestFixture,
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://proxy.example.test/agent-native/jev/v1/system-one",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        Authorization: "Bearer fake-builder-session",
        "x-builder-api-key": "space-test",
        "x-builder-user-id": "user-test",
      }),
      body: JSON.stringify(requestFixture),
    });
    expect(response).toEqual(responseFixture);
  });
});
