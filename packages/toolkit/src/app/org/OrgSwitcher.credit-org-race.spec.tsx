// @vitest-environment jsdom

import {
  ActionQueryCacheGate,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "@agent-native/core/client/action-query-cache";
import {
  currentActionQueryCacheBinding,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { notifySessionInvalidated } from "@agent-native/core/client/use-session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  activeOrg: "org-a" as string | null,
  permissionChecks: [] as (string | null)[],
}));

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
  setActionQueryCacheStorage(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  { from: "org-a", to: "org-b" },
  { from: null, to: "org-b" },
  { from: "org-a", to: null },
])(
  "recovers credit status after another client switches from $from to $to",
  async ({ from, to }) => {
    server.activeOrg = from;
    server.permissionChecks = [];
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const statusCodes: number[] = [];
    const serverErrors: string[] = [];
    const requestedOrgs: (string | null)[] = [];
    const creditBindings: (object | undefined)[] = [];
    let orgReads = 0;
    const sessionOrgs: (string | null)[] = [];
    let sessionUnavailable = false;
    let orgUnavailable = false;
    const otherReads: Array<{
      org: string | null;
      binding: object | undefined;
    }> = [];
    const records = new Map<
      string,
      NonNullable<Awaited<ReturnType<ActionQueryCacheStorage["get"]>>>
    >();
    setActionQueryCacheStorage({
      get: async (key) => records.get(key),
      set: async (key, value) => {
        records.set(key, value);
      },
      del: async (key) => {
        records.delete(key);
      },
      keys: async () => [...records.keys()],
      clear: async () => {
        records.clear();
      },
    });
    let failure: { status: number; errorCode: string } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.href);
        if (url.pathname === "/_agent-native/auth/session") {
          sessionOrgs.push(server.activeOrg);
          if (sessionUnavailable) return json({ error: "unavailable" }, 503);
          return json({
            email,
            userId: "person",
            ...(server.activeOrg ? { orgId: server.activeOrg } : {}),
            testIdentity: false,
          });
        }
        if (url.pathname === "/_agent-native/actions/list-other-scope") {
          otherReads.push({
            org: server.activeOrg,
            binding: currentActionQueryCacheBinding(),
          });
          return new Response(JSON.stringify({ org: server.activeOrg }), {
            headers: {
              "Content-Type": "application/json",
              "X-Agent-Native-Browser-Persist": "allow",
            },
          });
        }
        if (url.pathname === "/_agent-native/org/me") {
          orgReads++;
          if (orgUnavailable) return json({ error: "unavailable" }, 503);
          return json({
            email,
            orgId: server.activeOrg,
            orgName:
              server.activeOrg === "org-a" ? "Workspace A" : "Workspace B",
            orgs,
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
          creditBindings.push(currentActionQueryCacheBinding());
          if (failure) {
            statusCodes.push(failure.status);
            return json(
              { error: "Service unavailable", errorCode: failure.errorCode },
              failure.status,
            );
          }
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
            const errorCode =
              typeof error === "object" &&
              error !== null &&
              "errorCode" in error &&
              typeof error.errorCode === "string"
                ? error.errorCode
                : undefined;
            return json(
              status < 500
                ? { error: message, ...(errorCode ? { errorCode } : {}) }
                : { error: "Action failed" },
              status,
            );
          }
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    await notifySessionInvalidated();
    const noticeClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function OtherScopedQuery() {
      const query = useActionQuery<{ org: string | null }>(
        "list-other-scope" as never,
        undefined,
        { batchRefetches: false },
      );
      return (
        <span data-other>
          {query.data ? (query.data.org ?? "personal") : "loading"}
        </span>
      );
    }
    const noticeContainer = document.createElement("div");
    document.body.append(noticeContainer);
    const noticeRoot = createRoot(noticeContainer);

    try {
      await act(async () => {
        noticeRoot.render(
          <QueryClientProvider client={noticeClient}>
            <ActionQueryCacheGate>
              <BuilderCreditNotice />
              <OtherScopedQuery />
            </ActionQueryCacheGate>
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        await vi.waitFor(() => expect(statusCodes).toEqual([200]));
      });
      expect(server.permissionChecks).toEqual([from]);
      expect(requestedOrgs).toEqual([from ?? ""]);

      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(currentActionQueryCacheBinding()).toBeDefined();
      });
      await act(async () => {
        await noticeClient.invalidateQueries({
          queryKey: ["action", "list-other-scope"],
        });
      });
      await vi.waitFor(() =>
        expect(
          otherReads.some((read) => read.org === from && read.binding),
        ).toBe(true),
      );
      const previousBinding = currentActionQueryCacheBinding();
      server.activeOrg = to;
      expect(
        noticeClient.getQueryData<{ orgId: string | null }>(["org-me"])?.orgId,
      ).toBe(from);
      const context = {
        caller: "frontend",
        userEmail: email,
        orgId: to,
      } as const;
      await expect(
        getBuilderCreditStatus.run({ orgId: from }, context),
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "builder_credit_org_mismatch",
      });
      expect(server.permissionChecks).toEqual([from]);
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
          notice: noticeContainer.querySelector("button")?.textContent ?? "",
          noticeOrg: noticeClient.getQueryData<{ orgId: string | null }>([
            "org-me",
          ])?.orgId,
          serverErrors,
          checkedCurrentOrg: server.permissionChecks.includes(to),
        }).toEqual({
          notice: "Your Builder credits are used up",
          noticeOrg: to,
          serverErrors: [],
          checkedCurrentOrg: true,
        });
      });
      expect(statusCodes).toEqual([200, 409, 200]);
      expect(requestedOrgs).toEqual([from ?? "", from ?? "", to ?? ""]);
      expect(creditBindings[2]).toBeDefined();
      expect(creditBindings[2]).not.toBe(previousBinding);
      expect(sessionOrgs).toContain(to);
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(
          otherReads.some(
            (read) =>
              read.org === to &&
              read.binding &&
              read.binding !== previousBinding,
          ),
        ).toBe(true);
        expect(noticeContainer.querySelector("[data-other]")?.textContent).toBe(
          to ?? "personal",
        );
      });
      expect(
        otherReads
          .filter((read) => read.org === to)
          .every((read) => read.binding !== previousBinding),
      ).toBe(true);
      await vi.waitFor(
        async () => {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          const scoped = [...records.entries()].find(
            ([key]) => JSON.parse(key)[1] === to,
          );
          expect(scoped).toBeDefined();
          expect(
            scoped?.[1].clientState.queries.some(
              (query) =>
                query.queryKey[1] === "list-other-scope" &&
                (query.state.data as { org: string | null }).org === to,
            ),
          ).toBe(true);
        },
        { timeout: 4000 },
      );

      const orgReadsBeforeOutage = orgReads;
      failure = { status: 503, errorCode: "upstream_unavailable" };
      await act(async () => {
        await noticeClient.invalidateQueries({
          queryKey: ["action", "get-builder-credit-status"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(
          noticeContainer.querySelector("button")?.textContent ?? "",
        ).not.toContain("Your Builder credits are used up");
      });
      expect(statusCodes).toEqual([200, 409, 200, 503]);
      expect(orgReads).toBe(orgReadsBeforeOutage);

      failure = { status: 409, errorCode: "different_conflict" };
      await act(async () => {
        await noticeClient.invalidateQueries({
          queryKey: ["action", "get-builder-credit-status"],
        });
      });
      expect(statusCodes).toEqual([200, 409, 200, 503, 409]);
      expect(orgReads).toBe(orgReadsBeforeOutage);

      failure = null;
      server.activeOrg = from;
      sessionUnavailable = true;
      orgUnavailable = true;
      const sessionReadsBeforeFailure = sessionOrgs.length;
      const creditReadsBeforeFailure = statusCodes.length;
      await act(async () => {
        await noticeClient.invalidateQueries({
          queryKey: ["action", "get-builder-credit-status"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(sessionOrgs.length).toBeGreaterThan(sessionReadsBeforeFailure);
      });
      expect(orgReads).toBe(orgReadsBeforeOutage);
      expect(currentActionQueryCacheBinding()).toBeUndefined();
      expect(statusCodes).toHaveLength(creditReadsBeforeFailure + 1);
      expect(statusCodes.at(-1)).toBe(409);
      expect(
        noticeClient.getQueryState([
          "action",
          "get-builder-credit-status",
          { orgId: to ?? "" },
        ])?.status,
      ).toBe("error");
      expect(noticeContainer.querySelector("button")).toBeNull();
      expect(noticeContainer.querySelector("[data-other]")?.textContent).toBe(
        "loading",
      );

      sessionUnavailable = false;
      await vi.waitFor(
        async () => {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          expect(noticeClient.getQueryState(["org-me"])?.status).toBe("error");
        },
        { timeout: 4000 },
      );
      expect(statusCodes).toHaveLength(creditReadsBeforeFailure + 1);
      expect(noticeContainer.querySelector("button")).toBeNull();
      expect(warning).toHaveBeenCalledWith(
        "Unable to refresh organization after credit scope changed",
        expect.any(Error),
      );

      orgUnavailable = false;
      await act(async () => {
        await noticeClient.invalidateQueries({ queryKey: ["org-me"] });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(
          noticeClient.getQueryData<{ orgId: string | null }>(["org-me"])
            ?.orgId,
        ).toBe(from);
        expect(currentActionQueryCacheBinding()).toBeDefined();
      });
      const sameScopeBinding = currentActionQueryCacheBinding();
      orgUnavailable = true;
      failure = { status: 409, errorCode: "builder_credit_org_mismatch" };
      await act(async () => {
        await noticeClient.invalidateQueries({
          queryKey: ["action", "get-builder-credit-status"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(noticeClient.getQueryState(["org-me"])?.status).toBe("error");
      });
      expect(currentActionQueryCacheBinding()).toBeUndefined();
      failure = null;
      orgUnavailable = false;
      await act(async () => {
        await noticeClient.invalidateQueries({ queryKey: ["org-me"] });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(currentActionQueryCacheBinding()).toBe(sameScopeBinding);
      });
    } finally {
      act(() => {
        noticeRoot.unmount();
      });
      noticeContainer.remove();
      noticeClient.clear();
    }
  },
);
