// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  plainTextFromDesignHtml,
  readDesignClipboardPayloadFromDataTransfer,
  readDesignClipboardPayloadFromSystem,
  writeDesignClipboard,
  type DesignClipboardEnvironment,
} from "./design-clipboard";
import {
  serializeDesignClipboardPayload,
  type DesignClipboardPayload,
} from "./design-import";

const payload: DesignClipboardPayload = {
  version: 1,
  entries: [
    {
      html: "<p>Readable text</p>",
      rootNodeId: "node-1",
      sourceFileId: "file-1",
    },
  ],
};

class FakeClipboardItem {
  static supports() {
    return true;
  }

  constructor(readonly items: Record<string, Blob>) {}
}

describe("writeDesignClipboard", () => {
  it("extracts readable content without source, scripts, or styles", () => {
    expect(
      plainTextFromDesignHtml([
        '<p class="text-white">Handpicked <strong>tent sites</strong>.</p>',
        "<html><head><style>body{color:red}</style></head><body><script>bad()</script><div>Second screen</div></body></html>",
      ]),
    ).toBe("Handpicked tent sites.\nSecond screen");
  });

  it("keeps readable text in text/plain and layer data in text/html", async () => {
    const write = vi.fn(async (_items: ClipboardItem[]) => undefined);
    const html = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );

    await writeDesignClipboard({ plainText: "Readable text", html }, {
      clipboard: { write },
      ClipboardItem: FakeClipboardItem,
    } as unknown as DesignClipboardEnvironment);

    const item = write.mock.calls[0]![0]![0] as unknown as FakeClipboardItem;
    expect(await item.items["text/plain"]?.text()).toBe("Readable text");
    expect(await item.items["text/html"]?.text()).toBe(html);
  });

  it("falls back to readable plain text when rich clipboard writes are unavailable", async () => {
    const writeText = vi.fn(async () => undefined);

    await writeDesignClipboard(
      {
        plainText: "Readable text",
        html: serializeDesignClipboardPayload("<p>Readable text</p>", payload),
      },
      { clipboard: { writeText }, ClipboardItem: null },
    );

    expect(writeText).toHaveBeenCalledWith("Readable text");
  });
});

describe("readDesignClipboardPayload", () => {
  it("reads the internal marker from HTML without exposing it as plain text", () => {
    const html = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );
    const result = readDesignClipboardPayloadFromDataTransfer({
      getData(type: string) {
        return type === "text/html" ? html : "Readable text";
      },
    });

    expect(result).toEqual({
      payload,
      markerText: html,
      plainText: "Readable text",
    });
  });

  it("reads rich clipboard payloads for menu-driven cross-tab paste", async () => {
    const html = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );
    const result = await readDesignClipboardPayloadFromSystem({
      clipboard: {
        read: async () => [
          {
            types: ["text/plain", "text/html"],
            async getType(type: string) {
              return new Blob([type === "text/html" ? html : "Readable text"]);
            },
          },
        ],
      },
    });

    expect(result).toEqual({
      payload,
      markerText: html,
      plainText: "Readable text",
    });
  });

  it("still accepts legacy markers stored in text/plain", () => {
    const legacyText = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );
    const result = readDesignClipboardPayloadFromDataTransfer({
      getData(type: string) {
        return type === "text/plain" ? legacyText : "";
      },
    });

    expect(result?.payload).toEqual(payload);
  });
});
