import { resetAppConfigForTests } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  userEmail: "owner@example.com" as string | undefined,
}));
const discovery = vi.hoisted(() => ({
  contentUrl: "https://content.agent-native.com",
}));
const invokeAgentAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  getBuiltinAgents: () => [{ id: "content", url: discovery.contentUrl }],
}));

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
    discovery.contentUrl = "https://content.agent-native.com";
    invokeAgentAction.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  it("asks beta Content when Mail is served from beta", async () => {
    vi.stubEnv("APP_URL", "https://beta.mail.agent-native.com");
    resetAppConfigForTests();
    invokeAgentAction.mockResolvedValue(completed(pageFile));
    const { readContentPageFile } = await import("./content-page-files.js");

    await readContentPageFile({ id: "plan-page" });

    expect(invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "https://beta.content.agent-native.com",
        userEmail: "owner@example.com",
        orgDomain: "example.com",
        orgSecret: "org-secret",
      }),
    );
  });

  it("asks for Content by name on production, locally and on other hosts", async () => {
    invokeAgentAction.mockResolvedValue(completed(pageFile));
    const { readContentPageFile } = await import("./content-page-files.js");

    for (const lane of [
      {
        mail: "https://mail.agent-native.com",
        content: "https://content.agent-native.com",
      },
      { mail: "http://localhost:8085", content: "http://localhost:8083" },
      {
        mail: "https://mail.example.com",
        content: "https://content.agent-native.com",
      },
    ]) {
      vi.stubEnv("APP_URL", lane.mail);
      resetAppConfigForTests();
      discovery.contentUrl = lane.content;
      await readContentPageFile({ id: "plan-page" });
      expect(invokeAgentAction.mock.lastCall?.[0].target).toBe("content");
    }
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

  it("reads a page as a PDF and decodes its bytes", async () => {
    const pdf = Buffer.from("%PDF-1.3\n%\xff\xfe\n", "latin1");
    invokeAgentAction.mockResolvedValue(
      completed({
        ...pageFile,
        format: "pdf",
        filename: "Q3 plan.pdf",
        encoding: "base64",
        content: pdf.toString("base64"),
        size: pdf.byteLength,
      }),
    );
    const { readContentPageFile } = await import("./content-page-files.js");

    const file = await readContentPageFile({ id: "plan-page", format: "pdf" });

    expect(file.format).toBe("pdf");
    expect(file.data.equals(pdf)).toBe(true);
    expect(invokeAgentAction.mock.calls[0]?.[0].input).toMatchObject({
      format: "pdf",
    });
  });

  it("refuses a PDF that isn't base64, isn't a PDF, or is cut short", async () => {
    const { readContentPageFile } = await import("./content-page-files.js");
    const pdf = Buffer.from("%PDF-1.3\n", "latin1");
    const pdfFile = {
      ...pageFile,
      format: "pdf",
      filename: "Q3 plan.pdf",
      encoding: "base64",
      content: pdf.toString("base64"),
      size: pdf.byteLength,
    };

    invokeAgentAction.mockResolvedValue(
      completed({ ...pdfFile, encoding: "utf8" }),
    );
    await expect(
      readContentPageFile({ id: "plan-page", format: "pdf" }),
    ).rejects.toMatchObject({ errorCode: "content_invalid_response" });

    for (const content of [
      Buffer.from("not a pdf!").toString("base64"),
      "%%%%",
      pdfFile.content.slice(0, -4),
    ]) {
      invokeAgentAction.mockResolvedValue(completed({ ...pdfFile, content }));
      await expect(
        readContentPageFile({ id: "plan-page", format: "pdf" }),
      ).rejects.toMatchObject({ errorCode: "content_file_incomplete" });
    }

    invokeAgentAction.mockResolvedValue(
      completed({ ...pdfFile, content: "JVBERi1=", size: 5 }),
    );
    await expect(
      readContentPageFile({ id: "plan-page", format: "pdf" }),
    ).rejects.toMatchObject({ errorCode: "content_file_incomplete" });
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

    invokeAgentAction.mockResolvedValue(
      completed({ ...pageFile, format: "csv" }),
    );
    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({ errorCode: "content_invalid_response" });

    invokeAgentAction.mockResolvedValue(
      completed({ ...pageFile, kind: "collection" }),
    );
    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({ errorCode: "content_invalid_response" });
  });

  it("refuses a file that arrived altered or over the size limit", async () => {
    const { readContentPageFile } = await import("./content-page-files.js");

    invokeAgentAction.mockResolvedValue(
      completed({ ...pageFile, content: "# Q3 plan\n[image omitted]\n" }),
    );
    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "content_file_incomplete",
    });

    const content = "a".repeat(2 * 1024 * 1024 + 1);
    invokeAgentAction.mockResolvedValue(
      completed({ ...pageFile, content, size: content.length }),
    );
    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "document_file_too_large",
    });
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

    invokeAgentAction.mockResolvedValue({
      target: { url: "https://content.example.com" },
      result: {
        status: "failed",
        output:
          "Error running read-document-file: Collection export supports up to 5000 authorized records. (errorCode: collection_export_limit_exceeded)",
      },
    });
    await expect(
      readContentPageFile({ id: "plan-page" }),
    ).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "collection_export_limit_exceeded",
      message: expect.stringContaining("too many rows"),
    });

    invokeAgentAction.mockResolvedValue({
      target: { url: "https://content.example.com" },
      result: {
        status: "failed",
        output:
          "Error running read-document-file: This page has text a PDF can't show yet. (errorCode: document_file_pdf_text_unsupported)",
      },
    });
    await expect(
      readContentPageFile({ id: "plan-page", format: "pdf" }),
    ).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "document_file_pdf_text_unsupported",
      message: expect.stringContaining("Attach it as Markdown"),
    });

    invokeAgentAction.mockResolvedValue({
      target: { url: "https://content.example.com" },
      result: {
        status: "failed",
        output:
          "Error running read-document-file: This page can't be attached as a PDF because it has over 200 pages. Attach it as Markdown instead. (errorCode: document_file_pdf_too_long)",
      },
    });
    await expect(
      readContentPageFile({ id: "plan-page", format: "pdf" }),
    ).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "document_file_pdf_too_long",
      message: expect.stringContaining("too long or too wide"),
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

    invokeAgentAction.mockResolvedValue({
      target: { url: "https://content.example.com" },
      result: {
        status: "failed",
        output:
          "Error running read-document-file: Invalid action parameters — format: Invalid enum value. Expected 'markdown' | 'csv', received 'pdf'.",
      },
    });
    await expect(
      readContentPageFile({ id: "plan-page", format: "pdf" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "content_page_pdf_unavailable",
      message: expect.stringContaining("Attach it as Markdown"),
    });

    invokeAgentAction.mockResolvedValue({
      target: { url: "https://content.example.com" },
      result: {
        status: "failed",
        output:
          "Error running read-document-file: Content couldn't make a PDF of this page. Attach it as Markdown instead. (errorCode: document_file_pdf_failed)",
      },
    });
    await expect(
      readContentPageFile({ id: "plan-page", format: "pdf" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "content_page_pdf_unavailable",
      message: expect.stringContaining("Attach it as Markdown"),
    });

    invokeAgentAction.mockResolvedValue({
      target: { url: "https://content.example.com" },
      result: { status: "failed", output: "Error running it: boom" },
    });
    await expect(
      readContentPageFile({ id: "plan-page", format: "pdf" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "content_page_unavailable",
      message: expect.stringContaining("Check your access"),
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
    expect(
      attachmentNameForFile({ filename: "Poems.pdf", format: "pdf" }),
    ).toBe("Poems.pdf");
    expect(attachmentNameForFile({ ...file, filename: "a/b\r\nc.exe" })).toBe(
      "a b c.exe.md",
    );
  });
});
