import { beforeEach, describe, expect, it, vi } from "vitest";

const mint = vi.hoisted(() => vi.fn());
vi.mock("../turn-grant-store.js", () => ({ mintMcpTurnGrant: mint }));

import { runWithRequestContext } from "../../server/request-context.js";
import action from "./mint-turn-grant.js";

type Ctx = Parameters<typeof action.run>[1];
const page: Ctx = {
  caller: "frontend",
  userEmail: "person@example.test",
  appId: "planner",
};

const call = (ctx: Ctx, request: { provenUiRequest?: boolean } = {}) =>
  runWithRequestContext({ userEmail: "person@example.test", ...request }, () =>
    action.run({}, ctx),
  );

describe("mint-turn-grant", () => {
  beforeEach(() => {
    mint.mockReset();
    mint.mockResolvedValue({ grantId: "grant-1" });
  });

  it("mints for the signed-in person and app when the page is proven", async () => {
    await expect(call(page, { provenUiRequest: true })).resolves.toEqual({
      grantId: "grant-1",
    });
    expect(mint).toHaveBeenCalledWith("person@example.test", "planner");
  });

  it.each([
    ["a tool caller", { ...page, caller: "tool" as const }],
    ["an automation", { ...page, automation: true }],
    ["no user", { ...page, userEmail: "" }],
    ["no app", { ...page, appId: "" }],
  ])("refuses %s even on a proven page", async (_name, ctx) => {
    await expect(call(ctx, { provenUiRequest: true })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it("refuses a request that is not a proven page", async () => {
    await expect(call(page)).rejects.toMatchObject({ statusCode: 403 });
    expect(mint).not.toHaveBeenCalled();
  });
});
