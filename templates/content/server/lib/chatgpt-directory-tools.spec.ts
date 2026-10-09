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
