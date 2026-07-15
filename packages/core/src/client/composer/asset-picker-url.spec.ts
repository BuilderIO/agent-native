import { describe, expect, it } from "vitest";

import {
  isExternalAssetPickerUrl,
  standaloneAssetPickerUrl,
} from "./asset-picker-url.js";

describe("asset picker auth handoff", () => {
  it("treats the hosted Assets picker as external to the host app", () => {
    expect(
      isExternalAssetPickerUrl(
        "https://assets.agent-native.com/picker",
        "https://clips.agent-native.com",
      ),
    ).toBe(true);
  });

  it("keeps same-origin pickers eligible for inline rendering", () => {
    expect(
      isExternalAssetPickerUrl("/picker", "https://clips.agent-native.com"),
    ).toBe(false);
  });

  it("removes iframe flags from the top-level fallback URL", () => {
    expect(
      standaloneAssetPickerUrl(
        "https://assets.agent-native.com/picker?embedded=1&__an_embed_token=fake-token",
      ),
    ).toBe("https://assets.agent-native.com/picker?mediaType=image");
  });
});
