// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { filterEmojiCategories } from "./EmojiPicker";

function emojisFor(search: string) {
  return filterEmojiCategories(search).flatMap((category) => category.emojis);
}

describe("emoji picker search", () => {
  it("matches common emoji names", () => {
    expect(emojisFor("rocket")).toContain("🚀");
    expect(emojisFor("dog")).toContain("🐶");
    expect(emojisFor("light bulb")).toContain("💡");
  });

  it("matches common aliases", () => {
    expect(emojisFor("thumbsup")).toContain("👍");
    expect(emojisFor("+1")).toContain("👍");
    expect(emojisFor("checkmark")).toContain("✅");
  });

  it("matches pasted emoji characters", () => {
    expect(emojisFor("🔥")).toContain("🔥");
    expect(emojisFor("✌")).toContain("✌️");
  });

  it("keeps category search working", () => {
    const food = emojisFor("food");

    expect(food).toContain("🍎");
    expect(food).toContain("🍕");
  });
});
