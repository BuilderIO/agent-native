// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { afterEach, describe, expect, it } from "vitest";

import { runPublishCanonicalContent } from "@/pages/design-editor/commands/publish-canonical-content";

import { readLiveLayerMoveLayout } from "./live-layer-move-layout";

const FILE_ID = "screen-a";

function mountPreview(content: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", FILE_ID);
  document.body.append(iframe);
  const preview = iframe.contentDocument!;
  preview.open();
  preview.write(content);
  preview.close();
  return iframe;
}

function publish(content: string): string {
  return runPublishCanonicalContent(
    {
      canEditDesignRef: { current: true },
      pendingLocalFileContentsRef: { current: new Map() },
      cancelIdentityMigration: () => {},
      queueFileContentSave: () => {},
    },
    FILE_ID,
    content,
  );
}

function read(content: string, sourceText: string) {
  const projection = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: FILE_ID },
  });
  const source = projection.nodes.find(
    (node) => node.textSnippet === sourceText,
  );
  const destination = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "target",
  );
  expect(source).toBeTruthy();
  expect(destination).toBeTruthy();
  return readLiveLayerMoveLayout({
    activeFileId: FILE_ID,
    destination: { fileId: FILE_ID, node: destination, projection },
    placement: "inside",
    source: { fileId: FILE_ID, node: source, projection },
  });
}

afterEach(() => document.body.replaceChildren());

