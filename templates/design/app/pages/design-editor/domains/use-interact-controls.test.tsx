// @vitest-environment happy-dom

import type { InteractThemeMode } from "@shared/preview-color-scheme";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreviewThemeStatus } from "@/components/design/design-canvas/preview-theme";

import { useInteractControls } from "./use-interact-controls";

type Controls = ReturnType<typeof useInteractControls>;

const unmounts: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (unmounts.length) await unmounts.pop()!();
});

const SCREENS = [
  { id: "home", filename: "index.html" },
  { id: "docs", filename: "docs.html" },
];

async function mountControls(
  darkStyles: "yes" | "no" | "unknown" | null,
  options: { interactTheme?: InteractThemeMode; active?: boolean } = {},
) {
  const setInteractTheme = vi.fn();
  const requestDarkStyles = vi.fn();
  const status: PreviewThemeStatus | undefined = darkStyles
    ? { kind: "ready", scheme: null, darkStyles }
    : undefined;
  const latest: { current: Controls | null } = { current: null };
  function Harness() {
    latest.current = useInteractControls({
      active: options.active ?? true,
      activeScreenId: "home",
      screens: SCREENS,
      liveRoutePathsByScreenId: {},
      interactTheme: options.interactTheme ?? "light",
      setInteractTheme,
      requestDarkStyles,
      activeThemeStatus: status,
      navigateToScreen: vi.fn(),
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness />));
  unmounts.push(() =>
    act(async () => root.unmount()).then(() => host.remove()),
  );
  const controls = (): Controls => latest.current!;
  return { controls, setInteractTheme, requestDarkStyles };
}

describe("useInteractControls theme", () => {
  it("switches the preview to Dark when the design has dark styles", async () => {
    const { controls, setInteractTheme, requestDarkStyles } =
      await mountControls("yes");
    act(() => controls().handleInteractThemeChange("dark"));
    expect(setInteractTheme).toHaveBeenCalledWith("dark");
    expect(requestDarkStyles).not.toHaveBeenCalled();
  });

  it("switches to Dark while the design is still being read or cannot be read in full", async () => {
    for (const darkStyles of [null, "unknown"] as const) {
      const { controls, setInteractTheme, requestDarkStyles } =
        await mountControls(darkStyles);
      act(() => controls().handleInteractThemeChange("dark"));
      expect(setInteractTheme).toHaveBeenCalledWith("dark");
      expect(requestDarkStyles).not.toHaveBeenCalled();
    }
  });

  it("asks the agent instead when the design has no dark styles, and leaves the preview Light", async () => {
    const { controls, setInteractTheme, requestDarkStyles } =
      await mountControls("no");
    act(() => controls().handleInteractThemeChange("dark"));
    expect(requestDarkStyles).toHaveBeenCalledOnce();
    expect(setInteractTheme).not.toHaveBeenCalled();
    expect(controls().interactPreviewTheme).toMatchObject({
      scheme: "light",
      displayMode: "light",
      darkAvailable: false,
    });
    expect(controls().previewColorScheme).toBe("light");
  });

  it("still switches back to Light when the design has no dark styles", async () => {
    const { controls, setInteractTheme, requestDarkStyles } =
      await mountControls("no");
    act(() => controls().handleInteractThemeChange("light"));
    expect(setInteractTheme).toHaveBeenCalledWith("light");
    expect(requestDarkStyles).not.toHaveBeenCalled();
  });

  it("previews Light by default, whatever the editor's own theme", async () => {
    const { controls } = await mountControls("yes");
    expect(controls().interactPreviewTheme.scheme).toBe("light");
  });

  it("forces nothing outside Interact", async () => {
    const { controls } = await mountControls("yes", {
      active: false,
      interactTheme: "dark",
    });
    expect(controls().previewColorScheme).toBeNull();
  });
});
