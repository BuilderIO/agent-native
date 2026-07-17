import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client", () => ({
  getBrowserTabId: () => "acceptance-tab",
  readClientAppState: vi.fn(),
  setClientAppState: vi.fn(),
  useActionMutation: vi.fn(),
  useActionQuery: vi.fn(),
  useChangeVersion: () => 0,
  useT: () => (key: string) =>
    ({
      "creativeContext.off": "Off",
      "creativeContext.automatic": "Automatic",
    })[key] ?? key,
}));

const { CreativeContextChip } =
  await import("../client/CreativeContextChip.js");
const { normalizeCreativeContextState } =
  await import("../client/application-state.js");
const { UploadContextConnector } = await import("../connectors/upload.js");

describe("credential-free Library acceptance", () => {
  it("imports usable PPTX items, displays their pack chip, and structurally opts out", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("./fixtures/launch-system-v2.pptx", import.meta.url),
      ),
    );
    const handle = {
      id: "acceptance-pptx",
      provider: "fixture",
      opaque: true as const,
      encrypted: true,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const config = {
      items: [
        {
          id: "launch-system",
          title: "Launch system",
          fileName: "launch-system.pptx",
          mimeType: handle.mimeType,
          blobHandle: handle,
        },
      ],
    };
    const context = {
      appId: "content",
      ownerEmail: "owner@example.com",
      readPrivateBlob: async () => ({ data: bytes, handle }),
      putPrivateBlob: async (input: {
        data: Uint8Array;
        mimeType?: string;
      }) => ({
        id: createHash("sha256").update(input.data).digest("hex").slice(0, 20),
        provider: "fixture",
        opaque: true as const,
        encrypted: true,
        mimeType: input.mimeType,
      }),
    } as never;
    const connector = new UploadContextConnector();
    const inventory = await connector.inventory(
      { sourceId: "library-source", config },
      context,
    );
    const imported = await connector.fetch(
      {
        sourceId: "library-source",
        config,
        item: inventory.items[0]!,
      },
      context,
    );

    expect(imported.items).toHaveLength(4);
    expect(imported.items.every((item) => item.parseStatus === "parsed")).toBe(
      true,
    );
    expect(imported.items[0]).toMatchObject({
      externalId: "launch-system",
      metadata: {
        childExternalIds: [
          "launch-system:slide-1",
          "launch-system:slide-2",
          "launch-system:slide-3",
        ],
      },
    });
    expect(imported.items[1]?.chunks?.length).toBeGreaterThan(0);

    const pack = {
      id: "pack:launch-system",
      name: "Launch system",
      description: "Imported approved launch evidence",
      derivedFromPackId: null,
      brandDnaVersionId: null,
      contextMode: "auto",
      request: {},
      memberCount: imported.items.length,
      pinned: true,
      archivedAt: null,
      visibility: "private" as const,
      createdAt: "2026-07-16T00:00:00.000Z",
    };
    const enabledMarkup = renderToStaticMarkup(
      <CreativeContextChip
        state={{
          contextMode: "auto",
          currentPackId: pack.id,
          pinnedPackId: pack.id,
        }}
        packs={[pack]}
      />,
    );
    expect(enabledMarkup).toContain("Launch system");
    expect(enabledMarkup).toContain("Imported approved launch evidence");

    const off = normalizeCreativeContextState({
      contextMode: "off",
      currentPackId: pack.id,
      pinnedPackId: pack.id,
    });
    expect(off).toEqual({
      contextMode: "off",
      currentPackId: null,
      pinnedPackId: null,
    });
    const offMarkup = renderToStaticMarkup(
      <CreativeContextChip state={off} packs={[pack]} />,
    );
    expect(offMarkup).toContain("Off");
    expect(offMarkup).not.toContain("Launch system");
  });
});