describe("readLiveLayerMoveLayout", () => {
  it.each([
    [
      "duplicate authored ids",
      `id="duplicate"`,
      `id="duplicate"`,
      "first",
      "second",
    ],
    [
      "duplicate stable ids",
      `data-agent-native-node-id="reused"`,
      `data-agent-native-node-id="reused"`,
      "first",
      "second",
    ],
  ])(
    "refuses a missing selected node with %s instead of using its surviving twin",
    (_label, firstIdentity, secondIdentity, firstText, secondText) => {
      const identityAttrs = (
        identity: string,
        stableId: string,
        authoredId: string,
      ) => {
        const hasStableId = identity.startsWith("data-agent-native-node-id");
        return hasStableId
          ? `${identity} id="${authoredId}"`
          : `${identity} data-agent-native-node-id="${stableId}"`;
      };
      const content = `<html><head><style>
.freeform { display:block; position:relative; }
.autoflow { display:flex; position:relative; }
.workspace { display:flex; }
</style></head><body>
  <section class="freeform"><button ${identityAttrs(firstIdentity, "first", "first-authored")} style="position:absolute;left:11px;top:13px">${firstText}</button></section>
  <section class="autoflow"><button ${identityAttrs(secondIdentity, "second", "second-authored")} style="position:fixed;left:29px;top:31px">${secondText}</button></section>
  <section data-agent-native-node-id="target" class="workspace"></section>
</body></html>`;
      const iframe = mountPreview(content);
      const selectedProjection = buildCodeLayerProjection(content, {
        source: { kind: "design-file", fileId: FILE_ID },
      });
      const selected = selectedProjection.nodes.find(
        (node) => node.textSnippet === secondText,
      )!;
      const selector = selected.path;
      expect(iframe.contentDocument!.querySelector(selector)).toBeTruthy();
      iframe.contentDocument!.querySelector(selector)?.remove();

      expect(read(content, secondText)).toEqual({ status: "stale" });
    },
  );

  it.each([
    ["duplicate authored id", `id="reused"`, `id="reused"`],
    [
      "duplicate stable id",
      `data-agent-native-node-id="reused"`,
      `data-agent-native-node-id="reused"`,
    ],
  ])(
    "does not follow a shifted twin after the first %s disappears",
    (_label, firstIdentity, secondIdentity) => {
      const content = `<html><body><section><button ${firstIdentity}>first</button><button ${secondIdentity}>second</button></section><div data-agent-native-node-id="target"></div></body></html>`;
      const iframe = mountPreview(content);
      const projection = buildCodeLayerProjection(content, {
        source: { kind: "design-file", fileId: FILE_ID },
      });
      const first = projection.nodes.find(
        (node) => node.textSnippet === "first",
      )!;
      expect(iframe.contentDocument!.querySelector(first.path)).toBeTruthy();
      iframe.contentDocument!.querySelector(first.path)?.remove();

      expect(read(content, "first")).toEqual({ status: "stale" });
    },
  );

  it("reports no matching iframe as unavailable for established source fallback", () => {
    const content = `<body><div data-agent-native-node-id="moving">Move</div><div data-agent-native-node-id="target"></div></body>`;
    expect(read(content, "Move")).toEqual({ status: "unavailable" });
  });

  it("reports an existing iframe with an unreadable document as stale", () => {
    const content = `<body><div data-agent-native-node-id="moving">Move</div><div data-agent-native-node-id="target"></div></body>`;
    const iframe = mountPreview(content);
    Object.defineProperty(iframe, "contentDocument", { get: () => null });

    expect(read(content, "Move")).toEqual({ status: "stale" });
  });

  it("tracks a publisher-stamped duplicate-id button after the individual buttons reorder", () => {
    const rawContent = `<html><head><style>
.regular { display:block; position:relative; }
.flow { display:flex; position:relative; }
.workspace { display:flex; }
.absolute-paint { position:absolute; left:11px; top:13px; }
</style></head><body>
  <section class="regular"><button id="duplicate" class="absolute-paint">First</button></section>
  <section class="flow"><button id="duplicate" style="position:fixed;left:29px;top:31px">Second</button></section>
  <section data-agent-native-node-id="target" class="workspace"></section>
</body></html>`;
    const content = publish(rawContent);
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: FILE_ID },
    });
    const first = projection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "First",
    )!;
    const second = projection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "Second",
    )!;
    const iframe = mountPreview(content);
    const firstLive = iframe.contentDocument!.querySelector(
      `[data-agent-native-node-id="${first.dataAttributes["data-agent-native-node-id"]}"]`,
    )!;
    const secondLive = iframe.contentDocument!.querySelector(
      `[data-agent-native-node-id="${second.dataAttributes["data-agent-native-node-id"]}"]`,
    )!;
    const firstParent = firstLive.parentElement!;
    const secondParent = secondLive.parentElement!;
    firstParent.append(secondLive);
    secondParent.append(firstLive);

    expect(
      readLiveLayerMoveLayout({
        activeFileId: FILE_ID,
        destination: {
          fileId: FILE_ID,
          node: projection.nodes.find(
            (node) =>
              node.dataAttributes["data-agent-native-node-id"] === "target",
          ),
          projection,
        },
        placement: "inside",
        source: { fileId: FILE_ID, node: first, projection },
      }),
    ).toEqual({
      status: "resolved",
      sourcePosition: "absolute",
      sourceParentDisplay: "flex",
      destinationDisplay: "flex",
    });
  });

  it("refuses a raw iframe that has not acknowledged the publisher's new IDs", () => {
    const rawContent = `<body><button id="duplicate">First</button><button id="duplicate">Second</button><section data-agent-native-node-id="target"></section></body>`;
    const content = publish(rawContent);
    mountPreview(rawContent);

    expect(read(content, "First")).toEqual({ status: "stale" });
  });

  it("refuses a selected stable ID copied onto a runtime clone", () => {
    const rawContent = `<body><button id="duplicate">First</button><button id="duplicate">Second</button><section data-agent-native-node-id="target"></section></body>`;
    const content = publish(rawContent);
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: FILE_ID },
    });
    const first = projection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "First",
    )!;
    const iframe = mountPreview(content);
    const firstId = first.dataAttributes["data-agent-native-node-id"]!;
    const firstLive = iframe.contentDocument!.querySelector(
      `[data-agent-native-node-id="${firstId}"]`,
    )!;
    iframe.contentDocument!.body.append(firstLive.cloneNode(true));

    expect(
      readLiveLayerMoveLayout({
        activeFileId: FILE_ID,
        destination: {
          fileId: FILE_ID,
          node: projection.nodes.find(
            (node) =>
              node.dataAttributes["data-agent-native-node-id"] === "target",
          ),
          projection,
        },
        placement: "inside",
        source: { fileId: FILE_ID, node: first, projection },
      }),
    ).toEqual({ status: "stale" });
  });
});
