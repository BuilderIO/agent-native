// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { preparePromptComposerAgentHandoff } from "./prepare-prompt-composer-agent-handoff.js";

describe("prompt composer agent handoff", () => {
  it("preserves raw file bytes once and durable attachment URLs", async () => {
    const file = new File(["review content"], "review.txt", {
      type: "text/plain",
    });
    const result = await preparePromptComposerAgentHandoff(
      [file],
      {
        attachments: [
          { file, name: file.name },
          {
            name: "saved.pdf",
            content: [
              {
                type: "file",
                url: "https://example.test/saved.pdf",
                mimeType: "application/pdf",
              },
            ],
          },
        ],
      },
      "Localized upload failure",
    );
    expect(result.attachments).toEqual([
      {
        type: "file",
        name: "saved.pdf",
        url: "https://example.test/saved.pdf",
        contentType: "application/pdf",
      },
      {
        type: "file",
        name: "review.txt",
        contentType: "text/plain",
        data: "data:text/plain;base64,cmV2aWV3IGNvbnRlbnQ=",
      },
    ]);
  });
  it("preserves orphan files and prefers uploaded content over retained raw files", async () => {
    const file = new File(["context"], "context.txt", { type: "text/plain" });
    const orphan = await preparePromptComposerAgentHandoff(
      [],
      { attachments: [{ file, name: file.name }] },
      "Upload failed",
    );
    expect(orphan.attachments?.[0]).toMatchObject({
      name: "context.txt",
      data: "data:text/plain;base64,Y29udGV4dA==",
    });
    const uploaded = await preparePromptComposerAgentHandoff(
      [file],
      {
        attachments: [
          {
            file,
            name: file.name,
            content: [
              { type: "file", url: "https://example.test/context.txt" },
            ],
          },
        ],
      },
      "Upload failed",
    );
    expect(uploaded.attachments).toEqual([
      {
        type: "file",
        name: "context.txt",
        url: "https://example.test/context.txt",
        contentType: undefined,
      },
    ]);
  });
  it("rejects unreadable descriptors rather than submitting without selected context", async () => {
    await expect(
      preparePromptComposerAgentHandoff(
        [],
        {
          attachments: [
            {
              name: "missing",
              content: [{ type: "file", url: "blob:unavailable" }],
            },
          ],
        },
        "Localized upload failure",
      ),
    ).rejects.toThrow("Localized upload failure");
  });
});
