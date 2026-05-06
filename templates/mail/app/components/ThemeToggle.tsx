import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : false;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(isDark ? "light" : "dark")}
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
      <TooltipContent>Toggle theme</TooltipContent>
    </Tooltip>
  );
}

export function SidebarThemeRow() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : false;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-[14px] text-foreground/70 hover:bg-accent/30 transition-colors min-h-[44px] cursor-pointer"
    >
      <span>Appearance</span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {mounted ? (
          <>
            <span className="text-[12px]">{isDark ? "Dark" : "Light"}</span>
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
