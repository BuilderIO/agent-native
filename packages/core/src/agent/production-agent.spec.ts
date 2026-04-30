import { describe, expect, it } from "vitest";
import { buildUserContentWithAttachments } from "./production-agent.js";

describe("buildUserContentWithAttachments", () => {
  it("preserves the prompt text when there are no attachments", () => {
    expect(buildUserContentWithAttachments({ text: "Hello" })).toEqual([
      { type: "text", text: "Hello" },
    ]);
  });

  it("adds supported image attachments before the prompt text", () => {
    expect(
      buildUserContentWithAttachments({
        text: "Describe this",
        attachments: [
          {
            type: "image",
            name: "screen.png",
            contentType: "image/png",
            data: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      }),
    ).toEqual([
      { type: "image", mediaType: "image/png", data: "aW1hZ2U=" },
      { type: "text", text: "Describe this" },
    ]);
  });

  it("includes text and file attachments in the text sent to the engine", () => {
    const content = buildUserContentWithAttachments({
      text: "Summarize the attachment",
      attachments: [
        {
          type: "file",
          name: 'notes "qa".txt',
          contentType: "text/plain",
          text: "Line one\nLine two",
        },
        {
          type: "file",
          name: "empty.txt",
          contentType: "text/plain",
          text: "",
        },
      ],
    });

    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[0].type === "text" ? content[0].text : "").toBe(
      '<attachment name="notes &quot;qa&quot;.txt" contentType="text/plain" type="file">\n' +
        "Line one\nLine two\n" +
        "</attachment>\n\n" +
        "Summarize the attachment",
    );
  });

  it("skips unsupported image media types instead of sending invalid engine content", () => {
    expect(
      buildUserContentWithAttachments({
        text: "Can you read this SVG?",
        attachments: [
          {
            type: "image",
            name: "icon.svg",
            contentType: "image/svg+xml",
            data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
          },
        ],
      }),
    ).toEqual([{ type: "text", text: "Can you read this SVG?" }]);
  });
});
