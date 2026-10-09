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

import { ForbiddenError } from "@agent-native/core/sharing";

import { CHATGPT_DIRECTORY_PROFILE } from "./chatgpt-directory-tools.js";

describe("Content ChatGPT directory widget write authorization", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.getRequestOrgId.mockReset();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserEmail.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("reviewer@example.com");
  });

  it("requires editor access to the document for the authenticated MCP user", async () => {
    const allowed = await CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite!({
      toolName: "create-document",
      args: {},
      result: {},
      target: {
        targetPath: "/page/document-1",
        resourceIds: { documentId: "document-1" },
      },
      identity: {
        userEmail: "reviewer@example.com",
        orgId: "org-1",
      },
    });

    expect(allowed).toBe(true);
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "document",
      "document-1",
      "editor",
    );
  });

  it("denies an identity that differs from the active request context", async () => {
    const allowed = await CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite!({
      toolName: "create-document",
      args: {},
      result: {},
      target: {
        targetPath: "/page/document-1",
        resourceIds: { documentId: "document-1" },
      },
      identity: {
        userEmail: "attacker@example.com",
        orgId: "org-1",
      },
    });

    expect(allowed).toBe(false);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("denies a caller without editor access to the document", async () => {
    mocks.assertAccess.mockRejectedValue(new ForbiddenError("viewer role"));

    const allowed = await CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite!({
      toolName: "create-document",
      args: {},
      result: {},
      target: {
        targetPath: "/page/document-1",
        resourceIds: { documentId: "document-1" },
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
        toolName: "create-document",
        args: {},
        result: {},
        target: {
          targetPath: "/page/document-1",
          resourceIds: { documentId: "document-1" },
        },
        identity: { userEmail: "reviewer@example.com", orgId: "org-1" },
      }),
    ).rejects.toBe(failure);
  });
});

describe("Content ChatGPT directory widget share allowlist", () => {
  const SHARE_ACTIONS = [
    "share-resource",
    "unshare-resource",
    "set-resource-visibility",
  ] as const;
  const documentTarget = () =>
    CHATGPT_DIRECTORY_PROFILE.widgetTargets["create-document"](
      {},
      { id: "document-1", spaceId: "space-1" },
    );

  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.getRequestOrgId.mockReset();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserEmail.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("reviewer@example.com");
  });

  it("lets the document widget share but never the database widget", () => {
    expect(documentTarget()).toMatchObject({
      targetPath: "/page/document-1",
      resourceIds: {
        documentId: "document-1",
        resourceType: "document",
        spaceId: "space-1",
      },
    });
    expect([...(documentTarget()?.writeActions ?? [])].sort()).toEqual(
      ["update-document", ...SHARE_ACTIONS].sort(),
    );
    expect(
      CHATGPT_DIRECTORY_PROFILE.widgetTargets["create-content-database"](
        {},
        {
          database: {
            id: "database-1",
            documentId: "database-document-1",
            spaceId: "space-1",
          },
        },
      )?.writeActions,
    ).toEqual(["add-database-item", "update-database-item"]);
  });

  it("declares no write action that no widget target can grant", () => {
    const granted = new Set([
      ...(documentTarget()?.writeActions ?? []),
      "add-database-item",
      "update-database-item",
    ]);
    expect(
      Object.keys(CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments).sort(),
    ).toEqual([...granted].sort());
  });

  it.each(SHARE_ACTIONS)(
    "binds %s to the ticketed document with literal resource keys",
    (name) => {
      const rules = CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments[
        name
      ] as Record<string, unknown>;
      expect(rules.resourceType).toBe("resourceType");
      expect(rules.resourceId).toBe("documentId");
      const documentResourceIds: Record<string, string> =
        documentTarget()?.resourceIds ?? {};
      expect(documentResourceIds[rules.resourceType as string]).toBe(
        "document",
      );
      expect(documentResourceIds[rules.resourceId as string]).toBe(
        "document-1",
      );
      for (const [argument, rule] of Object.entries(rules)) {
        if (argument === "resourceType" || argument === "resourceId") continue;
        expect(rule, `${name}.${argument}`).toEqual({ type: "actionSchema" });
      }
    },
  );

  it("keeps each share mutation to its own action arguments", () => {
    const args = CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments;
    expect(Object.keys(args["share-resource"]).sort()).toEqual([
      "message",
      "notify",
      "principalId",
      "principalType",
      "resourceId",
      "resourceType",
      "resourceUrl",
      "role",
    ]);
    expect(Object.keys(args["unshare-resource"]).sort()).toEqual([
      "principalId",
      "principalType",
      "resourceId",
      "resourceType",
    ]);
    expect(Object.keys(args["set-resource-visibility"]).sort()).toEqual([
      "resourceId",
      "resourceType",
      "visibility",
    ]);
  });

  it("reads the share list through a scoped authenticated read only", () => {
    expect(
      CHATGPT_DIRECTORY_PROFILE.widgetReadActionArguments[
        "list-resource-shares"
      ],
    ).toEqual({ resourceType: "resourceType", resourceId: "documentId" });
    expect(CHATGPT_DIRECTORY_PROFILE.widgetReadAuthenticatedActions).toContain(
      "list-resource-shares",
    );
    expect(CHATGPT_DIRECTORY_PROFILE.widgetReadPrivateActions).not.toContain(
      "list-resource-shares",
    );
    expect(CHATGPT_DIRECTORY_PROFILE.connectorCatalog).not.toContain(
      "list-resource-shares",
    );
  });

  it("never exposes sharing to the model or to the widget beyond the popover", () => {
    const exposed = [
      ...CHATGPT_DIRECTORY_PROFILE.connectorCatalog,
      ...Object.keys(CHATGPT_DIRECTORY_PROFILE.widgetReadActionArguments),
      ...Object.keys(CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments),
    ];
    for (const name of [
      "set-document-discoverability",
      "delete-document",
      "list-resource-access-requests",
      "approve-resource-access-request",
      "decline-resource-access-request",
      "create-agent-resource-link",
      "request-resource-access",
    ]) {
      expect(exposed, name).not.toContain(name);
    }
    for (const name of SHARE_ACTIONS) {
      expect(CHATGPT_DIRECTORY_PROFILE.connectorCatalog).not.toContain(name);
    }
  });

  it("denies the write capability to a viewer or commenter", async () => {
    mocks.assertAccess.mockRejectedValue(new ForbiddenError("viewer role"));
    const target = documentTarget()!;

    await expect(
      CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite({
        toolName: "create-document",
        args: {},
        result: {},
        target,
        identity: { userEmail: "reviewer@example.com", orgId: "org-1" },
      }),
    ).resolves.toBe(false);
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "document",
      "document-1",
      "editor",
    );
  });
});
