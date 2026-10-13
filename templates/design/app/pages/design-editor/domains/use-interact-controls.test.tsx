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

interface MountOptions {
  interactTheme?: InteractThemeMode;
  active?: boolean;
  activeScreenUrlBacked?: boolean;
}

async function mountControls(
  darkStyles: "yes" | "no" | "unknown" | null,
  initial: MountOptions = {},
) {
  const setInteractTheme = vi.fn();
  const requestDarkStyles = vi.fn();
  const status: PreviewThemeStatus | undefined = darkStyles
    ? { kind: "ready", scheme: null, darkStyles }
    : undefined;
  const latest: { current: Controls | null } = { current: null };
  function Harness({ options }: { options: MountOptions }) {
    latest.current = useInteractControls({
      active: options.active ?? true,
      activeScreenId: "home",
      screens: SCREENS,
      interactTheme: options.interactTheme ?? "system",
      activeScreenUrlBacked: options.activeScreenUrlBacked ?? false,
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
  await act(async () => root.render(<Harness options={initial} />));
  unmounts.push(() =>
    act(async () => root.unmount()).then(() => host.remove()),
  );
  const controls = (): Controls => latest.current!;
  const rerender = (options: MountOptions) =>
    act(async () => root.render(<Harness options={options} />));
  return { controls, setInteractTheme, requestDarkStyles, rerender };
}

describe("useInteractControls screens", () => {
  it("lists the design's screens by name, with no route to show", async () => {
    const { controls } = await mountControls("yes");
    expect(controls().interactScreens).toEqual([
      { screenId: "home", title: "Home" },
      { screenId: "docs", title: "Docs" },
    ]);
  });
});

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
      await mountControls("no", { interactTheme: "light" });
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

  it("forces the scheme an explicit Light or Dark picks", async () => {
    const { controls, rerender } = await mountControls("yes", {
      interactTheme: "light",
    });
    expect(controls().previewColorScheme).toBe("light");
    await rerender({ interactTheme: "dark" });
    expect(controls().previewColorScheme).toBe("dark");
  });

  it("forces nothing outside Interact", async () => {
    const { controls } = await mountControls("yes", {
      active: false,
      interactTheme: "dark",
    });
    expect(controls().previewColorScheme).toBeNull();
  });
});

describe("useInteractControls System theme", () => {
  it("sends no override, so a design runs as authored", async () => {
    for (const darkStyles of [null, "yes", "no", "unknown"] as const) {
      const { controls } = await mountControls(darkStyles, {
        interactTheme: "system",
      });
      expect(controls().previewColorScheme).toBeNull();
      expect(controls().interactPreviewTheme.displayMode).toBe("system");
    }
  });

  it("is what Interact opens on", async () => {
    const { controls } = await mountControls("yes");
    expect(controls().previewColorScheme).toBeNull();
    expect(controls().interactPreviewTheme.displayMode).toBe("system");
  });

  it("stops forcing a scheme when it replaces an explicit Dark", async () => {
    const { controls, rerender } = await mountControls("yes", {
      interactTheme: "dark",
    });
    expect(controls().previewColorScheme).toBe("dark");
    await rerender({ interactTheme: "system" });
    expect(controls().previewColorScheme).toBeNull();
  });

  it("is applied without asking the agent, even when the design has no dark styles", async () => {
    const { controls, setInteractTheme, requestDarkStyles } =
      await mountControls("no");
    act(() => controls().handleInteractThemeChange("system"));
    expect(setInteractTheme).toHaveBeenCalledWith("system");
    expect(requestDarkStyles).not.toHaveBeenCalled();
  });

  it("forces nothing outside Interact", async () => {
    const { controls } = await mountControls("yes", {
      active: false,
      interactTheme: "system",
    });
    expect(controls().previewColorScheme).toBeNull();
  });
});

describe("useInteractControls theme picker on a URL-backed screen", () => {
  it("is hidden, and the preview is left to the page's own theme", async () => {
    for (const interactTheme of ["light", "dark", "system"] as const) {
      const { controls } = await mountControls("yes", {
        interactTheme,
        activeScreenUrlBacked: true,
      });
      expect(controls().interactPreviewTheme.pickerVisible).toBe(false);
      expect(controls().previewColorScheme).toBeNull();
    }
  });

  it("stays hidden whatever the preview reports", async () => {
    const { controls } = await mountControls(null, {
      activeScreenUrlBacked: true,
    });
    expect(controls().interactPreviewTheme.pickerVisible).toBe(false);
  });

  it("is shown for a markup screen, before and after it reports", async () => {
    for (const darkStyles of [null, "yes", "no", "unknown"] as const) {
      const { controls } = await mountControls(darkStyles);
      expect(controls().interactPreviewTheme.pickerVisible).toBe(true);
    }
  });
});
