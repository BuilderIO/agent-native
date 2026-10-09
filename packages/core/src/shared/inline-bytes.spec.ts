import { describe, expect, it } from "vitest";

import {
  assertNoInlineImageBytes,
  DurableAttachmentReferenceRequiredError,
  stripInlineBytes,
  stripInlineBytesFromJson,
} from "./inline-bytes.js";

const PIXELS = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const DURABLE = "https://cdn.builder.io/api/v1/image/assets%2Fspace%2Fshot";

describe("stripInlineBytes", () => {
  it("swaps inline bytes for the durable URL the part already carries", () => {
    const stored = stripInlineBytes(
      {
        attachments: [
          { type: "image", name: "a.png", data: PIXELS, url: DURABLE },
        ],
        content: [{ type: "image", image: PIXELS, url: DURABLE }],
      },
      "reject",
    );

    expect(stored).toEqual({
      attachments: [{ type: "image", name: "a.png", url: DURABLE }],
      content: [{ type: "image", image: DURABLE, url: DURABLE }],
    });
  });

  it("uses the attachment's upload URL for its nested content parts", () => {
    const stored = stripInlineBytes(
      {
        type: "image",
        name: "shot.png",
        content: [{ type: "image", image: PIXELS }],
        metadata: { uploadUrl: DURABLE },
      },
      "placeholder",
    );

    expect(stored.content).toEqual([{ type: "image", image: DURABLE }]);
  });

  it("drops bytes beside a durable file id without a placeholder", () => {
    expect(
      stripInlineBytes(
        { type: "file", name: "a.png", url: PIXELS, fileId: "file_1" },
        "reject",
      ),
    ).toEqual({ type: "file", name: "a.png", fileId: "file_1" });
  });

  it("rejects bytes with no durable URL under the reject policy", () => {
    expect(() =>
      stripInlineBytes(
        { attachments: [{ type: "file", name: "a.pdf", data: "JVBERi0=" }] },
        "reject",
      ),
    ).toThrow(DurableAttachmentReferenceRequiredError);
  });

  it("leaves a visible placeholder under the placeholder policy", () => {
    const stored = stripInlineBytes(
      {
        images: [{ data: "aW1hZ2U=", mediaType: "image/jpeg", label: "shot" }],
        parts: [{ type: "image", image: PIXELS }],
      },
      "placeholder",
    );

    expect(stored).toEqual({
      images: [
        {
          mediaType: "image/jpeg",
          label: "shot",
          type: "file",
          name: "shot",
          omitted: "inline-bytes",
        },
      ],
      parts: [
        { type: "file", mediaType: "image/png", omitted: "inline-bytes" },
      ],
    });
  });

  it("scrubs data URLs embedded in any other string", () => {
    const stored = stripInlineBytes(
      { text: `before ${PIXELS} after`, metadata: "metadata: kept" },
      "reject",
    );

    expect(stored).toEqual({
      text: "before [inline image/png data omitted] after",
      metadata: "metadata: kept",
    });
  });

  it("scrubs data URLs whatever the case of the scheme", () => {
    const upper = PIXELS.replace(/^data:/, "DATA:");
    const mixed = PIXELS.replace(/^data:/, "Data:");

    expect(
      stripInlineBytes({ text: `a ${upper} b ${mixed} c` }, "reject"),
    ).toEqual({
      text: "a [inline image/png data omitted] b [inline image/png data omitted] c",
    });

    const event = JSON.stringify({ type: "text-delta", text: `look ${upper}` });
    const stored = stripInlineBytesFromJson(event, "placeholder");
    expect(stored).not.toMatch(/base64,/i);
    expect(JSON.parse(stored)).toEqual({
      type: "text-delta",
      text: "look [inline image/png data omitted]",
    });
  });

  it("returns serialized JSON untouched when no body can be present", () => {
    const json = '{"type":"text-delta","text":"hi"}';
    expect(stripInlineBytesFromJson(json, "placeholder")).toBe(json);
  });
});

describe("assertNoInlineImageBytes", () => {
  it.each([
    [{ content: [{ type: "image", image: PIXELS }] }, "content[0].image"],
    [{ parts: [{ type: "file", data: "JVBERi0=" }] }, "parts[0].data"],
    [{ images: [{ data: "aW1hZ2U=" }] }, "images[0].data"],
    [JSON.stringify({ text: PIXELS }), "text"],
  ])("names the path of stored bytes", (value, path) => {
    expect(() => assertNoInlineImageBytes(value, "row")).toThrow(
      `row stores inline`,
    );
    expect(() => assertNoInlineImageBytes(value, "row")).toThrow(path);
  });

  it("accepts URL-only attachments", () => {
    expect(() =>
      assertNoInlineImageBytes({
        attachments: [{ type: "image", url: DURABLE, data: DURABLE }],
      }),
    ).not.toThrow();
  });
});
