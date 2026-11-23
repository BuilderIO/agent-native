import { beforeEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({
  calls: [] as { connectionId: string; options: Record<string, unknown> }[],
}));
const access = vi.hoisted(() => ({
  calls: [] as string[],
  allowed: true,
  error: null as { errorCode: string; message: string } | null,
}));

vi.mock("../server/model/data-browser-catalog.js", () => ({
  refreshDataBrowserCatalog: async (
    connectionId: string,
    options: Record<string, unknown>,
  ) => {
    catalog.calls.push({ connectionId, options });
    return {
      connectionId,
      refreshState: "ready" as const,
      refreshId: null,
      refreshStartedAt: null,
      lastRefreshed: null,
      refreshError: null,
      refreshProgress: null,
      refreshStale: false,
      totalCount: 0,
    };
  },
}));

vi.mock("../server/model/data-schema-refresh-access.js", () => ({
  resolveSchemaRefreshAccess: async (connectionId: string) => {
    access.calls.push(connectionId);
    if (access.error)
      throw Object.assign(new Error(access.error.message), access.error);
    return { allowed: access.allowed };
  },
}));

import getRefreshAccessAction from "./get-data-schema-refresh-access";
import refreshCatalogAction from "./refresh-data-browser-catalog";

describe("schema refresh action dispatcher", () => {
  beforeEach(() => {
    catalog.calls.length = 0;
    access.calls.length = 0;
    access.allowed = true;
    access.error = null;
  });

  it("admits every attested caller through the connection mode", async () => {
    for (const caller of ["frontend", "agent", "mcp", "cli"]) {
      await refreshCatalogAction.run({ connectionId: "qa-connection" }, {
        caller,
      } as never);
    }
    expect(catalog.calls.map((call) => call.options.authorization)).toEqual([
      "connection",
      "connection",
      "connection",
      "connection",
    ]);
    expect(catalog.calls.map((call) => call.options.caller)).toEqual([
      "frontend",
      "agent",
      "mcp",
      "cli",
    ]);
  });

  it("keeps a direct in-process run on the manager contract", async () => {
    await refreshCatalogAction.run({ connectionId: "qa-connection" });
    expect(catalog.calls).toHaveLength(1);
    expect(catalog.calls[0]?.options.authorization).toBe("manager");
    expect(catalog.calls[0]?.options.caller).toBeUndefined();
  });

  it("never lets a caller pick its own mode from request arguments", async () => {
    await expect(
      refreshCatalogAction.run({
        connectionId: "qa-connection",
        authorization: "connection",
      } as never),
    ).rejects.toThrow();
    expect(catalog.calls).toHaveLength(0);
  });
});

describe("schema refresh permission read", () => {
  beforeEach(() => {
    catalog.calls.length = 0;
    access.calls.length = 0;
    access.allowed = true;
    access.error = null;
  });

  it("returns the canonical actor answer for one connection", async () => {
    access.allowed = false;
    expect(
      await getRefreshAccessAction.run({ connectionId: "qa-connection" }, {
        caller: "frontend",
      } as never),
    ).toEqual({ allowed: false });
    access.allowed = true;
    expect(
      await getRefreshAccessAction.run({ connectionId: "qa-connection" }, {
        caller: "agent",
      } as never),
    ).toEqual({ allowed: true });
    expect(access.calls).toEqual(["qa-connection", "qa-connection"]);
  });

  it("propagates an unreadable connection as a typed failure, not false", async () => {
    access.error = {
      errorCode: "data_connection_not_found",
      message: "Data connection not found.",
    };
    await expect(
      getRefreshAccessAction.run(
        { connectionId: "other-workspace-connection" },
        { caller: "frontend" } as never,
      ),
    ).rejects.toMatchObject({ errorCode: "data_connection_not_found" });
  });

  it("declares a read-only, browser-unpersisted GET", () => {
    expect(getRefreshAccessAction.readOnly).toBe(true);
    expect(getRefreshAccessAction.persistInBrowser).toBe(false);
    expect(getRefreshAccessAction.http).toEqual({ method: "GET" });
  });
});
