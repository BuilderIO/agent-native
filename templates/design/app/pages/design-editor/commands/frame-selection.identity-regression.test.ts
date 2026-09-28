// @vitest-environment happy-dom
import { buildCodeLayerProjection } from "@shared/code-layer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { collectLiveSizeHints, runFrameSelection } from "./frame-selection";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const fileId = "active.html";
const source = { kind: "design-file" as const, fileId };
const duplicateHtml = `<html><head></head><body>
<div data-agent-native-node-id="same" data-origin="first" style="position:absolute;left:20px;top:30px">First</div>
<div data-agent-native-node-id="same" data-origin="second" style="position:absolute;left:120px;top:90px">Second longer text</div>
</body></html>`;
function mount(
  content: string,
  sizes: Array<{
    width: number;
    height: number;
    rectWidth?: number;
    rectHeight?: number;
  }>,
) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-design-preview-iframe", "");
  iframe.setAttribute("data-screen-iframe-id", fileId);
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(content);
  doc.close();
  Array.from(doc.querySelectorAll("[data-origin]")).forEach((element, i) => {
    const size = sizes[i]!;
    Object.defineProperty(element, "offsetWidth", {
      configurable: true,
      value: size.width,
    });
    Object.defineProperty(element, "offsetHeight", {
      configurable: true,
      value: size.height,
    });
    const width = size.rectWidth ?? size.width;
    const height = size.rectHeight ?? size.height;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    });
  });
}
function wrap(content: string, origins: string[]) {
  const projection = buildCodeLayerProjection(content, { source });
  const selected = origins.map(
    (origin) =>
      projection.nodes.find((n) => n.dataAttributes["data-origin"] === origin)!
        .id,
  );
  const file = {
    id: fileId,
    filename: fileId,
    fileType: "html" as const,
    content,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
  let updated: string | undefined;
  runFrameSelection({
    activeBreakpointWidthState: undefined,
    activeFile: file,
    applyLocalContentUpdate: (next) => {
      const publication = prepareCanonicalSourceContent(next, {
        fileId,
        fileType: "html",
      });
      updated = publication.content;
      return { status: "accepted", ...publication };
    },
    boardFileId: undefined,
    canEditDesign: true,
    contentHistorySelectionAfterRef: { current: new Map() },
    contentUndoStackRef: { current: [] },
    files: [file],
    getFreshActiveContent: () => content,
    overviewSelectedScreenIds: [],
    selectedLayerIdsState: selected,
    setSelectedElement: () => {},
    setSelectedLayerIdsState: () => {},
    t: (key) => key,
    undoManagerRef: { current: null },
  });
  expect(updated).toBeDefined();
  return new DOMParser().parseFromString(updated!, "text/html");
}
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
describe("frame size hints preserve projected identity and layout geometry", () => {
  it("does not measure a surviving sibling when the selected duplicate path is missing", () => {
    mount(duplicateHtml, [
      { width: 40, height: 20 },
      { width: 220, height: 70 },
    ]);
    const projection = buildCodeLayerProjection(duplicateHtml, { source });
    const second = projection.nodes.find(
      (node) => node.dataAttributes["data-origin"] === "second",
    )!;
    document
      .querySelector("iframe")!
      .contentDocument!.querySelector('[data-origin="second"]')!
      .remove();
    expect(
      collectLiveSizeHints([second.id], projection, fileId, undefined),
    ).toEqual({});
  });
  it("wraps only the second duplicate using its own auto size", () => {
    mount(duplicateHtml, [
      { width: 40, height: 20 },
      { width: 220, height: 70 },
    ]);
    const doc = wrap(duplicateHtml, ["second"]);
    const frame = doc.querySelector<HTMLElement>(
      "[data-agent-native-group-wrapper]",
    )!;
    expect(frame.style.width).toBe("220px");
    expect(frame.style.height).toBe("70px");
    expect(frame.style.left).toBe("120px");
    expect(frame.style.top).toBe("90px");
    expect(frame.querySelector('[data-origin="second"]')).not.toBeNull();
    expect(frame.querySelector('[data-origin="first"]')).toBeNull();
    expect(doc.querySelectorAll("[data-origin]")).toHaveLength(2);
  });
  it("uses separate hints for both duplicate siblings", () => {
    mount(duplicateHtml, [
      { width: 40, height: 20 },
      { width: 220, height: 70 },
    ]);
    const doc = wrap(duplicateHtml, ["second", "first"]);
    const frame = doc.querySelector<HTMLElement>(
      "[data-agent-native-group-wrapper]",
    )!;
    expect(frame.style.width).toBe("320px");
    expect(frame.style.height).toBe("130px");
    expect(frame.querySelectorAll("[data-origin]")).toHaveLength(2);
  });
  it("uses pre-transform layout size and preserves a child's rotation", () => {
    const html =
      '<html><head></head><body><div data-agent-native-node-id="rotated" data-origin="rotated" style="position:absolute;left:20px;top:30px;transform:rotate(90deg)">Label</div></body></html>';
    mount(html, [{ width: 80, height: 20, rectWidth: 20, rectHeight: 80 }]);
    const doc = wrap(html, ["rotated"]);
    const frame = doc.querySelector<HTMLElement>(
      "[data-agent-native-group-wrapper]",
    )!;
    expect(frame.style.width).toBe("80px");
    expect(frame.style.height).toBe("20px");
    expect(
      frame.querySelector<HTMLElement>('[data-origin="rotated"]')!.style
        .transform,
    ).toBe("rotate(90deg)");
  });
});
