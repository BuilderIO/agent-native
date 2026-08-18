// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "editorToolbar.assetLibrary" ? "Asset Library" : key,
}));

import ImageOverlay from "./ImageOverlay";

describe("<ImageOverlay>", () => {
  afterEach(cleanup);

  it("shows only the core image actions and fit control", () => {
    const onGenerate = vi.fn();
    const onLibrary = vi.fn();
    const onUpload = vi.fn();
    const onDownload = vi.fn();
    const onToggleObjectFit = vi.fn();
    const onClose = vi.fn();

    render(
      <ImageOverlay
        anchorRect={new DOMRect(200, 80, 300, 200)}
        src="https://example.com/image.png"
        objectFit="cover"
        onGenerate={onGenerate}
        onLibrary={onLibrary}
        onUpload={onUpload}
        onDownload={onDownload}
        onToggleObjectFit={onToggleObjectFit}
        onClose={onClose}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      "Generate",
      "Asset Library",
      "Upload",
      "Download",
      "Fit: Cover",
    ]);
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Logo" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(onDownload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Fit: Cover" }));
    expect(onToggleObjectFit).toHaveBeenCalledTimes(1);
  });
});
