import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  userEmail: "owner@example.com" as string | undefined,
}));
const invokeAgentAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/a2a", () => ({
  invokeAgentAction,
  resolveA2ACallerAuth: async () => ({
    userEmail: auth.userEmail,
    orgDomain: "example.com",
    orgSecret: "org-secret",
  }),
}));

const pageFile = {
  id: "plan-page",
  title: "Q3 plan",
  kind: "page",
  format: "markdown",
  filename: "Q3 plan.md",
  mimeType: "text/markdown;charset=utf-8",
  encoding: "utf8",
  content: "# Q3 plan\n",
  size: 10,
};

function completed(output: unknown) {
  return {
    target: { url: "https://content.example.com" },
    result: { status: "completed", output: JSON.stringify(output) },
  };
}

describe("Content page files", () => {
  beforeEach(() => {
    auth.userEmail = "owner@example.com";
    invokeAgentAction.mockReset();
  });

  it("lists pages through Content's read-document-file as the signed-in person", async () => {
    invokeAgentAction.mockResolvedValue(
      completed({
        items: [
          {
            id: "plan-page",
            title: "Q3 plan",
            kind: "page",
            format: "markdown",
            updatedAt: "2026-11-19T12:00:00.000Z",
          },
        ],
        hasMore: false,
      }),
    );
    const { listContentPages } = await import("./content-page-files.js");

    await expect(
      listContentPages({ search: "plan", page: 2 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: "plan-page", kind: "page" })],
      hasMore: false,
    });
    expect(invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "content",
        selfAppId: "mail",
        action: "read-document-file",
        input: { operation: "list", page: 2, search: "plan" },
        userEmail: "owner@example.com",
        orgDomain: "example.com",
        orgSecret: "org-secret",
      }),
    );
  });

  it("reads a page as a file", async () => {
    invokeAgentAction.mockResolvedValue(completed(pageFile));
    const { readContentPageFile } = await import("./content-page-files.js");

    await expect(readContentPageFile({ id: "plan-page" })).resolves.toEqual(
      expect.objectContaining({ content: "# Q3 plan\n", format: "markdown" }),
    );
    expect(invokeAgentAction.mock.calls[0]?.[0].input).toEqual({
      operation: "read",
      page: 1,
      id: "plan-page",
    });
  });

  it("refuses a file for another page or in another format", async () => {
    const { readContentPageFile } = await import("./content-page-files.js");

    invokeAgentAction.mockResolvedValue(
      completed({ ...pageFile, id: "other-page" }),
    );
    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({ errorCode: "content_invalid_response" });

    invokeAgentAction.mockResolvedValue(completed(pageFile));
    await expect(
      readContentPageFile({ id: "plan-page", format: "csv" }),
    ).rejects.toMatchObject({ errorCode: "content_invalid_response" });
  });

  it("says why Content refused, in Mail's words", async () => {
    invokeAgentAction.mockResolvedValue({
      target: { url: "https://content.example.com" },
      result: {
        status: "failed",
        output:
          "Error running read-document-file: This page is too large to attach from another app (over 2 MB). (errorCode: document_file_too_large)",
      },
    });
    const { readContentPageFile } = await import("./content-page-files.js");

    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "document_file_too_large",
      message: expect.stringContaining("too large to attach"),
    });
  });

  it("names an unknown refusal and an unreachable Content plainly", async () => {
    const { readContentPageFile } = await import("./content-page-files.js");

    invokeAgentAction.mockResolvedValue({
      target: { url: "https://content.example.com" },
      result: { status: "failed", output: "Error running it: boom" },
    });
    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "content_page_unavailable",
    });

    invokeAgentAction.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "content_unavailable",
    });
  });

  it("requires a signed-in caller", async () => {
    auth.userEmail = undefined;
    const { listContentPages } = await import("./content-page-files.js");

    await expect(listContentPages({ page: 1 })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(invokeAgentAction).not.toHaveBeenCalled();
  });

  it("names the attachment for the page, with its format's extension", async () => {
    const { attachmentNameForFile } = await import("./content-page-files.js");
    const file = {
      ...pageFile,
      kind: "page" as const,
      format: "markdown" as const,
      encoding: "utf8" as const,
    };

    expect(attachmentNameForFile(file)).toBe("Q3 plan.md");
    expect(
      attachmentNameForFile({
        ...file,
        filename: "Tracker.csv",
        format: "csv",
      }),
    ).toBe("Tracker.csv");
    expect(attachmentNameForFile({ ...file, filename: "a/b\r\nc.exe" })).toBe(
      "a b c.exe.md",
    );
  });
});
