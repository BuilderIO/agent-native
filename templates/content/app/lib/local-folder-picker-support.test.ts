import { describe, expect, it } from "vitest";

import { isUnsafeNativeFolderPickerHost } from "./local-folder-picker-support";

describe("local folder picker host safety", () => {
  it("blocks Codex and Electron host markers with a Chrome-like user agent", () => {
    const chromeUa =
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";
    expect(
      isUnsafeNativeFolderPickerHost({ codexWindowType: "electron" }, chromeUa),
    ).toBe(true);
    expect(
      isUnsafeNativeFolderPickerHost({ electronBridge: {} }, chromeUa),
    ).toBe(true);
  });

  it("blocks explicit embedded-shell user agents", () => {
    expect(
      isUnsafeNativeFolderPickerHost({}, "Mozilla/5.0 Electron/39.0"),
    ).toBe(true);
    expect(isUnsafeNativeFolderPickerHost({}, "Mozilla/5.0 Codex/1.0")).toBe(
      true,
    );
  });

  it("allows a normal browser host", () => {
    expect(
      isUnsafeNativeFolderPickerHost(
        {},
        "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });
});
