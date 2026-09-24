import { ActionContractError } from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertBuilder: vi.fn(),
  resolveAccess: vi.fn(),
  assertAccess: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("@agent-native/core/server/builder-dsi-access", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/server/builder-dsi-access")
  >()),
  assertBuilderDsiAccess: mocks.assertBuilder,
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
  assertAccess: mocks.assertAccess,
  accessFilter: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ getDb: mocks.getDb, schema: {} }));

import start from "../../actions/start-design-system-authoring.js";
import { designSystemAuthoring } from "./design-system-authoring.js";

const denied = new ActionContractError("Connect Builder", {
  errorCode: "builder_dsi_missing",
  statusCode: 403,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertBuilder.mockRejectedValue(denied);
  const access = {
    role: "owner",
    resource: {
      id: "system",
      title: "System",
      data: '{"authoring":{"systemId":"system"}}',
    },
  };
  mocks.resolveAccess.mockResolvedValue(access);
  mocks.assertAccess.mockResolvedValue(access);
});

describe("authoring account enforcement at the app store boundary", () => {
  it("blocks creation through both the registered action and the direct service before insert", async () => {
    const input = {
      requestId: "example-request",
      title: "Example system",
      intent: "fresh" as const,
      sources: [],
    };
    await expect(start.run(input)).rejects.toBe(denied);
    await expect(
      runWithRequestContext({ userEmail: "caller@example.test" }, () =>
        designSystemAuthoring.start(input),
      ),
    ).rejects.toBe(denied);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Builder generation",
      () =>
        designSystemAuthoring.runBuilder({
          id: "system",
          requestId: "turn",
          prompt: "Use a calm editorial direction.",
        }),
    ],
    [
      "Builder publication",
      () =>
        designSystemAuthoring.publishBuilder({
          id: "system",
          requestId: "publication",
          expectedRevision: "reviewed-revision",
        }),
    ],
    ["workspace", () => designSystemAuthoring.get("system")],
    ["artifact", () => designSystemAuthoring.getArtifact("system", "colors")],
    ["resume", () => designSystemAuthoring.resume("system")],
    ["kickoff claim", () => designSystemAuthoring.claimKickoff("system")],
    [
      "kickoff completion",
      () =>
        designSystemAuthoring.completeKickoff({
          id: "system",
          claimId: "claim",
          status: "delivered",
        }),
    ],
    [
      "run binding",
      () => designSystemAuthoring.bindRun({ id: "system", runId: "run" }),
    ],
    [
      "update",
      () =>
        designSystemAuthoring.update({
          id: "system",
          expectedRevision: 0,
          operationId: "update",
          selectedTargetId: "colors",
        }),
    ],
    [
      "artifact write",
      () =>
        designSystemAuthoring.write({
          id: "system",
          expectedRevision: 0,
          operationId: "write",
          targetId: "colors",
          kind: "foundation",
          name: "Colors",
          provenance: "manual",
          sourceIds: [],
          values: { primary: "example" },
        }),
    ],
  ] as const)(
    "blocks %s before stored content or native runs can be read",
    async (_name, read) => {
      await expect(read()).rejects.toBe(denied);
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );

  it("allows reading a legacy local system but requires Builder to turn it into an authoring workspace", async () => {
    const access = {
      role: "owner",
      resource: { id: "local", title: "Local", data: "{}" },
    };
    mocks.resolveAccess.mockResolvedValue(access);
    mocks.assertAccess.mockResolvedValue(access);
    await expect(designSystemAuthoring.get("local")).resolves.toMatchObject({
      id: "local",
      workspace: null,
    });
    await expect(designSystemAuthoring.resume("local")).rejects.toBe(denied);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
