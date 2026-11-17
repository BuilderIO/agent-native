import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeEvent {
  method: string;
  url: URL;
  headers: Record<string, string>;
  status: number;
}

const state = vi.hoisted(() => ({
  asset: null as null | {
    id: string;
    planId: string;
    data: string;
    mimeType: string;
    filename: string;
  },
  access: null as null | { resource: { deletedAt: number | null } },
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: (event: FakeEvent) => event.method,
  setResponseHeader: (event: FakeEvent, name: string, value: string) => {
    event.headers[name] = value;
  },
  setResponseStatus: (event: FakeEvent, status: number) => {
    event.status = status;
  },
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

vi.mock("@agent-native/core/server", () => ({
  getSession: async () => ({ email: "reader@example.com" }),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: async () => state.access,
}));

vi.mock("./lib/local-identity.js", () => ({
  resolvePlanAccessContext: (context: unknown) => context,
}));

vi.mock("./db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.asset ? [state.asset] : []),
        }),
      }),
    }),
  }),
  schema: { planAssets: { id: "plan_assets.id" }, plans: {} },
}));

const { createPlanAssetHandler } = await import("./plan-asset-route.js");
const handler = createPlanAssetHandler() as unknown as (
  event: FakeEvent,
) => Promise<unknown>;

function request(method = "GET"): FakeEvent {
  return {
    method,
    url: new URL("https://plan.test/asset_1/image"),
    headers: {},
    status: 200,
  };
}

describe("plan asset route", () => {
  beforeEach(() => {
    state.asset = {
      id: "asset_1",
      planId: "plan_1",
      data: Buffer.from("PNGDATA").toString("base64"),
      mimeType: "image/png",
      filename: "diagram.png",
    };
    state.access = { resource: { deletedAt: null } };
  });

  it("keeps a plan's image out of shared caches, since it loads only for people who can open the plan", async () => {
    const response = await handler(request());

    expect(response).toBeInstanceOf(Response);
    const headers = (response as Response).headers;
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("cdn-cache-control")).toBe("no-store");
    expect(headers.get("content-type")).toBe("image/png");
    expect(
      Buffer.from(await (response as Response).arrayBuffer()).toString(),
    ).toBe("PNGDATA");
  });

  it("sends the same cache headers for a HEAD request", async () => {
    const event = request("HEAD");

    await expect(handler(event)).resolves.toBe("");
    expect(event.headers["Cache-Control"]).toBe("private, no-store");
    expect(event.headers["CDN-Cache-Control"]).toBe("no-store");
  });

  it("answers 404 to someone who can't open the plan", async () => {
    state.access = null;
    const event = request();

    await expect(handler(event)).resolves.toEqual({ error: "Not found" });
    expect(event.status).toBe(404);
  });
});
