import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: mocks.assertAccess,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import {
  ForbiddenError,
  roleSatisfies,
  type ShareRole,
} from "@agent-native/core/sharing";

import { CHATGPT_DIRECTORY_PROFILE } from "./chatgpt-directory-tools.js";

describe("Slides ChatGPT directory widget write authorization", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.getRequestOrgId.mockReset();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserEmail.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("reviewer@example.com");
  });

  it("requires editor access to the deck for the authenticated MCP user", async () => {
    const allowed = await CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite!({
      toolName: "create-deck",
      args: {},
      result: {},
      target: {
        targetPath: "/deck/deck-1",
        resourceIds: { deckId: "deck-1" },
      },
      identity: {
        userEmail: "reviewer@example.com",
        orgId: "org-1",
      },
    });

    expect(allowed).toBe(true);
    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
  });

  it("denies an identity that differs from the active request context", async () => {
    const allowed = await CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite!({
      toolName: "create-deck",
      args: {},
      result: {},
      target: {
        targetPath: "/deck/deck-1",
        resourceIds: { deckId: "deck-1" },
      },
      identity: {
        userEmail: "attacker@example.com",
        orgId: "org-1",
      },
    });

    expect(allowed).toBe(false);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("denies a caller without editor access to the deck", async () => {
    mocks.assertAccess.mockRejectedValue(new ForbiddenError("viewer role"));

    const allowed = await CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite!({
      toolName: "create-deck",
      args: {},
      result: {},
      target: {
        targetPath: "/deck/deck-1",
        resourceIds: { deckId: "deck-1" },
      },
      identity: { userEmail: "reviewer@example.com", orgId: "org-1" },
    });

    expect(allowed).toBe(false);
  });

  it("does not hide editor access lookup failures", async () => {
    const failure = new Error("access store unavailable");
    mocks.assertAccess.mockRejectedValue(failure);

    await expect(
      CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite!({
        toolName: "create-deck",
        args: {},
        result: {},
        target: {
          targetPath: "/deck/deck-1",
          resourceIds: { deckId: "deck-1" },
        },
        identity: { userEmail: "reviewer@example.com", orgId: "org-1" },
      }),
    ).rejects.toBe(failure);
  });
});

describe("Slides ChatGPT directory widget share grant", () => {
  const writeActions = [
    "patch-deck",
    "share-resource",
    "unshare-resource",
    "set-resource-visibility",
  ];
  const target = (deckId: string) => ({
    targetPath: `/deck/${deckId}`,
    resourceIds: { deckId, resourceType: "deck" },
    writeActions,
  });

  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.getRequestOrgId.mockReset();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserEmail.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("reviewer@example.com");
  });

  // oracle-change: Create/add widget targets were removed for full-app links; Core directory-template-profiles.spec.ts covers the link fallback.
  it("limits the Share popover grant to its four actions and their arguments", () => {
    const {
      widgetReadActionArguments,
      widgetReadAuthenticatedActions,
      widgetReadOnlyActions,
      widgetWriteActionArguments,
    } = CHATGPT_DIRECTORY_PROFILE;
    const schema = { type: "actionSchema" };
    const resource = { resourceType: "resourceType", resourceId: "deckId" };

    expect(widgetReadActionArguments["list-resource-shares"]).toEqual(resource);
    expect(Object.keys(widgetReadActionArguments).sort()).toEqual([
      "get-deck",
      "list-resource-shares",
    ]);
    expect(widgetReadAuthenticatedActions).toEqual(["list-resource-shares"]);
    expect(widgetReadOnlyActions).toEqual(["get-deck"]);

    expect(widgetWriteActionArguments["share-resource"]).toEqual({
      ...resource,
      principalType: schema,
      principalId: schema,
      role: schema,
      notify: schema,
      resourceUrl: schema,
      message: schema,
    });
    expect(widgetWriteActionArguments["unshare-resource"]).toEqual({
      ...resource,
      principalType: schema,
      principalId: schema,
    });
    expect(widgetWriteActionArguments["set-resource-visibility"]).toEqual({
      ...resource,
      visibility: schema,
    });
    expect(Object.keys(widgetWriteActionArguments).sort()).toEqual(
      [...writeActions].sort(),
    );
  });

  it("keeps patch-deck's argument rules unchanged", () => {
    expect(
      CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments["patch-deck"],
    ).toEqual({
      deckId: "deckId",
      operations: { type: "actionSchema" },
      clientWrite: { type: "actionSchema" },
    });
  });

  it("resolves stored widget rules against a bounded deck fixture", () => {
    const { widgetWriteActionArguments } = CHATGPT_DIRECTORY_PROFILE;
    const widgetTarget = target("deck-a");
    const rules = [
      ...Object.values(CHATGPT_DIRECTORY_PROFILE.widgetReadActionArguments),
      ...Object.values(widgetWriteActionArguments),
    ].flatMap((argumentMap) => Object.values(argumentMap));

    for (const rule of rules) {
      if (typeof rule === "string") {
        expect(widgetTarget.resourceIds).toHaveProperty(rule);
      }
    }
    for (const action of widgetTarget.writeActions) {
      expect(widgetWriteActionArguments).toHaveProperty(action);
    }
  });

  it("does not grant access requests, groups, agent links, or deck deletion", () => {
    const granted = new Set([
      ...Object.keys(CHATGPT_DIRECTORY_PROFILE.widgetReadActionArguments),
      ...Object.keys(CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments),
    ]);

    for (const action of [
      "approve-resource-access-request",
      "decline-resource-access-request",
      "request-resource-access",
      "list-resource-access-requests",
      "get-resource-access-request",
      "get-resource-access-status",
      "create-agent-resource-link",
      "list-workspace-user-groups",
      "delete-deck",
      "duplicate-deck",
    ]) {
      expect(granted.has(action), action).toBe(false);
    }
  });

  it.each<[ShareRole | "owner", boolean]>([
    ["viewer", false],
    ["commenter", false],
    ["editor", true],
    ["admin", true],
    ["owner", true],
  ])(
    "issues the write grant to a %s only when they can edit: %s",
    async (role, expected) => {
      mocks.assertAccess.mockImplementation(
        async (_type: string, _id: string, minimum: ShareRole | "owner") => {
          if (!roleSatisfies(role, minimum)) {
            throw new ForbiddenError(`${role} role`);
          }
          return { role };
        },
      );

      await expect(
        CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite!({
          toolName: "create-deck",
          args: {},
          result: {},
          target: target("deck-a"),
          identity: { userEmail: "reviewer@example.com", orgId: "org-1" },
        }),
      ).resolves.toBe(expected);
      expect(mocks.assertAccess).toHaveBeenCalledWith(
        "deck",
        "deck-a",
        "editor",
      );
    },
  );
});
