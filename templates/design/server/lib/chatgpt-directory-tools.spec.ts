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

beforeEach(() => {
  mocks.assertAccess.mockReset();
  mocks.getRequestOrgId.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.getRequestOrgId.mockReturnValue("org-1");
  mocks.getRequestUserEmail.mockReturnValue("reviewer@example.test");
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
});

describe("Design ChatGPT directory widget targets", () => {
  it("opens generated output focused on its first renderable screen", () => {
    const target = CHATGPT_DIRECTORY_PROFILE.widgetTargets["generate-design"](
      { designId: "design-1" },
      {
        designId: "design-1",
        urlPath: "/design/design-1?editorView=overview&screen=screen%2Fdesktop",
      },
    );

    expect(target).toMatchObject({
      targetPath:
        "/design/design-1?editorView=overview&screen=screen%2Fdesktop",
      resourceIds: { designId: "design-1", designResourceType: "design" },
    });
    expect(target?.writeActions).toHaveLength(6);
    expect(target?.writeActions).toEqual(
      expect.arrayContaining([
        "create-file",
        "update-design",
        "update-file",
        "share-resource",
        "unshare-resource",
        "set-resource-visibility",
      ]),
    );
  });

  it("scopes the Share dialog reads and writes to the widget design", () => {
    expect(CHATGPT_DIRECTORY_PROFILE.widgetReadActionArguments).toMatchObject({
      "list-resource-shares": {
        resourceType: "designResourceType",
        resourceId: "designId",
      },
    });
    expect(CHATGPT_DIRECTORY_PROFILE.widgetReadOnlyActions).toContain(
      "list-resource-shares",
    );
    expect(CHATGPT_DIRECTORY_PROFILE.widgetReadAuthenticatedActions).toContain(
      "list-resource-shares",
    );
    expect(CHATGPT_DIRECTORY_PROFILE.connectorCatalog).not.toContain(
      "list-resource-shares",
    );
    expect(
      CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments[
        "share-resource"
      ],
    ).toMatchObject({
      resourceType: "designResourceType",
      resourceId: "designId",
    });
    expect(
      CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments[
        "unshare-resource"
      ],
    ).toMatchObject({
      resourceType: "designResourceType",
      resourceId: "designId",
    });
    expect(
      CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments[
        "set-resource-visibility"
      ],
    ).toMatchObject({
      resourceType: "designResourceType",
      resourceId: "designId",
    });
  });

  it.each([
    "create-design",
    "create-design-from-template",
    "generate-design",
    "present-design-variants",
  ] as const)("grants the app-chrome actions for %s widgets", (toolName) => {
    const target = CHATGPT_DIRECTORY_PROFILE.widgetTargets[toolName](
      { designId: "design-1" },
      { id: "design-1", designId: "design-1" },
    );
    expect(target?.resourceIds).toEqual({
      designId: "design-1",
      designResourceType: "design",
    });
    expect(target?.writeActions).toEqual([
      "update-design",
      "update-file",
      "create-file",
      "share-resource",
      "unshare-resource",
      "set-resource-visibility",
    ]);
  });

  it("falls back to the design canvas when no generated screen is in the result", () => {
    const target = CHATGPT_DIRECTORY_PROFILE.widgetTargets["generate-design"](
      { designId: "design-1" },
      { designId: "design-1", urlPath: "/design/design-1" },
    );

    expect(target).toMatchObject({
      targetPath: "/design/design-1",
      resourceIds: { designId: "design-1" },
    });
  });

  it("does not focus a screen from a different design route", () => {
    const target = CHATGPT_DIRECTORY_PROFILE.widgetTargets["generate-design"](
      { designId: "design-1" },
      {
        designId: "design-1",
        urlPath: "/design/other-design?editorView=overview&screen=screen-2",
      },
    );

    expect(target).toMatchObject({ targetPath: "/design/design-1" });
  });

  it("authorizes write grants only for the current user with editor access", async () => {
    const target = {
      targetPath: "/design/design-1",
      resourceIds: { designId: "design-1" },
      writeActions: ["update-design"],
    };
    const identity = {
      userEmail: "reviewer@example.test",
      orgId: "org-1",
    };

    await expect(
      CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite?.({
        toolName: "create-design",
        args: {},
        result: {},
        target,
        identity,
      }),
    ).resolves.toBe(true);
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-1",
      "editor",
    );

    mocks.getRequestUserEmail.mockReturnValue("someone-else@example.test");
    await expect(
      CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite?.({
        toolName: "create-design",
        args: {},
        result: {},
        target,
        identity,
      }),
    ).resolves.toBe(false);
    expect(mocks.assertAccess).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the current organization differs from the grant identity", async () => {
    mocks.getRequestOrgId.mockReturnValue("org-2");

    await expect(
      CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite?.({
        toolName: "create-design",
        args: {},
        result: {},
        target: {
          targetPath: "/design/design-1",
          resourceIds: { designId: "design-1" },
        },
        identity: {
          userEmail: "reviewer@example.test",
          orgId: "org-1",
        },
      }),
    ).resolves.toBe(false);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("fails closed when the target is missing or editor access is denied", async () => {
    const identity = {
      userEmail: "reviewer@example.test",
      orgId: "org-1",
    };
    await expect(
      CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite?.({
        toolName: "create-design",
        args: {},
        result: {},
        target: { targetPath: "/design", resourceIds: {} },
        identity,
      }),
    ).resolves.toBe(false);

    mocks.assertAccess.mockRejectedValue(new ForbiddenError("viewer role"));
    await expect(
      CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite?.({
        toolName: "create-design",
        args: {},
        result: {},
        target: {
          targetPath: "/design/design-1",
          resourceIds: { designId: "design-1" },
        },
        identity,
      }),
    ).resolves.toBe(false);
  });

  it("does not hide editor access lookup failures", async () => {
    const failure = new Error("access store unavailable");
    mocks.assertAccess.mockRejectedValue(failure);

    await expect(
      CHATGPT_DIRECTORY_PROFILE.authorizeWidgetWrite?.({
        toolName: "create-design",
        args: {},
        result: {},
        target: {
          targetPath: "/design/design-1",
          resourceIds: { designId: "design-1" },
        },
        identity: { userEmail: "reviewer@example.test", orgId: "org-1" },
      }),
    ).rejects.toBe(failure);
  });
});
