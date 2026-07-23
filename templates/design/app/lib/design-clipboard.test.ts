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
  parseDesignClipboardMarker,
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

  it("preserves the rich cross-tab payload when the async Clipboard API is permission-denied", async () => {
    const write = vi.fn(async () => {
      throw Object.assign(new Error("Clipboard permission denied"), {
        name: "NotAllowedError",
      });
    });
    const writeText = vi.fn(async () => undefined);
    let legacyRepresentations: { plainText: string; html: string } | undefined;
    const html = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );

    await writeDesignClipboard({ plainText: "Readable text", html }, {
      clipboard: { write, writeText },
      ClipboardItem: FakeClipboardItem,
      legacyCopy(representations: { plainText: string; html: string }) {
        legacyRepresentations = representations;
        return true;
      },
    } as unknown as DesignClipboardEnvironment);

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(legacyRepresentations?.plainText).toBe("Readable text");
    expect(parseDesignClipboardMarker(legacyRepresentations?.html)).toEqual(
      payload,
    );
  });

  it("commits the browser copy synchronously before an immediate navigation can cancel an async write", async () => {
    const write = vi.fn(async () => undefined);
    const legacyCopy = vi.fn(() => true);

    await writeDesignClipboard(
      {
        plainText: "Readable text",
        html: serializeDesignClipboardPayload("<p>Readable text</p>", payload),
      },
      {
        clipboard: { write },
        ClipboardItem: FakeClipboardItem,
        legacyCopy,
        preferLegacyCopy: true,
      } as unknown as DesignClipboardEnvironment,
    );

    expect(legacyCopy).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("readDesignClipboardPayload", () => {
  it("rejects a marker-shaped external clipboard payload without the local trust token", () => {
    const trusted = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
      "local-installation-token",
    );
    const forged = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
      "attacker-token",
    );
    const read = (html: string) =>
      readDesignClipboardPayloadFromDataTransfer(
        {
          getData(type: string) {
            return type === "text/html" ? html : "Readable text";
          },
        },
        { trustToken: "local-installation-token" },
      );

    expect(read(trusted)?.payload).toEqual(payload);
    expect(read(forged)).toBeNull();
  });

  it("round-trips through the system clipboard across independent Design tabs", async () => {
    let sharedItems: FakeClipboardItem[] = [];
    const sharedClipboard = {
      async write(items: ClipboardItem[]) {
        sharedItems = items as unknown as FakeClipboardItem[];
      },
      async read() {
        return sharedItems.map((item) => ({
          types: Object.keys(item.items),
          async getType(type: string) {
            return item.items[type]!;
          },
        }));
      },
    };
    const html = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );

    await writeDesignClipboard({ plainText: "Readable text", html }, {
      clipboard: sharedClipboard,
      ClipboardItem: FakeClipboardItem,
    } as unknown as DesignClipboardEnvironment);
    // A new environment models a remounted editor or separate browser tab:
    // there are no shared React refs, only the OS clipboard representation.
    const result = await readDesignClipboardPayloadFromSystem({
      clipboard: sharedClipboard,
      ClipboardItem: FakeClipboardItem,
    } as unknown as DesignClipboardEnvironment);

    expect(result).toEqual({
      payload,
      markerText: html,
      plainText: "Readable text",
    });
  });

  it("reads the internal marker from HTML without exposing it as plain text", () => {
    const html = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );
    const result = readDesignClipboardPayloadFromDataTransfer(
      {
        getData(type: string) {
          return type === "text/html" ? html : "Readable text";
        },
      },
      { trustToken: undefined },
    );

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

  it("falls back from a permission-denied rich read to a readable marker", async () => {
    const markerText = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );
    const result = await readDesignClipboardPayloadFromSystem({
      clipboard: {
        read: async () => {
          throw Object.assign(new Error("Clipboard permission denied"), {
            name: "NotAllowedError",
          });
        },
        readText: async () => markerText,
      },
    });

    expect(result).toEqual({
      payload,
      markerText,
      plainText: markerText,
    });
  });

  it("fails closed when every system clipboard read path is permission-denied", async () => {
    const denied = () =>
      Promise.reject(
        Object.assign(new Error("Clipboard permission denied"), {
          name: "NotAllowedError",
        }),
      );
    await expect(
      readDesignClipboardPayloadFromSystem({
        clipboard: { read: denied, readText: denied },
      }),
    ).resolves.toBeNull();
  });

  it("can inspect legacy markers in an explicit migration context", () => {
    const legacyText = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
    );
    const result = readDesignClipboardPayloadFromDataTransfer(
      {
        getData(type: string) {
          return type === "text/plain" ? legacyText : "";
        },
      },
      { trustToken: undefined },
    );

    expect(result?.payload).toEqual(payload);
  });
});
