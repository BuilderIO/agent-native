import { describe, expect, it, vi } from "vitest";

const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const readRawBody = vi.hoisted(() => vi.fn());
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
  readRawBody: (...args: unknown[]) => readRawBody(...args),
}));

import handler from "./claim.post";

describe("PR4 broker route", () => {
  it("fails closed uniformly without treating headers or body as identity", async () => {
    const result = await handler({
      headers: { "x-anc-endpoint-id": "forged" },
      body: { endpointId: "forged" },
    } as never);
    expect(result).toEqual({ error: "Request unavailable" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(readRawBody).not.toHaveBeenCalled();
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
    expect(JSON.stringify(result)).not.toContain("endpoint");
  });
});
