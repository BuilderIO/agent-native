import { describe, expect, it } from "vitest";

import {
  QUICK_PROMPT_ACCELERATOR,
  normalizeQuickPromptPreferences,
} from "./quick-prompt";

describe("Quick Prompt settings", () => {
  it("uses Cmd+Space as the cross-platform accelerator", () => {
    expect(QUICK_PROMPT_ACCELERATOR).toBe("CommandOrControl+Space");
  });

  it("fails closed to the default-off preference", () => {
    expect(normalizeQuickPromptPreferences(undefined)).toEqual({
      enabled: false,
    });
    expect(normalizeQuickPromptPreferences({ enabled: "true" })).toEqual({
      enabled: false,
    });
    expect(normalizeQuickPromptPreferences({ enabled: true })).toEqual({
      enabled: true,
    });
  });
});
