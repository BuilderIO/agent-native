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

  it("adds a nonce-bound exact-origin callback to the top-level URL", () => {
    expect(
      standaloneAssetPickerUrl(
        "https://assets.agent-native.com/picker?embedded=1",
        "https://clips.agent-native.com",
        {
          handoffId: "handoff-123",
          returnOrigin: "https://clips.agent-native.com/chat",
        },
      ),
    ).toBe(
      "https://assets.agent-native.com/picker?mediaType=image&__an_asset_picker_handoff=handoff-123&__an_asset_picker_return_origin=https%3A%2F%2Fclips.agent-native.com",
    );
  });

  it("omits an invalid callback target", () => {
    expect(
      standaloneAssetPickerUrl(
        "https://assets.agent-native.com/picker",
        "https://clips.agent-native.com",
        { handoffId: "handoff-123", returnOrigin: "javascript:alert(1)" },
      ),
    ).toBe("https://assets.agent-native.com/picker?mediaType=image");
  });
});
