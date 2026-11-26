import { createApp } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAction, fail } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";

const { browserSession } = vi.hoisted(() => ({ browserSession: vi.fn() }));
vi.mock("./auth.js", async (original) => ({
  ...(await original<typeof import("./auth.js")>()),
  getBrowserCookieSession: browserSession,
}));
vi.mock("../org/context.js", async (original) => ({
  ...(await original<typeof import("../org/context.js")>()),
  resolveOrgIdForEmail: async () => undefined,
  resolveOrgScopeForEmail: async () => ({ status: "unknown" }),
}));
vi.mock("./framework-request-handler.js", () => ({
  getH3App: (app: unknown) => app,
}));
vi.mock("./ui-action-capability.js", () => ({
  hasUiActionCapability: () => true,
}));
vi.mock("./action-change.js", () => ({
  actionCallIsReadOnly: () => false,
  notifyActionChange: vi.fn(),
  notifyActionChangeForResponse: async () => true,
}));
import { PRIVATE_ACTION_SCOPE_HEADER } from "../shared/private-action-scope.js";
import { mountActionRoutes } from "./action-routes.js";
import {
  markExplicitPersonalOrgScope,
  getRequestContext,
} from "./request-context.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("private HTTP scope before body consumption", () => {
  it.each([
    {
      mode: "contract",
      status: 400,
      payload: {
        error: "Dataset regional_fixture could not be verified.",
        errorCode: "data_connection_dataset_unverified",
        details: { field: "datasetNames", dataset: "regional_fixture" },
      },
    },
    {
      mode: "schema",
      status: 400,
      payload: {
        error: "Invalid action parameters",
        errorCode: "action_invalid_parameters",
      },
    },
    {
      mode: "nested",
      status: 400,
      payload: {
        error: "Invalid action parameters",
        errorCode: "action_invalid_parameters",
      },
    },
    {
      mode: "client",
      status: 422,
      payload: { error: "Rejected request.", errorCode: "action_http_422" },
    },
    {
      mode: "internal",
      status: 500,
      payload: {
        error: "Internal server error",
        errorCode: "action_execution_failed",
      },
    },
  ])(
    "returns readable typed JSON for a private $mode action error",
    async ({ mode, status, payload }) => {
      const email = "actor@example.test";
      const orgId = "org-test";
      const authUserId = "auth-test";
      browserSession.mockResolvedValue({ email, authUserId });
      const app = createApp();
      mountActionRoutes(
        app,
        {
          "private-save": {
            schema: z.object({
              mode: z.enum(["contract", "nested", "client", "internal"]),
              secret: z.string(),
            }),
            run: async (args: { secret: string }) => {
              if (mode === "nested")
                await defineAction({
                  schema: z.object({ code: z.string().max(4) }),
                  run: async () => null,
                }).run({ code: args.secret });
              if (mode === "internal") throw new Error("test-private-body");
              if (mode === "client")
                throw Object.assign(new Error("Rejected request."), {
                  statusCode: 422,
                });
              fail("Dataset regional_fixture could not be verified.", {
                statusCode: 400,
                errorCode: "data_connection_dataset_unverified",
                details: { field: "datasetNames", dataset: "regional_fixture" },
              });
            },
            uiOnly: true,
            persistInChatHistory: false,
            agentTool: false,
            mcpTool: false,
            toolCallable: false,
          } as ActionEntry,
        },
        {
          getOwnerFromEvent: async () => email,
          getAuthUserIdFromEvent: async () => authUserId,
          resolveOrgId: async () => orgId,
        },
      );
      const response = await app.fetch(
        new Request("https://example.test/_agent-native/actions/private-save", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            "x-agent-native-frontend": "1",
            [PRIVATE_ACTION_SCOPE_HEADER]: JSON.stringify({
              email,
              orgId,
              authUserId,
            }),
          },
          body: JSON.stringify({ mode, secret: "test-private-body" }),
        }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toMatch(
        /^application\/json\b/,
      );
      expect(await response.json()).toEqual(payload);
    },
  );

  it.each([
    {
      label: "organization switched",
      orgId: "org-other",
      actor: "auth-test",
      email: "actor@example.test",
      personal: false,
      privateMetadata: true,
      ok: false,
    },
    {
      label: "authenticated actor switched",
      orgId: "org-test",
      actor: "auth-other",
      email: "actor@example.test",
      personal: false,
      privateMetadata: true,
      ok: false,
    },
    {
      label: "effective user switched",
      orgId: "org-test",
      actor: "auth-test",
      email: "other@example.test",
      personal: false,
      privateMetadata: true,
      ok: false,
    },
    {
      label: "missing action privacy metadata",
      orgId: "org-test",
      actor: "auth-test",
      email: "actor@example.test",
      personal: false,
      privateMetadata: false,
      ok: false,
    },
    {
      label: "known organization",
      orgId: "org-test",
      actor: "auth-test",
      email: "actor@example.test",
      personal: false,
      privateMetadata: true,
      ok: true,
    },
    {
      label: "unknown personal organization",
      orgId: undefined,
      actor: "auth-test",
      email: "actor@example.test",
      personal: false,
      privateMetadata: true,
      ok: false,
    },
    {
      label: "known personal organization",
      orgId: undefined,
      actor: "auth-test",
      email: "actor@example.test",
      personal: true,
      privateMetadata: true,
      ok: true,
    },
    {
      label: "missing canonical actor",
      orgId: "org-test",
      actor: undefined,
      email: "actor@example.test",
      personal: false,
      privateMetadata: true,
      ok: false,
    },
  ])(
    "$label",
    async ({ orgId, actor, email, personal, privateMetadata, ok }) => {
      browserSession.mockResolvedValue({
        email,
        userId: actor,
        authUserId: actor,
      });
      const app = createApp();
      const run = vi.fn(async (input: unknown) => ({
        saved: true,
        input,
        orgScope: getRequestContext()?.orgScope,
      }));
      const entry = {
        run,
        uiOnly: true,
        agentTool: false,
        mcpTool: false,
        toolCallable: false,
        ...(privateMetadata ? { persistInChatHistory: false } : {}),
      } as ActionEntry;
      mountActionRoutes(
        app,
        { "private-save": entry },
        {
          getOwnerFromEvent: async () => email,
          getAuthUserIdFromEvent: async () => actor,
          resolveOrgId: async (event) => {
            if (personal) markExplicitPersonalOrgScope(event);
            return orgId;
          },
        },
      );
      const request = new Request(
        "https://example.test/_agent-native/actions/private-save",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            "x-agent-native-frontend": "1",
            [PRIVATE_ACTION_SCOPE_HEADER]: JSON.stringify({
              email: "actor@example.test",
              orgId: orgId === undefined ? null : "org-test",
              authUserId: "auth-test",
            }),
          },
          body: JSON.stringify({ secret: "test-private-body" }),
        },
      );
      const response = await app.fetch(request);
      expect(response.status).toBe(ok ? 200 : 409);
      if (ok) {
        expect(await response.json()).toEqual({
          saved: true,
          input: { secret: "test-private-body" },
          ...(personal ? { orgScope: "personal" } : {}),
        });
        expect(request.bodyUsed).toBe(true);
        expect(run).toHaveBeenCalledOnce();
      } else {
        expect(await response.json()).toEqual({
          error: "Private action scope could not be confirmed.",
          errorCode: "private_action_scope_mismatch",
        });
        expect(request.bodyUsed).toBe(false);
        expect(run).not.toHaveBeenCalled();
      }
    },
  );
  it.each(["uiOnly", "agentTool", "mcpTool", "toolCallable"] as const)(
    "refuses unsafe action metadata %s before consuming inputs",
    async (flag) => {
      browserSession.mockResolvedValue({
        email: "actor@example.test",
        userId: "auth-test",
        authUserId: "auth-test",
      });
      const app = createApp();
      const run = vi.fn(async () => ({ saved: true }));
      const entry = {
        run,
        uiOnly: true,
        persistInChatHistory: false,
        agentTool: false,
        mcpTool: false,
        toolCallable: false,
        [flag]: flag === "uiOnly" ? false : true,
      } as ActionEntry;
      mountActionRoutes(
        app,
        { "private-save": entry },
        {
          getOwnerFromEvent: async () => "actor@example.test",
          getAuthUserIdFromEvent: async () => "auth-test",
          resolveOrgId: async () => "org-test",
        },
      );
      const request = new Request(
        "https://example.test/_agent-native/actions/private-save",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            "x-agent-native-frontend": "1",
            [PRIVATE_ACTION_SCOPE_HEADER]: JSON.stringify({
              email: "actor@example.test",
              orgId: "org-test",
              authUserId: "auth-test",
            }),
          },
          body: JSON.stringify({ secret: "test-private-body" }),
        },
      );
      const response = await app.fetch(request);
      expect(response.status).toBe(409);
      expect(request.bodyUsed).toBe(false);
      expect(run).not.toHaveBeenCalled();
    },
  );
});
