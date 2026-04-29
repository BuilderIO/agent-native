// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useTheme } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactElement } from "react";

vi.mock("next-themes", () => ({
  useTheme: vi.fn(),
}));
vi.mock("@agent-native/core", () => ({
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v.length > 0)
      .join(" "),
}));

import { ThemeToggle } from "./ThemeToggle";

function renderWithProviders(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const useThemeMock = vi.mocked(useTheme);

function setTheme(resolvedTheme: "light" | "dark") {
  const setThemeSpy = vi.fn();
  useThemeMock.mockReturnValue({
    theme: resolvedTheme,
    setTheme: setThemeSpy,
    resolvedTheme,
    themes: ["light", "dark"],
    forcedTheme: undefined,
    systemTheme: undefined,
  });
  return setThemeSpy;
}

afterEach(() => {
  cleanup();
  useThemeMock.mockReset();
});

describe("<ThemeToggle>", () => {
  beforeEach(() => {
    // Avoid the pre-mount span path; the useEffect flushes during render.
  });

  it("renders the Moon icon when the resolved theme is light", () => {
    setTheme("light");
    const { container } = renderWithProviders(<ThemeToggle />);
    expect(container.querySelector(".tabler-icon-moon")).toBeTruthy();
    expect(container.querySelector(".tabler-icon-sun")).toBeNull();
  });

  it("renders the Sun icon when the resolved theme is dark", () => {
    setTheme("dark");
    const { container } = renderWithProviders(<ThemeToggle />);
    expect(container.querySelector(".tabler-icon-sun")).toBeTruthy();
    expect(container.querySelector(".tabler-icon-moon")).toBeNull();
  });

  it("clicking the button calls setTheme with the opposite value", () => {
    const setThemeSpy = setTheme("dark");
    renderWithProviders(<ThemeToggle />);
    const button = screen.getByRole("button");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setThemeSpy).toHaveBeenCalledTimes(1);
    expect(setThemeSpy).toHaveBeenCalledWith("light");
  });
});
