// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SlideDesignTokens } from "../open-slide-runtime/protocol";
import { OpenSlideDesignTokens } from "./OpenSlideDesignTokens";

vi.mock("./OpenSlideFontBrowser", () => ({
  OpenSlideFontBrowser: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key.split(".").at(-1) ?? key,
}));

afterEach(cleanup);

const tokens: SlideDesignTokens = {
  background: "#ffffff",
  text: "#111827",
  accent: "#2563eb",
  displayFont: "Arial",
  bodyFont: "Arial",
  heroScale: 1,
  bodyScale: 1,
  radius: 12,
};

describe("OpenSlideDesignTokens", () => {
  it("preserves an unsaved preview when unchanged tokens arrive in a new object", () => {
    const onPreview = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <OpenSlideDesignTokens
        tokens={tokens}
        disabled={false}
        saving={false}
        onPreview={onPreview}
        onSave={onSave}
      />,
    );

    const background = screen.getByLabelText("background");
    fireEvent.change(background, { target: { value: "#123456" } });

    expect(onPreview).toHaveBeenCalledWith({
      ...tokens,
      background: "#123456",
    });

    view.rerender(
      <OpenSlideDesignTokens
        tokens={{ ...tokens }}
        disabled={false}
        saving={false}
        onPreview={onPreview}
        onSave={onSave}
      />,
    );

    expect(background).toHaveProperty("value", "#123456");
    expect(screen.getByRole("button", { name: "saveChanges" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("replaces the draft when the saved token values change", () => {
    const onPreview = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <OpenSlideDesignTokens
        tokens={tokens}
        disabled={false}
        saving={false}
        onPreview={onPreview}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("background"), {
      target: { value: "#123456" },
    });
    view.rerender(
      <OpenSlideDesignTokens
        tokens={{ ...tokens, accent: "#f97316" }}
        disabled={false}
        saving={false}
        onPreview={onPreview}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText("background")).toHaveProperty(
      "value",
      tokens.background,
    );
    expect(screen.getByLabelText("accent")).toHaveProperty("value", "#f97316");
    expect(screen.getByRole("button", { name: "saveChanges" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
