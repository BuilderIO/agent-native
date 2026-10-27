// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  extensionPanelHeightKey,
  initialExtensionPanelHeight,
  MAX_REMEMBERED_EXTENSION_PANEL_HEIGHT,
  rememberExtensionPanelHeight,
} from "./extension-panel-height";

const key = extensionPanelHeightKey("repo-health", "rh-about", "extension-1");

describe("remembered extension panel heights", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts one panel unit tall, then at the last reported height", () => {
    expect(initialExtensionPanelHeight(key)).toBe(180);
    rememberExtensionPanelHeight(key, 612);
    expect(initialExtensionPanelHeight(key)).toBe(612);
  });

  it("caps a runaway height when saving it", () => {
    rememberExtensionPanelHeight(key, 5_000_000);
    expect(
      window.localStorage.getItem(`analytics-extension-panel-height:${key}`),
    ).toBe(String(MAX_REMEMBERED_EXTENSION_PANEL_HEIGHT));
    expect(initialExtensionPanelHeight(key)).toBe(4000);
  });

  it("caps a runaway height saved before the cap when reading it", () => {
    window.localStorage.setItem(
      `analytics-extension-panel-height:${key}`,
      "5000000",
    );
    expect(initialExtensionPanelHeight(key)).toBe(4000);
  });
});
