import { defineAction } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWithoutExecutionFence } from "../../../packages/core/src/agent/execution-fence.js";
import { executeAgentToolCall } from "../../../packages/core/src/agent/production-agent.js";

const orgSettings = new Map<string, Record<string, unknown>>();
const requireAnalyticsAdminContext = vi.fn();
const defineAutomation = vi.fn();
const updateAutomation = vi.fn();
const listAutomationDefinitions = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "admin@example.com",
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: vi.fn(
    async (orgId: string, key: string) =>
      orgSettings.get(`${orgId}:${key}`) ?? null,
  ),
  putOrgSetting: vi.fn(
    async (orgId: string, key: string, value: Record<string, unknown>) => {
      orgSettings.set(`${orgId}:${key}`, value);
    },
  ),
}));

vi.mock("@agent-native/core/triggers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/triggers")>()),
  defineAutomation,
  listAutomationDefinitions,
  updateAutomation,
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext,
}));

const { default: setIndexSchedule } = await import("./set-index-schedule");

const ctx = { appId: "analytics", caller: "frontend" } as const;
const actor = {
  userEmail: "admin@example.com",
  orgId: "org-1",
  appId: "analytics",
  caller: "frontend",
  networkProtocol: undefined,
  automation: undefined,
};

function storeSchedule(value: Record<string, unknown>) {
  orgSettings.set(`org-1:analytics-index-schedule`, value);
}

