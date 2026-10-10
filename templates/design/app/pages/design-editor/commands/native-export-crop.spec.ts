// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import {
  assertPreparedNativeCrop,
  offsetNativeSceneForCrop,
} from "@/pages/design-editor/native-scene-export-client";

import { resolveNativeExportCrop } from "./native-export-crop";

const selection = { tagName: "DIV", selector: "#board-frame" } as ElementInfo;

afterEach(() => {
  document.body.innerHTML = "";
  document.body.style.translate = "";
});

describe("selected native export crop", () => {
  it("normalizes an authored board world offset without losing the selected dimensions", () => {
    const editorOffset = document.createElement("style");
    editorOffset.setAttribute("data-agent-native-content-offset", "");
    editorOffset.textContent =
      "body > [data-agent-native-node-id]{translate:4096px 0px;}";
    document.head.append(editorOffset);
    const node = document.createElement("div");
    node.id = "board-frame";
    node.setAttribute("data-agent-native-node-id", "frame-1");
    node.getBoundingClientRect = () =>
      ({ left: 4314, top: 2069, width: 1162, height: 887 }) as DOMRect;
    document.body.append(node);

    const crop = resolveNativeExportCrop(document, selection);
    expect(crop).toEqual({
      x: 218,
      y: 2069,
      width: 1162,
      height: 887,
      nodeId: "frame-1",
    });
    expect(
      offsetNativeSceneForCrop(
        "<html><head></head><body></body></html>",
        crop!,
      ),
    ).toContain(
      "<style data-agent-native-export-crop>body{translate:-218px -2069px !important}</style></head>",
    );
    editorOffset.remove();
  });

  it("refuses an unreadable or duplicated editor offset instead of cropping the wrong board region", () => {
    const offset = document.createElement("style");
    offset.setAttribute("data-agent-native-content-offset", "");
    offset.textContent =
      "body > [data-agent-native-node-id]{translate:4096px 0px;}";
    document.head.append(offset);
    const node = document.createElement("div");
    node.id = "board-frame";
    node.setAttribute("data-agent-native-node-id", "frame-1");
    node.getBoundingClientRect = () =>
      ({ left: 4314, top: 2069, width: 1162, height: 887 }) as DOMRect;
    document.body.append(node);
    const duplicate = offset.cloneNode(true) as HTMLStyleElement;
    document.head.append(duplicate);
    expect(() => resolveNativeExportCrop(document, selection)).toThrow(
      /board offset is unreadable/,
    );
    duplicate.remove();
    offset.textContent =
      "body > [data-agent-native-node-id]{translate:var(--offset) 0px;}";
    expect(() => resolveNativeExportCrop(document, selection)).toThrow(
      /board offset is unreadable/,
    );
    offset.remove();
  });

  it("refuses unresolved, multiple, and authored body translations", () => {
    expect(() => resolveNativeExportCrop(document, selection)).toThrow();
    const first = document.createElement("div");
    first.id = "board-frame";
    first.setAttribute("data-agent-native-node-id", "frame-1");
    first.getBoundingClientRect = () =>
      ({ left: 20, top: 30, width: 100, height: 80 }) as DOMRect;
    const second = document.createElement("div");
    second.id = "second";
    second.setAttribute("data-agent-native-node-id", "frame-2");
    second.getBoundingClientRect = () =>
      ({ left: 150, top: 30, width: 100, height: 80 }) as DOMRect;
    document.body.append(first, second);
    expect(() =>
      resolveNativeExportCrop(document, [
        selection,
        { tagName: "DIV", selector: "#second" } as ElementInfo,
      ]),
    ).toThrow(/one selected authored node/);
    document.body.style.translate = "12px 0px";
    expect(() => resolveNativeExportCrop(document, selection)).toThrow(
      /authored body translation/,
    );
  });

  it("checks the selected node's prepared viewport geometry before capture", () => {
    const node = document.createElement("div");
    node.setAttribute("data-agent-native-node-id", "frame-1");
    node.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1162, height: 887 }) as DOMRect;
    document.body.append(node);
    const crop = {
      x: 4314,
      y: 2069,
      width: 1162,
      height: 887,
      nodeId: "frame-1",
    };
    expect(() => assertPreparedNativeCrop(document, crop)).not.toThrow();
    node.getBoundingClientRect = () =>
      ({ left: 4314, top: 2069, width: 1162, height: 887 }) as DOMRect;
    expect(() => assertPreparedNativeCrop(document, crop)).toThrow(
      /changed geometry/,
    );
  });
});
