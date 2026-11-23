import { createApp, toWebHandler } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorize = vi.hoisted(() => vi.fn<(token: string) => Promise<number>>());

vi.mock("../../model/kernel-access.js", () => ({
  authorizeKernelStreamConnection: authorize,
}));

import handler from "./kernel-stream-authorization.get";

async function call(authorization?: string) {
  const app = createApp().use(handler);
  const request = new Request(
    "http://app.test/api/kernel-stream-authorization",
    {
      headers: authorization === undefined ? {} : { authorization },
    },
  );
  return toWebHandler(app)(request);
}

describe("kernel stream authorization route", () => {
  beforeEach(() => {
    authorize.mockReset();
    authorize.mockResolvedValue(204);
  });

  it("forwards the bearer token and relays the decision uncached", async () => {
    const response = await call("Bearer ticket-1");
    expect(authorize).toHaveBeenCalledWith("ticket-1");
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("relays throttled and denied decisions", async () => {
    authorize.mockResolvedValueOnce(503);
    expect((await call("Bearer ticket-2")).status).toBe(503);
    authorize.mockResolvedValueOnce(403);
    expect((await call("Bearer ticket-3")).status).toBe(403);
  });

  it("rejects requests without a usable bearer token without consulting access", async () => {
    for (const header of [undefined, "", "Bearer", "Bearer ", "Basic abc"]) {
      const response = await call(header);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(authorize).not.toHaveBeenCalled();
  });

  it("treats the authentication scheme as case-insensitive", async () => {
    expect((await call("bearer ticket-4")).status).toBe(204);
    expect((await call("BEARER   ticket-5")).status).toBe(204);
    expect(authorize.mock.calls.map(([token]) => token)).toEqual([
      "ticket-4",
      "ticket-5",
    ]);
  });
});