describe("set-index-schedule action", () => {
  beforeEach(() => {
    orgSettings.clear();
    defineAutomation.mockReset();
    updateAutomation.mockReset();
    listAutomationDefinitions.mockReset();
    requireAnalyticsAdminContext.mockReset();
    requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "admin@example.com",
      orgId: "org-1",
      role: "owner",
    });
    listAutomationDefinitions.mockResolvedValue([]);
    defineAutomation.mockResolvedValue({ name: "analytics-data-index" });
    updateAutomation.mockResolvedValue({ name: "analytics-data-index" });
  });

  it.each(
    (["mcp", "a2a"] as const).flatMap((networkProtocol) =>
      (["tool", "frontend"] as const).map((caller) => ({
        networkProtocol,
        caller,
      })),
    ),
  )(
    "requires approval under a $networkProtocol ancestor with an inner $caller context",
    async ({ networkProtocol, caller }) => {
      const input = { enabled: true, cron: "0 7 * * *", timezone: "UTC" };
      const call = (args = input, approvedToolCalls?: string[]) => {
        const outer = defineAction({
          run: () =>
            runWithoutExecutionFence(() =>
              executeAgentToolCall({
                actions: { "set-index-schedule": setIndexSchedule },
                name: "set-index-schedule",
                callId: "nested-index",
                input: args,
                caller,
                appId: "analytics",
                ownerEmail: "admin@example.com",
                orgId: "org-1",
                approvedToolCalls,
                consumeApproval: async () => true,
              }),
            ),
        });
        return outer.run({}, { caller: "tool", networkProtocol });
      };
      const paused = await call();
      expect(paused.status).toBe("approval_required");
      expect(requireAnalyticsAdminContext).not.toHaveBeenCalled();
      expect(defineAutomation).not.toHaveBeenCalled();
      expect(updateAutomation).not.toHaveBeenCalled();
      expect(orgSettings.size).toBe(0);
      if (paused.status !== "approval_required")
        throw new Error("Missing approval");
      expect(
        (await call({ ...input, cron: "0 8 * * *" }, [paused.approvalKey]))
          .status,
      ).toBe("approval_required");
      expect(orgSettings.size).toBe(0);
      expect((await call(input, [paused.approvalKey])).status).toBe(
        "completed",
      );
      expect(defineAutomation).toHaveBeenCalledOnce();
      expect(defineAutomation.mock.calls[0][0]).toEqual({ ...actor, caller });
      expect(updateAutomation).not.toHaveBeenCalled();
      expect(orgSettings.get("org-1:analytics-index-schedule")).toMatchObject(
        input,
      );
    },
  );

  describe.each(["mcp", "a2a"] as const)("tool over %s", (networkProtocol) => {
    it.each(["create", "update", "disable"] as const)(
      "pauses %s before any write and replays only exact input once with origin",
      async (operation) => {
        if (operation !== "create") {
          storeSchedule({
            enabled: true,
            cron: "0 6 * * *",
            timezone: "UTC",
            automationName: "peer-index",
          });
          listAutomationDefinitions.mockResolvedValue([
            { name: "peer-index", meta: { createdBy: "peer@example.com" } },
          ]);
        }
        const input = {
          enabled: operation !== "disable",
          cron: "0 7 * * *",
          timezone: "UTC",
        };
        const call = (args = input, approvedToolCalls?: string[]) =>
          runWithoutExecutionFence(() =>
            executeAgentToolCall({
              actions: { "set-index-schedule": setIndexSchedule },
              name: "set-index-schedule",
              callId: "index-schedule",
              input: args,
              caller: "tool",
              networkProtocol,
              appId: "analytics",
              ownerEmail: "admin@example.com",
              orgId: "org-1",
              approvedToolCalls,
              consumeApproval: async () => true,
            }),
          );
        const previous = new Map(orgSettings);
        const paused = await call();
        expect(paused.status).toBe("approval_required");
        expect(defineAutomation).not.toHaveBeenCalled();
        expect(updateAutomation).not.toHaveBeenCalled();
        expect(orgSettings).toEqual(previous);
        if (paused.status !== "approval_required")
          throw new Error("Missing approval");
        expect(
          (await call({ ...input, cron: "0 8 * * *" }, [paused.approvalKey]))
            .status,
        ).toBe("approval_required");
        expect(orgSettings).toEqual(previous);
        expect((await call(input, [paused.approvalKey])).status).toBe(
          "completed",
        );
        const effect =
          operation === "create" ? defineAutomation : updateAutomation;
        expect(effect).toHaveBeenCalledOnce();
        expect(effect.mock.calls[0][0]).toEqual({
          ...actor,
          caller: "tool",
          networkProtocol,
        });
        expect(orgSettings.get("org-1:analytics-index-schedule")).toMatchObject(
          input,
        );
      },
    );
  });

  it.each(["frontend", "tool"] as const)(
    "keeps ordinary %s scheduling trusted",
    async (caller) => {
      const input = { enabled: true, cron: "0 6 * * *", timezone: "UTC" };
      if (typeof setIndexSchedule.needsApproval !== "function")
        throw new Error("Missing approval gate");
      expect(
        await setIndexSchedule.needsApproval(input, { ...ctx, caller }),
      ).toBe(false);
      await setIndexSchedule.run(input, { ...ctx, caller });
      expect(defineAutomation).toHaveBeenCalledExactlyOnceWith(
        { ...actor, caller },
        expect.anything(),
      );
    },
  );

  it("creates the scheduled automation on first enable and stores its name", async () => {
    const result = await setIndexSchedule.run(
      { enabled: true, cron: "0 6 * * *", timezone: "UTC" },
      ctx,
    );

    expect(defineAutomation).toHaveBeenCalledTimes(1);
    const [calledActor, input] = defineAutomation.mock.calls[0];
    expect(calledActor).toEqual(actor);
    expect(input).toMatchObject({
      name: "analytics-data-index",
      scope: "organization",
      triggerType: "schedule",
      schedule: "0 6 * * *",
      timezone: "UTC",
    });
    expect(input.body).toContain("build-data-index");
    expect(input.body).toContain('trigger "scheduled"');
    expect(updateAutomation).not.toHaveBeenCalled();
    expect(result).toEqual({
      enabled: true,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: "analytics-data-index",
    });
    expect(orgSettings.get("org-1:analytics-index-schedule")).toEqual(result);
  });

  it("updates the stored automation instead of creating a second one", async () => {
    storeSchedule({
      enabled: false,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: "nightly-index",
    });
    listAutomationDefinitions.mockResolvedValue([{ name: "nightly-index" }]);

    const result = await setIndexSchedule.run(
      { enabled: true, cron: "0 7 * * *", timezone: "Europe/London" },
      ctx,
    );

    expect(defineAutomation).not.toHaveBeenCalled();
    expect(updateAutomation).toHaveBeenCalledWith(actor, {
      name: "nightly-index",
      scope: "organization",
      enabled: true,
      schedule: "0 7 * * *",
      timezone: "Europe/London",
      body: expect.stringContaining("build-data-index"),
    });
    expect(result).toEqual({
      enabled: true,
      cron: "0 7 * * *",
      timezone: "Europe/London",
      automationName: "nightly-index",
    });
  });

  it("disables the automation without deleting it", async () => {
    storeSchedule({
      enabled: true,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: "analytics-data-index",
    });
    listAutomationDefinitions.mockResolvedValue([
      { name: "analytics-data-index" },
    ]);

    const result = await setIndexSchedule.run(
      { enabled: false, cron: "0 6 * * *", timezone: "UTC" },
      ctx,
    );

    expect(updateAutomation).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        name: "analytics-data-index",
        enabled: false,
      }),
    );
    expect(defineAutomation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      enabled: false,
      automationName: "analytics-data-index",
    });
  });

  it("saves a disabled schedule without creating an automation", async () => {
    const result = await setIndexSchedule.run(
      { enabled: false, cron: "0 6 * * *", timezone: "UTC" },
      ctx,
    );

    expect(defineAutomation).not.toHaveBeenCalled();
    expect(updateAutomation).not.toHaveBeenCalled();
    expect(result).toEqual({
      enabled: false,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: null,
    });
    expect(orgSettings.get("org-1:analytics-index-schedule")).toEqual(result);
  });

  it("rejects an invalid cron before touching automations or the setting", async () => {
    await expect(
      setIndexSchedule.run(
        { enabled: true, cron: "every morning", timezone: "UTC" },
        ctx,
      ),
    ).rejects.toThrow(/Invalid cron expression/);

    expect(listAutomationDefinitions).not.toHaveBeenCalled();
    expect(defineAutomation).not.toHaveBeenCalled();
    expect(updateAutomation).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });

  it("rejects an unknown timezone before touching automations", async () => {
    await expect(
      setIndexSchedule.run(
        { enabled: true, cron: "0 6 * * *", timezone: "Mars/Olympus" },
        ctx,
      ),
    ).rejects.toThrow(/Unknown timezone/);

    expect(defineAutomation).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });

  it("refuses non-admins before reading or writing anything", async () => {
    requireAnalyticsAdminContext.mockRejectedValue(
      new Error(
        "Only organization owners and admins can use Analytics admin tools.",
      ),
    );

    await expect(
      setIndexSchedule.run(
        { enabled: true, cron: "0 6 * * *", timezone: "UTC" },
        ctx,
      ),
    ).rejects.toThrow(/owners and admins/);

    expect(listAutomationDefinitions).not.toHaveBeenCalled();
    expect(defineAutomation).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });

  it("refuses to save an automation that has no app id, since the scheduler would never run it", async () => {
    await expect(
      setIndexSchedule.run(
        { enabled: true, cron: "0 6 * * *", timezone: "UTC" },
        {} as never,
      ),
    ).rejects.toThrow(/app id/);

    expect(defineAutomation).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });
});
