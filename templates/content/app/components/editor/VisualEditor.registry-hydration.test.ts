import { describe, expect, it } from "vitest";

import {
  hydrateRegistryBlockRaw,
  isRegistryBlockHydrationCurrent,
} from "./VisualEditor";

describe("registry block hydration", () => {
  it("returns typed Mermaid data for valid persisted source", async () => {
    const result = await hydrateRegistryBlockRaw(
      '<Mermaid id="mermaid-1" source={"flowchart TD\\n  A --> B"} />',
    );

    expect(result.status).toBe("loaded");
    if (result.status === "loaded") {
      expect(result.block.type).toBe("mermaid");
      expect(result.block.data).toEqual({
        source: "flowchart TD\n  A --> B",
        caption: undefined,
      });
    }
  });

  it("preserves malformed persisted source in a terminal error result", async () => {
    const rawSource = '<Mermaid id="mermaid-1" source={nope} />';
    const result = await hydrateRegistryBlockRaw(rawSource);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.rawSource).toBe(rawSource);
      expect(result.message).toContain("Unsupported MDX attribute expression");
    }
  });

  it("classifies missing persisted source as a terminal error", async () => {
    await expect(hydrateRegistryBlockRaw("")).resolves.toEqual({
      status: "error",
      message: "unreadable",
      rawSource: "",
    });
  });

  it("rejects a hydration completion when the live or pending source changed", () => {
    const original = '<Mermaid id="mermaid-1" source="graph TD; A --> B" />';
    const replacement = '<Mermaid id="mermaid-1" source="graph TD; B --> C" />';

    expect(isRegistryBlockHydrationCurrent(original, original, original)).toBe(
      true,
    );
    expect(
      isRegistryBlockHydrationCurrent(original, original, replacement),
    ).toBe(false);
    expect(
      isRegistryBlockHydrationCurrent(original, replacement, replacement),
    ).toBe(false);
  });
});
