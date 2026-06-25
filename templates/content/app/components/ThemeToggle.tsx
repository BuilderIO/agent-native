import { useT } from "@agent-native/core/client";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const themeOptions = [
  { value: "system", icon: IconDeviceDesktop },
  { value: "light", icon: IconSun },
  { value: "dark", icon: IconMoon },
] as const;

const THEME_PREFERENCE_STORAGE_KEY = "content-theme-preference";

type ThemeOption = (typeof themeOptions)[number]["value"];

function isThemeOption(value: string | null | undefined): value is ThemeOption {
  return value === "light" || value === "system" || value === "dark";
}

function readStoredThemePreference(): ThemeOption {
  if (typeof window === "undefined") return "system";

  try {
    const storedTheme = window.localStorage.getItem(
      THEME_PREFERENCE_STORAGE_KEY,
    );
    if (storedTheme === "auto") return "system";
    return isThemeOption(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function writeStoredThemePreference(theme: ThemeOption) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures and still let next-themes update the page.
  }
}

function nextTheme(theme: ThemeOption): ThemeOption {
  const currentIndex = themeOptions.findIndex(
    (option) => option.value === theme,
  );
  return themeOptions[(currentIndex + 1) % themeOptions.length].value;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>("system");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    setSelectedTheme(readStoredThemePreference());
  }, [mounted, theme]);

  const activeTheme = mounted ? selectedTheme : "system";
  const activeOption =
    themeOptions.find((option) => option.value === activeTheme) ??
    themeOptions[0];
  const ActiveIcon = activeOption.icon;
  const handleClick = () => {
    const next = nextTheme(activeTheme);
    setSelectedTheme(next);
    writeStoredThemePreference(next);
    setTheme(next);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t(`theme.${activeOption.value}`)}
          onClick={handleClick}
          className={cn(
            "size-8 rounded-md text-sidebar-muted hover:text-sidebar-foreground",
            className,
          )}
        >
          <ActiveIcon size={14} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t(`theme.${activeOption.value}`)}</TooltipContent>
    </Tooltip>
  );
}
