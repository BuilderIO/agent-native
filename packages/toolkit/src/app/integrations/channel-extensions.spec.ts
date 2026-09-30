import { describe, expect, it } from "vitest";

import {
  getChannelSettingsExtensions,
  registerChannelSettingsExtensions,
} from "./channel-extensions.js";

describe("channel settings extensions", () => {
  const Empty = () => null;

  it("replaces an extension registered again with the same id", () => {
    const first = registerChannelSettingsExtensions([
      { id: "previews", platform: "slack", component: Empty, order: 2 },
      { id: "other", platform: "slack", component: Empty, order: 1 },
    ]);
    const replacement = { id: "previews", platform: "slack", component: Empty };
    const second = registerChannelSettingsExtensions([replacement]);

    expect(
      getChannelSettingsExtensions("slack").map((extension) => extension.id),
    ).toEqual(["previews", "other"]);
    expect(getChannelSettingsExtensions("slack")[0]).toBe(replacement);
    expect(getChannelSettingsExtensions("telegram")).toEqual([]);

    second();
    first();
    expect(getChannelSettingsExtensions("slack")).toEqual([]);
  });
});
