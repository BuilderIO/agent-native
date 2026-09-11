// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  reassignClonedAuthoredIds,
  reassignClonedSourceIdentity,
} from "./clone-idrefs";

function parseRoot(html: string): Element {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.firstElementChild!;
}

describe("reassignClonedAuthoredIds", () => {
  it("keeps labels, form controls, lists, and ARIA references inside the clone", () => {
    const root = parseRoot(`
      <section id="panel" aria-labelledby="title help" aria-describedby="help">
        <h2 id="title">Profile</h2>
        <p id="help">Required</p>
        <form id="profile-form"></form>
        <label for="name">Name</label>
        <input id="name" form="profile-form" list="suggestions" />
        <datalist id="suggestions"></datalist>
        <a href="#help">Help</a>
      </section>
    `);
    let sequence = 0;
    const idMap = reassignClonedAuthoredIds(root, () => `copy-${++sequence}`);

    expect(root.id).toBe(idMap.get("panel"));
    expect(root.getAttribute("aria-labelledby")).toBe(
      `${idMap.get("title")} ${idMap.get("help")}`,
    );
    expect(root.getAttribute("aria-describedby")).toBe(idMap.get("help"));
    expect(root.querySelector("label")?.getAttribute("for")).toBe(
      idMap.get("name"),
    );
    expect(root.querySelector("input")?.getAttribute("form")).toBe(
      idMap.get("profile-form"),
    );
    expect(root.querySelector("input")?.getAttribute("list")).toBe(
      idMap.get("suggestions"),
    );
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      `#${idMap.get("help")}`,
    );
  });

  it("rewrites SVG/CSS paint, clip, filter, marker, and SMIL references", () => {
    const root = parseRoot(`
      <svg id="icon">
        <defs>
          <linearGradient id="gradient"></linearGradient>
          <clipPath id="clip"></clipPath>
          <filter id="shadow"></filter>
          <marker id="arrow"></marker>
        </defs>
        <path id="path" fill="url(#gradient)" clip-path="url('#clip')"
          filter="url(&quot;#shadow&quot;)" marker-end="url(#arrow)"
          style="stroke: url(#gradient)"></path>
        <animate begin="path.click; icon.mouseenter" end="path.mouseout"></animate>
      </svg>
    `);
    let sequence = 0;
    const idMap = reassignClonedAuthoredIds(
      root,
      () => `svg-copy-${++sequence}`,
    );
    const path = root.querySelector("path")!;
    const animate = root.querySelector("animate")!;

    expect(path.getAttribute("fill")).toBe(`url(#${idMap.get("gradient")})`);
    expect(path.getAttribute("clip-path")).toBe(`url('#${idMap.get("clip")}')`);
    expect(path.getAttribute("filter")).toBe(`url("#${idMap.get("shadow")}")`);
    expect(path.getAttribute("marker-end")).toBe(`url(#${idMap.get("arrow")})`);
    expect(path.getAttribute("style")).toContain(
      `url(#${idMap.get("gradient")})`,
    );
    expect(animate.getAttribute("begin")).toBe(
      `${idMap.get("path")}.click; ${idMap.get("icon")}.mouseenter`,
    );
    expect(animate.getAttribute("end")).toBe(`${idMap.get("path")}.mouseout`);
  });

  it("gives duplicate source ids unique values while references follow the first occurrence", () => {
    const root = parseRoot(`
      <div>
        <span id="duplicate">First</span>
        <span id="duplicate">Second</span>
        <button aria-controls="duplicate">Open</button>
      </div>
    `);
    let sequence = 0;
    const idMap = reassignClonedAuthoredIds(root, () => `copy-${++sequence}`);
    const ids = Array.from(root.querySelectorAll("[id]"), (node) => node.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(root.querySelector("button")?.getAttribute("aria-controls")).toBe(
      idMap.get("duplicate"),
    );
    expect(idMap.get("duplicate")).toBe(ids[0]);
  });
});

describe("reassignClonedSourceIdentity", () => {
  const INHERITED = [
    "data-code-layer-id",
    "data-layer-id",
    "data-builder-id",
    "data-loc",
  ];

  it("leaves a clone sharing no source identity with the original it was copied from", () => {
    const original = parseRoot(`
      <div data-loc="Card.tsx:12:4" data-builder-id="blk-1">
        <h3 data-loc="Card.tsx:13:6">Title</h3>
        <p data-code-layer-id="layer-9" data-source-file="Card.tsx">Body</p>
      </div>
    `);
    const clone = original.cloneNode(true) as Element;
    let sequence = 0;
    reassignClonedSourceIdentity(clone, () => `copy-${++sequence}`);

    for (const attribute of INHERITED) {
      expect(clone.querySelector(`[${attribute}]`)).toBeNull();
      expect(clone.hasAttribute(attribute)).toBe(false);
    }
    expect(original.getAttribute("data-loc")).toBe("Card.tsx:12:4");
    expect(
      original.querySelector("p")?.getAttribute("data-code-layer-id"),
    ).toBe("layer-9");
  });

  it("gives every node that carried inherited identity a fresh unique node id", () => {
    const clone = parseRoot(`
      <div data-loc="a:1:1">
        <h3 data-loc="a:2:1">Title</h3>
        <p data-builder-id="blk-2">Body</p>
        <span>no identity</span>
      </div>
    `);
    let sequence = 0;
    reassignClonedSourceIdentity(clone, () => `copy-${++sequence}`);

    const ids = [clone, ...Array.from(clone.querySelectorAll("*"))].map(
      (node) => node.getAttribute("data-agent-native-node-id"),
    );
    expect(ids.slice(0, 3).every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids.slice(0, 3)).size).toBe(3);
    expect(
      clone.querySelector("span")?.hasAttribute("data-agent-native-node-id"),
    ).toBe(false);
  });

  it("keeps a node id the caller already re-stamped", () => {
    const clone = parseRoot(
      `<div data-agent-native-node-id="already-fresh" data-loc="a:1:1"></div>`,
    );
    reassignClonedSourceIdentity(clone, () => "should-not-be-used");

    expect(clone.getAttribute("data-agent-native-node-id")).toBe(
      "already-fresh",
    );
    expect(clone.hasAttribute("data-loc")).toBe(false);
  });
});
