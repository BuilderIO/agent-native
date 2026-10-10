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

  it("keeps configured HTTP storage references without persisting pixels", () => {
    const httpReference = "http://minio.example.test:9000/bucket/shot.png";

    expect(
      stripInlineBytes(
        { type: "image", name: "shot.png", data: PIXELS, url: httpReference },
        "placeholder",
      ),
    ).toEqual({
      type: "image",
      name: "shot.png",
      url: httpReference,
    });
    expect(() =>
      assertNoInlineImageBytes({ url: httpReference }),
    ).not.toThrow();
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

  it("removes a credentialed upload URL from nested attachment metadata", () => {
    const stored = stripInlineBytes(
      {
        type: "image",
        name: "shot.png",
        metadata: {
          uploadUrl: "https://files.example.test/shot.png?token=secret",
          source: "composer",
        },
      },
      "placeholder",
    );

    expect(stored).toEqual({
      type: "image",
      name: "shot.png",
      metadata: { source: "composer" },
    });
    expect(() => assertNoInlineImageBytes(stored)).not.toThrow();
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

  it("removes raw base64 fields from attachments", () => {
    const stored = stripInlineBytes(
      {
        type: "image",
        name: "legacy.png",
        mediaType: "image/png",
        base64: "iVBORw0KGgoAAAANSUhEUg==",
      },
      "placeholder",
    );

    expect(stored).toEqual({
      type: "file",
      name: "legacy.png",
      mediaType: "image/png",
      omitted: "inline-bytes",
    });
    expect(() => assertNoInlineImageBytes(stored)).not.toThrow();
  });

  it("replaces provider base64 image sources with a URL or visible stub", () => {
    const image = {
      type: "image",
      name: "provider.png",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUg==",
      },
    };

    expect(stripInlineBytes(image, "placeholder")).toEqual({
      type: "file",
      name: "provider.png",
      mediaType: "image/png",
      omitted: "inline-bytes",
    });
    expect(stripInlineBytes({ ...image, url: DURABLE }, "reject")).toEqual({
      type: "file",
      name: "provider.png",
      mediaType: "image/png",
      url: DURABLE,
    });
  });

  it("removes raw-base64 and signed URLs from persisted attachment references", () => {
    const stored = stripInlineBytes(
      {
        attachments: [
          {
            type: "image",
            name: "short.png",
            mediaType: "image/png",
            url: "AQID",
          },
          {
            type: "image",
            name: "signed.png",
            mediaType: "image/png",
            url: "https://files.example.test/signed.png?token=secret",
          },
          { type: "image", name: "safe.png", url: DURABLE },
        ],
      },
      "placeholder",
    );

    expect(stored).toEqual({
      attachments: [
        {
          type: "file",
          name: "short.png",
          mediaType: "image/png",
          omitted: "unsafe-url",
        },
        {
          type: "file",
          name: "signed.png",
          mediaType: "image/png",
          omitted: "unsafe-url",
        },
        { type: "image", name: "safe.png", url: DURABLE },
      ],
    });
    expect(JSON.stringify(stored)).not.toContain("AQID");
    expect(JSON.stringify(stored)).not.toContain("token=secret");
    expect(() => assertNoInlineImageBytes(stored)).not.toThrow();
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

  it("preserves non-attachment byte-size metadata in serialized JSON", () => {
    const stored = stripInlineBytesFromJson(
      '{"metadata":{"bytes":"1.2 MB"}}',
      "reject",
    );

    expect(JSON.parse(stored)).toEqual({ metadata: { bytes: "1.2 MB" } });
  });

  it.each([
    ["base64", '"base64":"iVBORw0KGgoAAAANSUhEUg=="'],
    ["bytes", '"bytes":[1,2,3]'],
    ["imageBase64", '"imageBase64":"iVBORw0KGgoAAAANSUhEUg=="'],
    ["screenshot_data", '"screenshot_data":"iVBORw0KGgoAAAANSUhEUg=="'],
  ])("sanitizes serialized attachment bytes in the %s field", (_, field) => {
    const json = `{"attachments":[{"type":"file","name":"x.png",${field}}]}`;
    const stored = stripInlineBytesFromJson(json, "placeholder");

    expect(stored).not.toContain("iVBORw0KGgo");
    expect(stored).not.toContain('"bytes"');
    expect(JSON.parse(stored)).toEqual({
      attachments: [
        {
          type: "file",
          name: "x.png",
          omitted: "inline-bytes",
        },
      ],
    });
  });

  it("sanitizes short raw-base64 references from serialized snapshots", () => {
    const stored = stripInlineBytesFromJson(
      '{"attachments":[{"type":"file","name":"x.png","url":"AQID"}]}',
      "placeholder",
    );
    expect(stored).not.toContain("AQID");
    expect(JSON.parse(stored)).toEqual({
      attachments: [{ type: "file", name: "x.png", omitted: "unsafe-url" }],
    });
  });
});

describe("assertNoInlineImageBytes", () => {
  it("allows ordinary prose mentioning data and base64", () => {
    expect(() =>
      assertNoInlineImageBytes({
        text: "Data: Q1 revenue, Q2 revenue. Encode it as base64, then retry.",
        metadata: { bytes: "1.2 MB", base64: "encoding guidance" },
      }),
    ).not.toThrow();
  });

  it("allows a non-attachment byte-count metadata field", () => {
    expect(() =>
      assertNoInlineImageBytes({ metadata: { bytes: "1.2 MB" } }),
    ).not.toThrow();
  });

  it("still rejects byte bodies in attachment metadata", () => {
    expect(() =>
      assertNoInlineImageBytes({
        attachments: [{ type: "file", bytes: "AQID" }],
      }),
    ).toThrow("attachments[0].bytes");
  });

  it("rejects a recognizable file body in a top-level base64 field", () => {
    expect(() =>
      assertNoInlineImageBytes({ base64: "iVBORw0KGgoAAAANSUhEUg==" }),
    ).toThrow("base64");
  });

  it.each([
    [{ content: [{ type: "image", image: PIXELS }] }, "content[0].image"],
    [{ parts: [{ type: "file", data: "JVBERi0=" }] }, "parts[0].data"],
    [{ images: [{ data: "aW1hZ2U=" }] }, "images[0].data"],
    [
      {
        attachments: [
          {
            type: "image",
            metadata: {
              uploadUrl: "https://files.example.test/a.png?token=secret",
            },
          },
        ],
      },
      "attachments[0].metadata.uploadUrl",
    ],
    [JSON.stringify({ text: PIXELS }), "text"],
    [
      JSON.stringify({
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "iVBORw0KGgo=",
            },
          },
        ],
      }),
      "content[0].source.data",
    ],
    [
      JSON.stringify({
        content: [{ type: "file", file: { bytes: [37, 80, 68, 70] } }],
      }),
      "content[0].file.bytes",
    ],
    [{ state: { bytes: [137, 80, 78, 71] } }, "state.bytes"],
    [{ state: { base64: "iVBORw0KGgo=" } }, "state.base64"],
    [{ state: { imageData: new Uint8Array([1, 2, 3]) } }, "state.imageData"],
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

  it("rejects non-durable attachment URLs in persisted rows", () => {
    expect(() =>
      assertNoInlineImageBytes({
        attachments: [{ type: "file", name: "x.png", url: "AQID" }],
      }),
    ).toThrow("attachments[0].url");
  });
});
