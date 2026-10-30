import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lab } = vi.hoisted(() => ({
  lab: {
    isLoading: false,
    isError: false,
    isSuccess: true,
    enabled: false,
    refetch: vi.fn(),
  },
}));
vi.mock("@agent-native/core/client/labs", () => ({ useLabState: () => lab }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div>redirect:{to}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));
vi.mock("@/components/library/library-grid", () => ({
  LibraryGrid: () => <div>screenshots grid</div>,
}));
vi.mock("@/components/library/library-primary-actions", () => ({
  ScreenshotPrimaryAction: () => <div>capture</div>,
}));

import ScreenshotsRoute from "./_app.screenshots";

describe("Screenshots lab route", () => {
  beforeEach(() => {
    lab.isLoading = false;
    lab.isError = false;
    lab.isSuccess = true;
    lab.enabled = false;
  });
  it("redirects to the library when disabled", () => {
    expect(renderToStaticMarkup(<ScreenshotsRoute />)).toContain(
      "redirect:/library",
    );
  });
  it("opens screenshots when enabled", () => {
    lab.enabled = true;
    expect(renderToStaticMarkup(<ScreenshotsRoute />)).toContain(
      "screenshots grid",
    );
  });
  it("offers retry rather than redirecting when the lab setting fails", () => {
    lab.isError = true;
    lab.isSuccess = false;
    const html = renderToStaticMarkup(<ScreenshotsRoute />);
    expect(html).toContain("libraryGrid.retry");
    expect(html).not.toContain("redirect:");
  });
  it("waits for the lab setting before deciding", () => {
    lab.isLoading = true;
    expect(renderToStaticMarkup(<ScreenshotsRoute />)).toBe("");
  });
});
