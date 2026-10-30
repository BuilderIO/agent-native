// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  getDesignClipboardLayerEntries,
  plainTextFromDesignHtml,
  readDesignClipboardPasteData,
  readDesignClipboardPayloadFromDataTransfer,
  readDesignClipboardPayloadFromSystem,
  readSystemClipboard,
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

describe("design clipboard layer entries", () => {
  it("does not treat a copied screen's marker as a layer fallback", () => {
    expect(
      getDesignClipboardLayerEntries({
        copiedEntries: [],
        copiedScreens: [{ filename: "index.html", content: "<main />" }],
        fallbackHtml: "serialized screen marker",
        sourceFileId: "screen-1",
      }),
    ).toEqual([]);
  });
});

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
  it("recognizes a bounded cross-site screen as structured content requiring preparation", () => {
    const screenPayload: DesignClipboardPayload = {
      version: 1,
      entries: [],
      screens: [
        {
          filename: "index.html",
          sourceScreenId: "remote-screen",
          content:
            '<!doctype html><html><head><style>.card{color:red}</style></head><body><main class="card">Imported design</main></body></html>',
        },
      ],
    };
    const marker = serializeDesignClipboardPayload(
      "Imported design",
      screenPayload,
      "source-site-token",
    );
    const read = readDesignClipboardPasteData(
      {
        getData: (type) => (type === "text/html" ? marker : "Imported design"),
      },
      { trustToken: "destination-site-token" },
    );
    expect(read).toMatchObject({
      status: "found",
      value: { payload: screenPayload, foreign: true },
    });
  });

  // oracle-change: cross-site markers are validated transport, then prepared before adoption; the token no longer blocks portable copies.
  it("marks another site's payload for preparation without treating it as locally trusted", () => {
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
    expect(read(forged)).toMatchObject({ payload, foreign: true });
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
    const result = await readDesignClipboardPayloadFromSystem({
      clipboard: sharedClipboard,
      ClipboardItem: FakeClipboardItem,
    } as unknown as DesignClipboardEnvironment);

    expect(result).toEqual({
      status: "found",
      value: { payload, markerText: html, plainText: "Readable text" },
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
      status: "found",
      value: { payload, markerText: html, plainText: "Readable text" },
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
      status: "found",
      value: { payload, markerText, plainText: markerText },
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
    ).resolves.toMatchObject({
      status: "unreadable",
      errors: [expect.anything(), expect.anything()],
    });
  });

  it("distinguishes a readable clipboard without a Design marker from an unreadable one", async () => {
    await expect(
      readDesignClipboardPayloadFromSystem({
        clipboard: { readText: async () => "ordinary clipboard text" },
      }),
    ).resolves.toEqual({ status: "empty" });
    await expect(
      readDesignClipboardPayloadFromSystem({ clipboard: null }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("recognizes foreign structured content in both system clipboard representations", async () => {
    const foreign = serializeDesignClipboardPayload(
      "<p>Readable text</p>",
      payload,
      "other-origin-token",
    );
    await expect(
      readDesignClipboardPayloadFromSystem({
        clipboard: { readText: async () => foreign },
        trustToken: "this-origin-token",
      }),
    ).resolves.toMatchObject({
      status: "found",
      value: { payload, foreign: true },
    });
    await expect(
      readDesignClipboardPayloadFromSystem({
        clipboard: {
          read: async () => [
            {
              types: ["text/html"],
              getType: async () => new Blob([foreign]),
            },
          ],
        },
        trustToken: "this-origin-token",
      }),
    ).resolves.toMatchObject({
      status: "found",
      value: { payload, foreign: true },
    });
  });

  it("keeps the foreign preparation flag when a context menu reads rich clipboard data", async () => {
    const marker = serializeDesignClipboardPayload(
      "Readable text",
      payload,
      "source-token",
    );
    await expect(
      readSystemClipboard({
        trustToken: "destination-token",
        clipboard: {
          read: async () => [
            { types: ["text/html"], getType: async () => new Blob([marker]) },
          ],
        },
      }),
    ).resolves.toMatchObject({ design: { payload, foreign: true }, files: [] });
  });

  it("distinguishes foreign content, malformed markers, and absent markers", () => {
    const foreign = serializeDesignClipboardPayload(
      "<svg></svg>",
      payload,
      "other-origin-token",
    );
    const transfer = (html: string) => ({
      getData: (type: string) => (type === "text/html" ? html : ""),
    });
    expect(
      readDesignClipboardPasteData(transfer(foreign), {
        trustToken: "this-origin-token",
      }),
    ).toMatchObject({ status: "found", value: { payload, foreign: true } });
    expect(
      readDesignClipboardPasteData(transfer("<svg></svg>"), {
        trustToken: "this-origin-token",
      }),
    ).toEqual({ status: "absent" });
    expect(
      readDesignClipboardPasteData(
        transfer("<!--agent-native-clipboard-v1:broken-->"),
        { trustToken: "this-origin-token" },
      ),
    ).toEqual({ status: "untrusted" });
    const trusted = serializeDesignClipboardPayload(
      "<svg></svg>",
      payload,
      "this-origin-token",
    );
    expect(
      readDesignClipboardPasteData(transfer(trusted), {
        trustToken: "this-origin-token",
      }),
    ).toMatchObject({ status: "found", value: { payload } });
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
