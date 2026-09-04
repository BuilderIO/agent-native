// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  prepareClonedHtmlLayersForLiveInsert,
  preserveClipboardLayerName,
} from "./clone-and-pen-edit";

const LIVE_URL = "http://localhost:5173/products?preview=1";

function parseFragment(html: string): Element {
  const doc = new DOMParser().parseFromString(
    `<template>${html}</template>`,
    "text/html",
  );
  const element = doc.querySelector("template")?.content.firstElementChild;
  if (!element) throw new Error("Expected one cloned element");
  return element;
}

describe("prepareClonedHtmlLayersForLiveInsert", () => {
  it("preserves the human runtime layer name before clone ids replace authored ids", () => {
    const html =
      '<section id="runtime-panel" data-component-name="RuntimePanel">Panel</section>';
    const enriched = preserveClipboardLayerName(html, "Runtime Panel");
    const root = parseFragment(enriched);

    expect(root.getAttribute("data-agent-native-layer-name")).toBe(
      "Runtime Panel",
    );
    expect(
      preserveClipboardLayerName(
        '<section data-agent-native-layer-name="Authored">Panel</section>',
        "Runtime Panel",
      ),
    ).toContain('data-agent-native-layer-name="Authored"');
  });

  it("clones a subtree with fresh node ids and remapped authored id references", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<section id="card" data-agent-native-node-id="root">
          <label for="field" data-agent-native-node-id="label">Name</label>
          <input id="field" aria-labelledby="card" data-agent-native-node-id="input">
        </section>`,
      ],
      { stripRootPosition: true },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!);
    const label = clone.querySelector("label")!;
    const input = clone.querySelector("input")!;
    expect(clone.getAttribute("data-agent-native-node-id")).not.toBe("root");
    expect(label.getAttribute("data-agent-native-node-id")).not.toBe("label");
    expect(input.getAttribute("data-agent-native-node-id")).not.toBe("input");
    expect(clone.id).not.toBe("card");
    expect(input.id).not.toBe("field");
    expect(label.getAttribute("for")).toBe(input.id);
    expect(input.getAttribute("aria-labelledby")).toBe(clone.id);
    expect(result!.rootNodeIds).toEqual([
      clone.getAttribute("data-agent-native-node-id"),
    ]);
    expect(result!.nodeIdMap.get("root")).toBe(
      clone.getAttribute("data-agent-native-node-id"),
    );
    expect(result!.nodeIdMap.get("input")).toBe(
      input.getAttribute("data-agent-native-node-id"),
    );
  });

  it("drops the Figma/Fusion source identity so deleting a copy cannot resolve to the original", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<section data-loc="Card.tsx:12:4" data-builder-id="blk-1">
          <h3 data-loc="Card.tsx:13:6">Title</h3>
          <p data-code-layer-id="layer-9" data-layer-id="l-2">Body</p>
        </section>`,
      ],
      { stripRootPosition: true },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!);
    for (const attribute of [
      "data-loc",
      "data-builder-id",
      "data-code-layer-id",
      "data-layer-id",
    ]) {
      expect(clone.hasAttribute(attribute)).toBe(false);
      expect(clone.querySelector(`[${attribute}]`)).toBeNull();
    }
    const nodeIds = [clone, ...Array.from(clone.querySelectorAll("*"))].map(
      (node) => node.getAttribute("data-agent-native-node-id"),
    );
    expect(nodeIds.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it("preserves sanitized provenance and computed portable styles", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<article
          data-agent-native-node-id="card"
          data-source-framework="react"
          data-source-file="src/Card.tsx"
          data-source-line="42"
          data-source-column="7"
          data-component-name="Card"
          style="display:flex;color:rgb(1, 2, 3)"
        ><span data-agent-native-node-id="title">Title</span></article>`,
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "card",
            nodes: [
              {
                sourceId: "card",
                path: [],
                styles: {
                  display: "grid",
                  "background-color": "rgb(4, 5, 6)",
                },
              },
              {
                sourceId: "title",
                path: [0],
                styles: { "font-weight": "700" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-source-framework")).toBe("react");
    expect(clone.getAttribute("data-source-file")).toBe("src/Card.tsx");
    expect(clone.getAttribute("data-source-line")).toBe("42");
    expect(clone.getAttribute("data-source-column")).toBe("7");
    expect(clone.getAttribute("data-component-name")).toBe("Card");
    expect((clone as HTMLElement).style.display).toBe("grid");
    expect((clone as HTMLElement).style.backgroundColor).toBe("rgb(4, 5, 6)");
    expect((clone.querySelector("span") as HTMLElement).style.fontWeight).toBe(
      "700",
    );
  });

  it("returns the destination URL byte-for-byte instead of turning it into HTML", () => {
    const destination = "http://localhost:5173/a%20b?x=%3Cmain%3E#section";
    const result = prepareClonedHtmlLayersForLiveInsert(destination, [
      '<div data-agent-native-node-id="source">Safe</div>',
    ]);

    expect(result?.destinationContent).toBe(destination);
    expect(result?.destinationContent).not.toContain("<!DOCTYPE");
    expect(
      prepareClonedHtmlLayersForLiveInsert(
        "<!doctype html><html><body></body></html>",
        ['<div data-agent-native-node-id="source">Safe</div>'],
      ),
    ).toBeNull();
  });

  it("returns one safe root per entry and strips active markup", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<div data-agent-native-node-id="one" onclick="attack()">
          One<script>attack()</script>
        </div>`,
        `<button data-agent-native-node-id="two" style="position:absolute;left:9px;top:10px" formaction="javascript:attack()" autofocus>
          Two<iframe></iframe>
        </button>`,
      ],
      {
        positions: [{ x: 12.4, y: 25.6 }, null],
        stripRootPosition: true,
      },
    );

    expect(result?.htmlFragments).toHaveLength(2);
    expect(result?.rootNodeIds).toHaveLength(2);
    expect(new Set(result?.rootNodeIds).size).toBe(2);
    const first = parseFragment(result!.htmlFragments[0]!);
    const second = parseFragment(result!.htmlFragments[1]!);
    expect((first as HTMLElement).style.position).toBe("absolute");
    expect((first as HTMLElement).style.left).toBe("12px");
    expect((first as HTMLElement).style.top).toBe("26px");
    expect(first.hasAttribute("onclick")).toBe(false);
    expect(first.querySelector("script")).toBeNull();
    expect(second.hasAttribute("formaction")).toBe(false);
    expect(second.hasAttribute("autofocus")).toBe(false);
    expect(second.querySelector("iframe")).toBeNull();
    expect((second as HTMLElement).style.position).toBe("");
    expect((second as HTMLElement).style.left).toBe("");
    expect((second as HTMLElement).style.top).toBe("");
  });

  it("rejects an active element used as the fragment root", () => {
    expect(
      prepareClonedHtmlLayersForLiveInsert(LIVE_URL, [
        '<script data-agent-native-node-id="script">attack()</script>',
      ]),
    ).toBeNull();
  });
});
