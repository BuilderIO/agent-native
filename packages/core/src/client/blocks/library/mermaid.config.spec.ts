import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import {
  mermaidMdx,
  mermaidSchema,
  type MermaidData,
} from "./mermaid.config.js";

/**
 * Minimal `BlockAttrReader` over a plain attribute bag, mirroring the runtime
 * `createAttrReader` value-domain narrowing (string-vs-number-vs-object). Lets
 * the test assert the `toAttrs` → `fromAttrs` round-trip without spinning up the
 * full MDX serialize/parse pipeline.
 */
function reader(attrs: Record<string, unknown>): BlockAttrReader {
  const read = (name: string) => attrs[name];
  return {
    raw: read,
    string: (name) =>
      typeof read(name) === "string" ? (read(name) as string) : undefined,
    number: (name) =>
      typeof read(name) === "number" ? (read(name) as number) : undefined,
    bool: (name) =>
      typeof read(name) === "boolean" ? (read(name) as boolean) : undefined,
    array: <T = unknown>(name: string) =>
      Array.isArray(read(name)) ? (read(name) as T[]) : undefined,
    object: <T = unknown>(name: string) => {
      const value = read(name);
      return value && typeof value === "object" ? (value as T) : undefined;
    },
  };
}

/** Re-decode data from the attribute bag `toAttrs` produced. */
function roundTrip(data: MermaidData): MermaidData {
  const attrs = mermaidMdx.toAttrs(data) as Record<string, unknown>;
  return mermaidMdx.fromAttrs(reader(attrs), "");
}

describe("mermaid block config", () => {
  it("parses valid mermaid data", () => {
    const data = {
      source: "flowchart TD\n  A[Start] --> B{Decision}",
      caption: "Decision flow",
    };
    expect(mermaidSchema.parse(data)).toEqual(data);
  });

  it("parses mermaid data without a caption", () => {
    const data = { source: "sequenceDiagram\n  A->>B: hi" };
    expect(mermaidSchema.parse(data)).toEqual(data);
  });

  it("uses the stable Mermaid MDX tag", () => {
    expect(mermaidMdx.tag).toBe("Mermaid");
  });

  it("round-trips source + caption losslessly through toAttrs/fromAttrs", () => {
    const data: MermaidData = {
      source: "flowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]",
      caption: "Multi-line diagram",
    };
    expect(roundTrip(data)).toEqual(data);
  });

  it("round-trips losslessly when the caption is absent", () => {
    const data: MermaidData = {
      source: "graph LR\n  X --> Y",
    };
    // No caption attribute is emitted, so the decode yields `caption: undefined`.
    expect(roundTrip(data)).toEqual({
      source: data.source,
      caption: undefined,
    });
  });

  it("decodes a missing source attribute to an empty string", () => {
    expect(mermaidMdx.fromAttrs(reader({}), "")).toEqual({
      source: "",
      caption: undefined,
    });
  });
});
