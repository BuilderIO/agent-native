// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AudioNode } from "./AudioNode";
import { ImageNode } from "./ImageNode";
import { VideoNode } from "./VideoNode";

describe("media node suggestion policy", () => {
  it("keeps a live mutation policy on every media node", () => {
    let allowed = true;
    const canMutateMedia = () => allowed;
    const nodes = [ImageNode, VideoNode, AudioNode].map((node) =>
      node.configure({ canMutateMedia }),
    );

    expect(nodes.every((node) => node.options.canMutateMedia?.())).toBe(true);
    allowed = false;
    expect(nodes.every((node) => node.options.canMutateMedia?.())).toBe(false);
  });

  it("uses the policy for mutation controls while retaining comments", () => {
    const cases = [
      ["ImageBlock.tsx", "onImageComment"],
      ["VideoBlock.tsx", "onVideoComment"],
      ["AudioBlock.tsx", "onAudioComment"],
    ] as const;

    for (const [file, commentOption] of cases) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("options.canMutateMedia?.() ?? true");
      expect(source).toContain(`editor.isEditable && options.${commentOption}`);
      expect(source).toContain("if (canMutateMediaNow()) deleteNode()");
      if (file !== "ImageBlock.tsx") {
        expect(source).toContain("editor.isDestroyed || !canMutateMediaNow()");
      }
    }
  });
});
