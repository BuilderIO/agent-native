import { useT } from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getResolvedTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme();
  const t = useT();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const resolved = getResolvedTheme(resolvedTheme);
  const isDark = mounted ? resolved === "dark" : false;
  const toggleTheme = () =>
    setTheme(getResolvedTheme(resolvedTheme) === "dark" ? "light" : "dark");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className={cn("h-7 w-7 text-muted-foreground", className)}
        >
          {mounted ? (
            isDark ? (
              <IconSun className="h-4 w-4" />
            ) : (
              <IconMoon className="h-4 w-4" />
            )
          ) : (
            <span className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {t(isDark ? "commandPalette.toggleLight" : "commandPalette.toggleDark")}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarThemeRow() {
  const { setTheme, resolvedTheme } = useTheme();
  const t = useT();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const resolved = getResolvedTheme(resolvedTheme);
  const isDark = mounted ? resolved === "dark" : false;
  const toggleTheme = () =>
    setTheme(getResolvedTheme(resolvedTheme) === "dark" ? "light" : "dark");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-[14px] text-foreground/70 hover:bg-accent/30 transition-colors min-h-[44px] cursor-pointer"
    >
      <span>{t("commandPalette.appearance")}</span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {mounted ? (
          <>
            <span className="text-[12px]">
              {t(isDark ? "theme.dark" : "theme.light")}
            </span>
            {isDark ? (
              <IconSun className="h-4 w-4" />
            ) : (
              <IconMoon className="h-4 w-4" />
            )}
          </>
        ) : (
          <span className="h-4 w-4" />
        )}
      </span>
    </button>
  );
}
