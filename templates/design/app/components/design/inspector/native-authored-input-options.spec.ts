import { resolveCodeLayerTarget } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { nativeAuthoredLayerOptions } from "./native-authored-input-options";

describe("native authored input layer choices", () => {
  it("uses saved node IDs or source selectors and keeps readable layer names", () => {
    const html = `<main data-agent-native-layer-name="Canvas">
      <div data-agent-native-node-id="target" data-agent-native-layer-name="Effect"></div>
      <img src="/photo.png" alt="Photo source">
      <p data-agent-native-layer-name="Headline">Hello</p>
    </main>`;
    const options = nativeAuthoredLayerOptions(html, "target");
    expect(options.some((option) => option.name === "Canvas")).toBe(false);
    expect(options.some((option) => option.nodeId === "target")).toBe(false);
    expect(
      options.find((option) => option.name === "Photo source"),
    ).toMatchObject({
      nodeId: null,
    });
    expect(options.find((option) => option.name === "Headline")).toMatchObject({
      nodeId: null,
    });
    const photo = options.find((option) => option.name === "Photo source");
    expect(photo?.selector).toBeTruthy();
    expect(
      resolveCodeLayerTarget(html, { selector: photo!.selector }).resolution
        .status,
    ).toBe("resolved");
  });
  it("offers locked layers only when they already have a stable ID", () => {
    const html = `<main><div data-agent-native-node-id="target"></div>
      <section data-agent-native-locked="true"><img alt="Locked new" src="/new.png"><img data-agent-native-node-id="saved" alt="Locked saved" src="/saved.png"></section>
      <img alt="Editable" src="/edit.png"></main>`;
    const options = nativeAuthoredLayerOptions(html, "target");
    expect(options.some((option) => option.name === "Locked new")).toBe(false);
    expect(
      options.find((option) => option.name === "Locked saved")?.nodeId,
    ).toBe("saved");
    expect(options.some((option) => option.name === "Editable")).toBe(true);
  });
});
