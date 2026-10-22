import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listAppUsageMetricsMock = vi.hoisted(() => vi.fn());
const isOrgMemberMock = vi.hoisted(() => vi.fn());
const canViewWorkspaceUsageMock = vi.hoisted(() => vi.fn());

vi.mock("../../action.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../action.js")>()),
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../../org/membership.js", () => ({
  isOrgMember: isOrgMemberMock,
}));

vi.mock("../metrics-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../metrics-store.js")>()),
  listAppUsageMetrics: listAppUsageMetricsMock,
  canViewWorkspaceUsage: canViewWorkspaceUsageMock,
}));

import { resetAppConfigForTests } from "../../app-config/index.js";
import { ALL_USAGE_APPS } from "../metrics-store.js";
import getUsageMetrics from "./get-usage-metrics.js";

describe("get-usage-metrics action", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    vi.stubEnv("AGENT_NATIVE_APP_ID", "configured-app");
    listAppUsageMetricsMock.mockResolvedValue({ ok: true });
    isOrgMemberMock.mockResolvedValue(true);
    canViewWorkspaceUsageMock.mockResolvedValue(true);
  });

  afterEach(() => {
    resetAppConfigForTests();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("covers every app when no app filter is passed", async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me" },
      {
        caller: "frontend",
        userEmail: "owner@example.com",
        appId: "plan",
      },
    );

    expect(listAppUsageMetricsMock).toHaveBeenCalledWith(
      {
        sinceDays: 30,
        scope: "me",
        userEmail: undefined,
        builderCreditsEnabled: true,
      },
      {
        ownerEmail: "owner@example.com",
        orgId: undefined,
        app: ALL_USAGE_APPS,
      },
    );
  });

  it('treats app "all" as every app', async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me", app: "all" },
      { caller: "frontend", userEmail: "owner@example.com" },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[1]).toMatchObject({
      app: ALL_USAGE_APPS,
    });
  });

  it('resolves app "current" to the configured identity, not the static plugin context id', async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me", app: "current" },
      {
        caller: "frontend",
        userEmail: "owner@example.com",
        appId: "plan",
      },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[1]).toMatchObject({
      app: "configured-app",
    });
  });

  it("filters to one app key", async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "workspace", app: "mail" },
      { caller: "frontend", userEmail: "owner@example.com", orgId: "org-1" },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[1]).toEqual({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      app: "mail",
    });
  });

  it("rejects app and appId together instead of picking one", async () => {
    await expect(
      getUsageMetrics.run(
        { sinceDays: 30, scope: "me", app: "all", appId: "mail" },
        { caller: "frontend", userEmail: "owner@example.com" },
      ),
    ).rejects.toThrow("Pass app or appId, not both.");
    expect(listAppUsageMetricsMock).not.toHaveBeenCalled();
  });

  it("keeps an explicit app filter authoritative", async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me", appId: "selected-app" },
      {
        caller: "frontend",
        userEmail: "owner@example.com",
        appId: "plan",
      },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[1]).toMatchObject({
      app: "selected-app",
    });
  });

  it("always includes per-call Builder credit reporting", async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me" },
      { caller: "frontend", userEmail: "owner@example.com" },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[0]).toMatchObject({
      builderCreditsEnabled: true,
    });
  });

  it("rejects a userEmail outside the organization with a redirect to the owning app", async () => {
    isOrgMemberMock.mockResolvedValue(false);

    const error = await getUsageMetrics
      .run(
        {
          sinceDays: 7,
          scope: "workspace",
          userEmail: "cust@customer.example",
        },
        { caller: "agent", userEmail: "admin@example.com", orgId: "org-1" },
      )
      .catch((caught: unknown) => caught);

    expect(isOrgMemberMock).toHaveBeenCalledWith(
      "org-1",
      "cust@customer.example",
    );
    expect(error).toMatchObject({
      errorCode: "usage_user_not_org_member",
      statusCode: 404,
    });
    expect((error as Error).message).toContain(
      "cust@customer.example is not a member of this organization",
    );
    expect((error as Error).message).toContain("own customer or billing actions");
    expect((error as Error).message).toContain("describe-workspace-apps");
    expect(listAppUsageMetricsMock).not.toHaveBeenCalled();
  });

  it("still serves a userEmail that belongs to the organization", async () => {
    await getUsageMetrics.run(
      { sinceDays: 7, scope: "workspace", userEmail: "member@example.com" },
      { caller: "agent", userEmail: "admin@example.com", orgId: "org-1" },
    );

    expect(isOrgMemberMock).toHaveBeenCalledWith("org-1", "member@example.com");
    expect(listAppUsageMetricsMock.mock.calls[0]?.[0]).toMatchObject({
      userEmail: "member@example.com",
    });
  });

  it("skips the membership check without an organization or for the caller's own email", async () => {
    await getUsageMetrics.run(
      { sinceDays: 7, scope: "me", userEmail: "solo@example.com" },
      { caller: "agent", userEmail: "solo@example.com" },
    );
    await getUsageMetrics.run(
      { sinceDays: 7, scope: "me", userEmail: "Admin@Example.com" },
      { caller: "agent", userEmail: "admin@example.com", orgId: "org-1" },
    );

    expect(isOrgMemberMock).not.toHaveBeenCalled();
    expect(listAppUsageMetricsMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])(
    "gives a caller without workspace access the same answer whether or not the email is a member (member=%s)",
    async (member) => {
      canViewWorkspaceUsageMock.mockResolvedValue(false);
      isOrgMemberMock.mockResolvedValue(member);

      const error = await getUsageMetrics
        .run(
          {
            sinceDays: 7,
            scope: "workspace",
            userEmail: "someone@example.com",
          },
          {
            caller: "agent",
            userEmail: "member@example.com",
            orgId: "org-1",
          } as any,
        )
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        errorCode: "usage_user_lookup_forbidden",
        statusCode: 403,
      });
      expect((error as Error).message).toContain("own customer or billing actions");
      expect(isOrgMemberMock).not.toHaveBeenCalled();
      expect(listAppUsageMetricsMock).not.toHaveBeenCalled();
    },
  );

  it('ignores userEmail for scope "me", matching Dispatch', async () => {
    canViewWorkspaceUsageMock.mockResolvedValue(false);
    isOrgMemberMock.mockResolvedValue(false);

    await getUsageMetrics.run(
      { sinceDays: 7, scope: "me", userEmail: "someone@example.com" },
      {
        caller: "agent",
        userEmail: "member@example.com",
        orgId: "org-1",
      } as any,
    );

    expect(canViewWorkspaceUsageMock).not.toHaveBeenCalled();
    expect(isOrgMemberMock).not.toHaveBeenCalled();
    expect(listAppUsageMetricsMock).toHaveBeenCalled();
  });

  it("scopes the description to this organization's members, not external customers", () => {
    const description = (getUsageMetrics as unknown as { description: string })
      .description;
    const firstSentence = description.split(". ")[0];

    expect(firstSentence).toContain("members of this organization");
    expect(firstSentence).toContain("does NOT cover");
    expect(firstSentence).toContain("external customers");
    expect(firstSentence).toContain("describe-workspace-apps");
  });
});
