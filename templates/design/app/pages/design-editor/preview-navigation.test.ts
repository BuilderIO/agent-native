import { describe, expect, it, vi } from "vitest";

import { openPreviewUrl } from "./preview-navigation";

describe("openPreviewUrl", () => {
  it("creates the popup before navigating it", () => {
    const popup = {
      location: { href: "" },
      opener: {} as Window,
    } as unknown as Window;
    const openWindow = vi.fn(() => popup);
    const navigateSameTab = vi.fn();

    expect(
      openPreviewUrl(
        "https://preview.example.test/design",
        openWindow,
        navigateSameTab,
      ),
    ).toBe("popup");
    expect(openWindow).toHaveBeenCalledWith("", "_blank");
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe("https://preview.example.test/design");
    expect(navigateSameTab).not.toHaveBeenCalled();
  });

  it("falls back to the current tab when the popup is blocked", () => {
    const openWindow = vi.fn(() => null);
    const navigateSameTab = vi.fn();

    expect(
      openPreviewUrl(
        "blob:https://preview.example.test/id",
        openWindow,
        navigateSameTab,
      ),
    ).toBe("same-tab");
    expect(navigateSameTab).toHaveBeenCalledWith(
      "blob:https://preview.example.test/id",
    );
  });
});
