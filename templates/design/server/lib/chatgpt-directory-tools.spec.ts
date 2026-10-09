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
      resourceIds: { designId: "design-1" },
    });
    expect(target?.writeActions).toHaveLength(3);
    expect(target?.writeActions).toEqual(
      expect.arrayContaining(["create-file", "update-design", "update-file"]),
    );
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
