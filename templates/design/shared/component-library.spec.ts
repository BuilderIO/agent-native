import { describe, expect, it } from "vitest";

import {
  entriesForComponent,
  scanComponentLibrary,
  summarizeComponentLibrary,
} from "./component-library.js";

const indexHtml =
  "<main>" +
  '<button data-agent-native-node-id="btn1" data-agent-native-component="PrimaryButton">Save</button>' +
  '<button data-agent-native-node-id="btn2" data-agent-native-component="PrimaryButton">Submit</button>' +
  '<div data-agent-native-node-id="card1" data-agent-native-component="Card">Body</div>' +
  "</main>";

const aboutHtml =
  "<section>" +
  '<button data-agent-native-node-id="btn3" data-agent-native-component="SecondaryButton">Cancel</button>' +
  "</section>";

const linkedHtml =
  '<main><button data-agent-native-node-id="main" data-agent-native-component="PrimaryButton" data-agent-native-component-id="cmp-primary">Save</button>' +
  '<button data-agent-native-node-id="ref" data-agent-native-component="PrimaryButton" data-agent-native-component-ref="cmp-primary">Save</button></main>';

describe("scanComponentLibrary", () => {
  it("finds instances across multiple files, preserving file then document order", () => {
    const entries = scanComponentLibrary([
      { id: "f1", designId: "d1", filename: "index.html", content: indexHtml },
      { id: "f2", designId: "d1", filename: "about.html", content: aboutHtml },
    ]);

    expect(entries.map((e) => e.nodeId)).toEqual([
      "btn1",
      "btn2",
      "card1",
      "btn3",
    ]);
    expect(entries[0]).toMatchObject({
      name: "PrimaryButton",
      fileId: "f1",
      filename: "index.html",
    });
    expect(entries[3]).toMatchObject({
      name: "SecondaryButton",
      fileId: "f2",
      filename: "about.html",
    });
  });

  it("skips files with empty/missing content instead of throwing", () => {
    const entries = scanComponentLibrary([
      { id: "f1", designId: "d1", filename: "empty.html", content: null },
      { id: "f2", designId: "d1", filename: "about.html", content: aboutHtml },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].fileId).toBe("f2");
  });

  it("preserves canonical component identity for main resolution", () => {
    const entries = scanComponentLibrary([
      { id: "f1", designId: "d1", filename: "index.html", content: linkedHtml },
    ]);

    expect(entries).toMatchObject([
      { nodeId: "main", componentId: "cmp-primary" },
      { nodeId: "ref", componentRef: "cmp-primary" },
    ]);
  });

  it("resolves ref-only instances even when the canonical root appears later", () => {
    const entries = scanComponentLibrary([
      {
        id: "f1",
        designId: "d1",
        filename: "instance.html",
        content:
          '<section data-agent-native-node-id="ref-only" data-agent-native-component-ref="cmp-card"></section>',
      },
      {
        id: "f2",
        designId: "d1",
        filename: "main.html",
        content:
          '<section data-agent-native-node-id="main" data-agent-native-component="ReusableCard" data-agent-native-component-id="cmp-card"></section>',
      },
    ]);

    expect(entries).toMatchObject([
      {
        nodeId: "ref-only",
        name: "ReusableCard",
        componentRef: "cmp-card",
      },
      {
        nodeId: "main",
        name: "ReusableCard",
        componentId: "cmp-card",
      },
    ]);
  });
});

describe("entriesForComponent", () => {
  const entries = scanComponentLibrary([
    { id: "f1", designId: "d1", filename: "index.html", content: indexHtml },
  ]);

  it("filters to a single component name", () => {
    const matches = entriesForComponent(entries, "PrimaryButton");
    expect(matches.map((m) => m.nodeId)).toEqual(["btn1", "btn2"]);
  });

  it("excludes the given (fileId, nodeId) pair", () => {
    const matches = entriesForComponent(entries, "PrimaryButton", {
      fileId: "f1",
      nodeId: "btn1",
    });
    expect(matches.map((m) => m.nodeId)).toEqual(["btn2"]);
  });
});

describe("summarizeComponentLibrary", () => {
  it("aggregates one row per component name, sorted alphabetically, with a sample instance", () => {
    const entries = scanComponentLibrary([
      { id: "f1", designId: "d1", filename: "index.html", content: indexHtml },
      { id: "f2", designId: "d1", filename: "about.html", content: aboutHtml },
    ]);
    const summary = summarizeComponentLibrary(entries);

    expect(summary.map((s) => s.name)).toEqual([
      "Card",
      "PrimaryButton",
      "SecondaryButton",
    ]);
    const primary = summary.find((s) => s.name === "PrimaryButton");
    expect(primary?.instanceCount).toBe(2);
    expect(primary?.sampleNodeId).toBe("btn1");
    expect(primary?.sampleFileId).toBe("f1");
  });
});
