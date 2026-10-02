import { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestError } from "../lib/request-errors.js";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
}));

vi.mock("../lib/first-party-analytics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/first-party-analytics.js")>()),
  recordAnalyticsEvents: mocks.record,
}));

import { handleAnalyticsTrack } from "./first-party-analytics.js";

function postTrack(body: string, headers: Record<string, string> = {}) {
  const event = new H3Event(
    new Request("https://analytics.example.test/track", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
  return Promise.resolve(handleAnalyticsTrack(event)).then((reply) => ({
    status: event.res.status,
    reply,
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.record.mockReset();
  mocks.record.mockResolvedValue({ accepted: 1, keyId: "apk_1" });
});

describe("analytics track endpoint", () => {
  it("records a batch keyed by the header", async () => {
    await expect(
      postTrack(JSON.stringify({ events: [{ event: "pageview" }] }), {
        "x-agent-native-analytics-key": "anpk_header",
      }),
    ).resolves.toEqual({
      status: 202,
      reply: { success: true, accepted: 1 },
    });
    expect(mocks.record).toHaveBeenCalledWith("anpk_header", [
      expect.objectContaining({ event: "pageview" }),
    ]);
  });

  it("tells the caller what to fix in its own request", async () => {
    await expect(postTrack("{not json")).resolves.toEqual({
      status: 400,
      reply: { error: "Invalid JSON body" },
    });
    await expect(
      postTrack(JSON.stringify({ events: [{ event: "pageview" }] })),
    ).resolves.toEqual({ status: 400, reply: { error: "Missing publicKey" } });

    mocks.record.mockRejectedValueOnce(
      requestError("Invalid analytics public key", 401),
    );
    await expect(
      postTrack(JSON.stringify({ publicKey: "anpk_x", event: "pageview" })),
    ).resolves.toEqual({
      status: 401,
      reply: { error: "Invalid analytics public key" },
    });
  });

  it("keeps a storage failure's details out of the reply", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error(
      'Failed query: insert into "analytics_events" params: evt_1,internal-detail',
    );
    mocks.record.mockRejectedValueOnce(failure);

    const { status, reply } = await postTrack(
      JSON.stringify({ publicKey: "anpk_x", event: "pageview" }),
    );

    expect(status).toBe(500);
    expect(reply).toEqual({ error: "Internal server error" });
    expect(log).toHaveBeenCalledWith(
      "[first-party-analytics] Unexpected request failure:",
      failure,
    );
  });
});
