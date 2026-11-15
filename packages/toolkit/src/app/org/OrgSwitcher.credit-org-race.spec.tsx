// @vitest-environment jsdom

import { useSwitchOrg } from "@agent-native/core/client/org";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  activeOrg: "org-a",
  permissionChecks: [] as string[],
}));

vi.mock(
  "../../../../core/src/client/use-session.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../core/src/client/use-session.js")
    >()),
    notifySessionInvalidated: vi.fn(async () => {}),
  }),
);
vi.mock("../../../../core/src/server/request-context.js", () => ({
  getRequestOrgId: () => server.activeOrg,
}));
vi.mock("../../../../core/src/server/fusion-app.js", () => ({
  getBuilderCreditUsage: async () =>
    server.activeOrg === "org-a"
      ? {
          plan: "paid",
          balance: 90,
          quota: { period: "monthly", limit: 100, used: 10, remaining: 90 },
        }
      : {
          plan: "free",
          balance: 0,
          quota: { period: "daily", limit: 10, used: 10, remaining: 0 },
        },
}));
vi.mock("../../../../core/src/usage/metrics-store.js", () => ({
  canViewWorkspaceUsage: async ({ orgId }: { orgId: string }) => {
    server.permissionChecks.push(orgId);
    return false;
  },
}));
vi.mock("../../../../core/src/usage/builder-credit-notice.js", () => ({
  clearBuilderCreditLimitNotice: vi.fn(async () => {}),
}));
vi.mock("../../../../core/src/tracking/failure-counters.js", () => ({
  countCredentialState: vi.fn(),
}));
vi.mock("../../../../core/src/agent/engine/index.js", () => ({
  registerBuiltinEngines: vi.fn(),
  isResolvedEngineUsableForRequest: vi.fn(async () => true),
}));
vi.mock("../../../../core/src/agent/production-agent.js", () => ({
  resolveOwnerEngineApiKey: vi.fn(async () => ({ apiKey: undefined })),
  resolveChatEngine: vi.fn(async () => ({ name: "builder" })),
}));
vi.mock("../../../../core/src/server/credential-provider.js", () => ({
  readDeployCredentialEnv: vi.fn(() => undefined),
}));
vi.mock("../../../../core/src/app-config/index.js", () => ({
  getAppConfig: () => ({ app: { id: "test-app" } }),
}));

import getBuilderCreditStatus from "../../../../core/src/usage/actions/get-builder-credit-status.js";
import { BuilderCreditNotice } from "./OrgSwitcher.js";

const email = "person@example.com";
const orgs = [
  { orgId: "org-a", orgName: "Workspace A", role: "member" },
  { orgId: "org-b", orgName: "Workspace B", role: "member" },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows the current workspace's exhausted credits after another client switches organizations", async () => {
  server.activeOrg = "org-a";
  server.permissionChecks = [];
  const statusCodes: number[] = [];
  const serverErrors: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === "/_agent-native/org/me") {
        return json({
          email,
          orgId: server.activeOrg,
          orgName: server.activeOrg === "org-a" ? "Workspace A" : "Workspace B",
          orgs,
          role: "member",
          domainMatches: [],
          pendingInvitations: [],
        });
      }
      if (url.pathname === "/_agent-native/org/switch") {
        const body = JSON.parse(String(init?.body)) as { orgId: string };
        server.activeOrg = body.orgId;
        return json({ ok: true });
      }
      if (url.pathname === "/_agent-native/actions/get-builder-credit-status") {
        const params = Object.fromEntries(url.searchParams.entries());
        try {
          const result = await getBuilderCreditStatus.run(params, {
            caller: "frontend",
            userEmail: email,
            orgId: server.activeOrg,
          });
          statusCodes.push(200);
          return json(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const status =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            typeof error.statusCode === "number"
              ? error.statusCode
              : 500;
          statusCodes.push(status);
          if (status >= 500) serverErrors.push(message);
          return json({ error: message }, status);
        }
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }),
  );

  const noticeClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const otherClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  let switchOrg: (orgId: string) => Promise<unknown> = async () => {
    throw new Error("switcher not mounted");
  };
  function OtherClient() {
    const mutation = useSwitchOrg();
    switchOrg = mutation.mutateAsync;
    return null;
  }
  const noticeContainer = document.createElement("div");
  const otherContainer = document.createElement("div");
  document.body.append(noticeContainer, otherContainer);
  const noticeRoot = createRoot(noticeContainer);
  const otherRoot = createRoot(otherContainer);

  try {
    await act(async () => {
      noticeRoot.render(
        <QueryClientProvider client={noticeClient}>
          <BuilderCreditNotice />
        </QueryClientProvider>,
      );
      otherRoot.render(
        <QueryClientProvider client={otherClient}>
          <OtherClient />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => expect(statusCodes).toEqual([200]));
    });
    expect(noticeContainer.textContent).not.toContain(
      "Your Builder credits are used up",
    );
    expect(server.permissionChecks).toEqual(["org-a"]);

    await act(async () => {
      await switchOrg("org-b");
    });
    expect(
      noticeClient.getQueryData<{ orgId: string }>(["org-me"])?.orgId,
    ).toBe("org-a");
    const context = {
      caller: "frontend",
      userEmail: email,
      orgId: "org-b",
    } as const;
    await expect(
      getBuilderCreditStatus.run({ orgId: "org-a" }, context),
    ).rejects.toThrow();
    expect(server.permissionChecks).toEqual(["org-a"]);
    await expect(
      getBuilderCreditStatus.run({}, context),
    ).resolves.toMatchObject({
      state: { kind: "exhausted" },
      period: "daily",
    });
    server.permissionChecks = [];
    await act(async () => {
      await noticeClient.invalidateQueries({
        queryKey: ["action", "get-builder-credit-status"],
      });
    });

    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect({
        notice: noticeContainer.textContent,
        noticeOrg: noticeClient.getQueryData<{ orgId: string }>(["org-me"])
          ?.orgId,
        serverErrors,
        checkedCurrentOrg: server.permissionChecks.includes("org-b"),
      }).toEqual({
        notice: "Your Builder credits are used up",
        noticeOrg: "org-b",
        serverErrors: [],
        checkedCurrentOrg: true,
      });
    });
  } finally {
    act(() => {
      noticeRoot.unmount();
      otherRoot.unmount();
    });
    noticeContainer.remove();
    otherContainer.remove();
    noticeClient.clear();
    otherClient.clear();
  }
});
