// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  activeOrg: "org-a" as string | null,
  permissionChecks: [] as (string | null)[],
  creditReads: [] as (string | null)[],
}));

vi.mock("../../../../core/src/server/request-context.js", () => ({
  getRequestOrgId: () => server.activeOrg,
}));
vi.mock("../../../../core/src/server/fusion-app.js", () => ({
  getBuilderCreditUsage: async () => {
    server.creditReads.push(server.activeOrg);
    return server.activeOrg === "org-b"
      ? {
          plan: "free",
          balance: 0,
          quota: { period: "daily", limit: 10, used: 10, remaining: 0 },
        }
      : {
          plan: "paid",
          balance: 90,
          quota: { period: "monthly", limit: 100, used: 10, remaining: 90 },
        };
  },
}));
vi.mock("../../../../core/src/usage/metrics-store.js", () => ({
  canViewWorkspaceUsage: async ({ orgId }: { orgId: string | null }) => {
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
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  { from: "org-a", to: "org-b" },
  { from: null, to: "org-b" },
  { from: "org-a", to: null },
])(
  "reports a scope conflict from $from to $to until a manual org refresh",
  async ({ from, to }) => {
    server.activeOrg = from;
    server.permissionChecks = [];
    server.creditReads = [];
    const statuses: number[] = [];
    const errorCodes: (string | undefined)[] = [];
    const requestedOrgs: (string | null)[] = [];
    let orgReads = 0;
    let sessionReads = 0;
    let orgUnavailable = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.href);
        if (url.pathname === "/_agent-native/auth/session") {
          sessionReads++;
          return json({
            email,
            userId: "person",
            ...(server.activeOrg ? { orgId: server.activeOrg } : {}),
            testIdentity: false,
          });
        }
        if (url.pathname === "/_agent-native/org/me") {
          orgReads++;
          if (orgUnavailable) return json({ error: "unavailable" }, 503);
          return json({
            email,
            orgId: server.activeOrg,
            orgName: null,
            orgs: [],
            role: "member",
            domainMatches: [],
            pendingInvitations: [],
          });
        }
        if (
          url.pathname === "/_agent-native/actions/get-builder-credit-status"
        ) {
          const params = Object.fromEntries(url.searchParams.entries());
          requestedOrgs.push(url.searchParams.get("orgId"));
          try {
            const result = await getBuilderCreditStatus.run(params, {
              caller: "frontend",
              userEmail: email,
              orgId: server.activeOrg,
            });
            statuses.push(200);
            return json(result);
          } catch (error) {
            const e = error as {
              message: string;
              statusCode?: number;
              errorCode?: string;
            };
            const status = e.statusCode ?? 500;
            statuses.push(status);
            errorCodes.push(e.errorCode);
            return json(
              status < 500
                ? { error: e.message, errorCode: e.errorCode }
                : { error: "Action failed" },
              status,
            );
          }
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <BuilderCreditNotice />
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        await vi.waitFor(() => expect(statuses).toEqual([200]));
      });
      expect(requestedOrgs).toEqual([from ?? ""]);
      expect(server.permissionChecks).toEqual([from]);
      expect(server.creditReads).toEqual([from]);
      const oldOrgReads = orgReads;
      const oldSessionReads = sessionReads;
      server.activeOrg = to;
      await act(async () => {
        await client.invalidateQueries({
          queryKey: ["action", "get-builder-credit-status"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(statuses).toEqual([200, 409]);
        expect(container.querySelector("button")).toBeNull();
      });
      expect(orgReads).toBe(oldOrgReads);
      expect(sessionReads).toBe(oldSessionReads);
      expect(
        client.getQueryState([
          "action",
          "get-builder-credit-status",
          { orgId: from ?? "" },
        ])?.status,
      ).toBe("error");
      expect(server.permissionChecks).toEqual([from]);
      expect(server.creditReads).toEqual([from]);
      expect(errorCodes).toEqual(["builder_credit_org_mismatch"]);

      await act(async () => {
        await client.invalidateQueries({ queryKey: ["org-me"] });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(statuses).toEqual([200, 409, 200]);
        expect(
          client.getQueryData<{ orgId: string | null }>(["org-me"])?.orgId,
        ).toBe(to);
      });
      expect(requestedOrgs).toEqual([from ?? "", from ?? "", to ?? ""]);
      expect(orgReads).toBe(oldOrgReads + 1);
      expect(server.permissionChecks).toEqual([from, to]);
      expect(server.creditReads).toEqual([from, to]);
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(Boolean(container.querySelector("button"))).toBe(to === "org-b");
      });

      orgUnavailable = true;
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["org-me"] });
      });
      expect(client.getQueryState(["org-me"])?.status).toBe("error");
      await act(async () => {
        await client.invalidateQueries({
          queryKey: ["action", "get-builder-credit-status"],
        });
      });
      expect(statuses).toEqual([200, 409, 200, 200]);
    } finally {
      act(() => root.unmount());
      container.remove();
      client.clear();
    }
  },
);
